import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ORDER_CANCEL_REASONS,
  orderMachine,
  type OrderCancelReason,
  type OrderStatus,
} from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import {
  auditLog,
  orderAssignments,
  orderEvents,
  orderGroups,
  orderItems,
  orders,
  reservations,
  shipments,
  shopInventory,
  shops,
} from '../schema';
import { deliveryCodeFor } from './delivery';
import { recordServerEvent } from './events';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { releaseReservation } from './inventory';
import { localized } from './localized';
import { transitionOrder, type Tx } from './orders';
import type { ActorContext } from './actor';
import type { CatalogueLocale } from './catalogue';

/**
 * The customer's own orders (spec 03/04/05): list, tracking and cancel, always scoped to the signed-in user
 * (another user's code → 404, hard rule 3). Tracking shows the customer-visible timeline, the shop once it
 * accepted, the rejection message, and the 4-digit delivery code while the order is out for delivery.
 *
 * Cancel (no returns or exchanges, CLAUDE.md): the customer may cancel a sub-order until it is packed
 * (`cancellable_until_status`, default `confirmed`); staff may also cancel packed orders. A cancel withdraws an
 * open shop offer, releases held stock and puts committed stock back on the shelf, all in one transaction.
 * COD has nothing to refund; prepaid refunds arrive with online payment (spec 05).
 */
export interface MyOrderSummary {
  code: string;
  placedAt: Date;
  totalPaise: number;
  paymentMethod: string;
  paymentStatus: string;
  orders: { code: string; status: string; totalPaise: number }[];
}

/** Newest first, keyset-paged on (created_at, id) (hard rule 7); `nextCursor` is null on the last page. */
export async function listMyOrders(
  db: Tx,
  userId: string,
  page: { limit?: number; cursor?: string | null } = {},
): Promise<{ orders: MyOrderSummary[]; nextCursor: string | null }> {
  const limit = pageSize(page.limit, 20, 50);
  const after = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const rows = await db
    .select({ group: orderGroups, sortKey: sql<string>`${orderGroups.createdAt}::text` })
    .from(orderGroups)
    .where(
      and(
        eq(orderGroups.userId, userId),
        after
          ? sql`(${orderGroups.createdAt}, ${orderGroups.id}) < (cast(${after.k} as timestamptz), cast(${after.id} as uuid))`
          : undefined,
      ),
    )
    .orderBy(desc(orderGroups.createdAt), desc(orderGroups.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ k: last.sortKey, id: last.group.id }) : null;
  const groups = pageRows.map((r) => r.group);
  if (groups.length === 0) return { orders: [], nextCursor: null };
  const subs = await db
    .select({
      groupId: orders.groupId,
      code: orders.code,
      status: orders.status,
      totalPaise: orders.totalPaise,
      subNo: orders.subNo,
    })
    .from(orders)
    .where(
      inArray(
        orders.groupId,
        groups.map((g) => g.id),
      ),
    )
    .orderBy(orders.subNo);
  const summaries = groups.map((g) => ({
    code: g.code,
    placedAt: g.createdAt,
    totalPaise: g.totalPaise,
    paymentMethod: g.paymentMethod,
    paymentStatus: g.paymentStatus,
    orders: subs
      .filter((s) => s.groupId === g.id)
      .map(({ code, status, totalPaise }) => ({ code, status, totalPaise })),
  }));
  return { orders: summaries, nextCursor };
}

export interface TrackedOrder {
  code: string;
  status: string;
  version: number;
  totalPaise: number;
  shippingPaise: number;
  /** Set once a shop accepted. */
  seller: string | null;
  items: { title: string; sku: string; qty: number; unitPaise: number; totalPaise: number }[];
  timeline: { status: string; at: Date }[];
  /** Rejected orders: what MechDost told the customer. */
  message: string | null;
  /** Out for delivery: the code to give the delivery person. */
  deliveryCode: string | null;
  canCancel: boolean;
}

export interface MyOrderDetail extends Omit<MyOrderSummary, 'orders'> {
  address: Record<string, unknown>;
  orders: TrackedOrder[];
}

const CUSTOMER_CANCEL_FROM: readonly OrderStatus[] = [
  'placed',
  'awaiting_shop',
  'needs_rerouting',
  'confirmed',
];

function customerMayCancel(status: string, until: string): boolean {
  if (!(CUSTOMER_CANCEL_FROM as readonly string[]).includes(status)) return false;
  // `cancellable_until_status` = the last status the customer may still cancel from.
  const order = ['placed', 'awaiting_shop', 'needs_rerouting', 'confirmed', 'packed'];
  return (
    order.indexOf(status) <= order.indexOf(until) &&
    orderMachine.canActor(status as OrderStatus, 'cancelled', 'customer')
  );
}

export async function getMyOrder(
  db: Tx,
  userId: string,
  groupCode: string,
  opts: { locale: CatalogueLocale; keyring: Keyring | null },
): Promise<MyOrderDetail> {
  const [g] = await db
    .select()
    .from(orderGroups)
    .where(and(eq(orderGroups.userId, userId), eq(orderGroups.code, groupCode)));
  if (!g) throw new NotFoundError('Order not found');
  const subs = await db
    .select({ order: orders, shopName: shops.name, shopNameHi: shops.nameHi })
    .from(orders)
    .leftJoin(shops, eq(shops.id, orders.shopId))
    .where(eq(orders.groupId, g.id))
    .orderBy(orders.subNo);
  const ids = subs.map((s) => s.order.id);
  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, ids))
    .orderBy(orderItems.sku);
  const events = await db
    .select({ orderId: orderEvents.orderId, status: orderEvents.toStatus, at: orderEvents.createdAt })
    .from(orderEvents)
    .where(and(inArray(orderEvents.orderId, ids), eq(orderEvents.visibleToCustomer, true)))
    .orderBy(orderEvents.id);
  const tracked: TrackedOrder[] = [];
  for (const { order, shopName, shopNameHi } of subs) {
    let deliveryCode: string | null = null;
    if (order.status === 'out_for_delivery' && opts.keyring) {
      const [ship] = await db
        .select({ id: shipments.id })
        .from(shipments)
        .where(eq(shipments.orderId, order.id))
        .limit(1);
      if (ship) deliveryCode = await deliveryCodeFor(db, opts.keyring, ship.id);
    }
    tracked.push({
      code: order.code,
      status: order.status,
      version: order.version,
      totalPaise: order.totalPaise,
      shippingPaise: order.shippingPaise,
      seller: shopName ? localized(shopName, shopNameHi, opts.locale) : null,
      items: items
        .filter((i) => i.orderId === order.id)
        .map((i) => ({
          title: localized(i.title, i.titleHi, opts.locale),
          sku: i.sku,
          qty: i.qty,
          unitPaise: i.unitPaise,
          totalPaise: i.totalPaise,
        })),
      timeline: events.filter((e) => e.orderId === order.id).map((e) => ({ status: e.status, at: e.at })),
      message: order.status === 'rejected' ? order.customerMessage : null,
      deliveryCode,
      canCancel: customerMayCancel(order.status, order.cancellableUntilStatus),
    });
  }
  const [first] = subs;
  return {
    code: g.code,
    placedAt: g.createdAt,
    totalPaise: g.totalPaise,
    paymentMethod: g.paymentMethod,
    paymentStatus: g.paymentStatus,
    address: (first?.order.shippingAddress ?? {}) as Record<string, unknown>,
    orders: tracked,
  };
}

/** Shared by customer and staff cancel: withdraw the offer, free or restock, move to `cancelled`. */
async function cancelInTx(
  tx: Tx,
  input: {
    order: { id: string; status: OrderStatus };
    expectedVersion: number;
    reasonCode: OrderCancelReason;
    actor: ActorContext;
  },
) {
  const row = await transitionOrder(tx, {
    orderId: input.order.id,
    from: input.order.status,
    to: 'cancelled',
    expectedVersion: input.expectedVersion,
    actor: input.actor,
    patch: { statusReasonCode: input.reasonCode },
  });
  await tx
    .update(orderAssignments)
    .set({ status: 'withdrawn', respondedAt: sql`now()` })
    .where(and(eq(orderAssignments.orderId, input.order.id), eq(orderAssignments.status, 'offered')));
  const held = await tx
    .select({
      id: reservations.id,
      status: reservations.status,
      qty: reservations.qty,
      inventoryId: reservations.inventoryId,
    })
    .from(reservations)
    .where(
      and(eq(reservations.orderId, input.order.id), inArray(reservations.status, ['active', 'committed'])),
    );
  for (const r of held) {
    if (r.status === 'active') await releaseReservation(tx, r.id);
    else {
      // Accepted orders already took the stock off the shelf: put it back.
      await tx
        .update(shopInventory)
        .set({ onHand: sql`${shopInventory.onHand} + ${r.qty}` })
        .where(eq(shopInventory.id, r.inventoryId));
      await tx.update(reservations).set({ status: 'released' }).where(eq(reservations.id, r.id));
    }
  }
  await tx.insert(auditLog).values({
    actorUserId: input.actor.userId ?? null,
    actorRole: input.actor.type === 'customer' ? 'customer' : 'staff',
    action: 'order.cancelled',
    entity: 'order',
    entityId: input.order.id,
    after: { reasonCode: input.reasonCode, from: input.order.status },
    reason: input.reasonCode,
  });
  const [info] = await tx
    .select({ code: orders.code, cityId: orders.cityId })
    .from(orders)
    .where(eq(orders.id, input.order.id))
    .limit(1);
  if (info)
    await recordServerEvent(tx, 'order_cancelled', {
      userId: input.actor.userId ?? null,
      cityId: info.cityId,
      props: {
        orderCode: info.code,
        by: input.actor.type === 'customer' ? 'customer' : 'staff',
        reasonCode: input.reasonCode,
        fromStatus: input.order.status,
      },
    });
  return { status: row.status, version: row.version };
}

function checkReason(reasonCode: OrderCancelReason) {
  if (!ORDER_CANCEL_REASONS.includes(reasonCode))
    throw new ValidationError('Unknown reason', 'CANCEL_REASON');
}

/** The customer cancels one sub-order of their own (until it is packed). */
export async function cancelMyOrder(
  db: Tx,
  input: { userId: string; code: string; reasonCode: OrderCancelReason; expectedVersion: number },
) {
  checkReason(input.reasonCode);
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({ id: orders.id, status: orders.status, until: orders.cancellableUntilStatus })
      .from(orders)
      .where(and(eq(orders.code, input.code), eq(orders.userId, input.userId)));
    if (!o) throw new NotFoundError('Order not found');
    if (!customerMayCancel(o.status, o.until))
      throw new ConflictError(
        'This order can no longer be cancelled here; contact support',
        'NOT_CANCELLABLE',
      );
    return cancelInTx(tx, {
      order: { id: o.id, status: o.status as OrderStatus },
      expectedVersion: input.expectedVersion,
      reasonCode: input.reasonCode,
      actor: { type: 'customer', userId: input.userId },
    });
  });
}

/** Staff cancel (city-scoped by the caller): any status the order machine allows for admin. */
export async function cancelOrderAsStaff(
  db: Tx,
  input: {
    cityIds: readonly string[] | 'all';
    code: string;
    reasonCode: OrderCancelReason;
    expectedVersion: number;
    staffUserId: string;
  },
) {
  checkReason(input.reasonCode);
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({ id: orders.id, status: orders.status, cityId: orders.cityId })
      .from(orders)
      .where(eq(orders.code, input.code));
    if (!o || (input.cityIds !== 'all' && !input.cityIds.includes(o.cityId)))
      throw new NotFoundError('Order not found');
    if (!orderMachine.canActor(o.status as OrderStatus, 'cancelled', 'admin'))
      throw new ConflictError(`A ${o.status} order cannot be cancelled`, 'NOT_CANCELLABLE');
    return cancelInTx(tx, {
      order: { id: o.id, status: o.status as OrderStatus },
      expectedVersion: input.expectedVersion,
      reasonCode: input.reasonCode,
      actor: { type: 'admin', userId: input.staffUserId },
    });
  });
}
