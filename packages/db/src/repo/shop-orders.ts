import { and, eq, inArray, sql } from 'drizzle-orm';
import { ASSIGNMENT_DECLINE_REASONS, type AssignmentDeclineReason } from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import { orderAssignments, orderItems, orders, reservations, shipments, shopInventory } from '../schema';
import { acceptAssignment, declineAssignment } from './assignments';
import { issueDeliveryCode, verifyDeliveryCode, type DeliveryCheck } from './delivery';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { commitReservation } from './inventory';
import { transitionOrder, type Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * The shop side of an order (spec 04, spec 07): a shop sees offers made to it (contact details hidden until it
 * accepts), accepts (the order's reservations become sales in the same transaction) or declines with a reason
 * code, then packs, hands over (own delivery or courier with AWB), sends out for delivery (the customer gets the
 * delivery code) and marks delivered **only with the customer's code**. Every query is scoped to the shops in
 * the caller's grants: another shop's offer or order is 404.
 */
export function shopIdsFrom(
  grants: readonly { permissions: readonly string[]; shopId: string | null }[],
  permission: string,
): string[] {
  return [
    ...new Set(
      grants
        .filter((g) => g.shopId !== null && g.permissions.includes(permission))
        .map((g) => g.shopId)
        .filter((id): id is string => id !== null),
    ),
  ];
}

const inShops = (shopIds: readonly string[], column: string) =>
  shopIds.length === 0
    ? sql`false`
    : sql`${sql.raw(column)} in (${sql.join(
        shopIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;

export type ShopView = 'offers' | 'active' | 'done';

export interface ShopOrderItem {
  code: string;
  status: string;
  version: number;
  totalPaise: number;
  pincode: string;
  items: { title: string; sku: string; qty: number; unitPaise: number }[];
  /** Offers only. */
  assignmentId: string | null;
  expiresAt: Date | null;
  /** Accepted orders only (null on offers: the customer's details are shared once the shop accepts). */
  address: Record<string, unknown> | null;
}

export async function listShopOrders(
  db: Tx,
  shopIds: readonly string[],
  view: ShopView,
): Promise<ShopOrderItem[]> {
  const rows = rowsOf<{
    id: string;
    code: string;
    status: string;
    version: unknown;
    total_paise: unknown;
    pincode: string;
    shipping_address: Record<string, unknown>;
    assignment_id: string | null;
    expires_at: string | Date | null;
  }>(
    view === 'offers'
      ? await db.execute(sql`
          select o.id, o.code, o.status, o.version, o.total_paise, o.pincode, o.shipping_address,
            a.id as assignment_id, a.expires_at
          from order_assignments a join orders o on o.id = a.order_id
          where a.status = 'offered' and a.expires_at > now() and ${inShops(shopIds, 'a.shop_id')}
          order by a.expires_at limit 100`)
      : await db.execute(sql`
          select o.id, o.code, o.status, o.version, o.total_paise, o.pincode, o.shipping_address,
            null::uuid as assignment_id, null::timestamptz as expires_at
          from orders o
          where ${inShops(shopIds, 'o.shop_id')} and ${
            view === 'active'
              ? sql`o.status in ('confirmed', 'packed', 'shipped', 'out_for_delivery')`
              : sql`o.status in ('delivered', 'cancelled') and o.updated_at > now() - interval '30 days'`
          }
          order by o.placed_at limit 100`),
  );
  const ids = rows.map((r) => r.id);
  const items =
    ids.length === 0
      ? []
      : await db
          .select({
            orderId: orderItems.orderId,
            title: orderItems.title,
            sku: orderItems.sku,
            qty: orderItems.qty,
            unitPaise: orderItems.unitPaise,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids));
  return rows.map((r) => ({
    code: r.code,
    status: r.status,
    version: num(r.version),
    totalPaise: num(r.total_paise),
    pincode: r.pincode,
    items: items
      .filter((i) => i.orderId === r.id)
      .map((i) => ({ title: i.title, sku: i.sku, qty: num(i.qty), unitPaise: num(i.unitPaise) })),
    assignmentId: r.assignment_id,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    address: view === 'offers' ? null : r.shipping_address,
  }));
}

async function ownAssignment(tx: Tx, shopIds: readonly string[], assignmentId: string) {
  const [a] = await tx
    .select({ id: orderAssignments.id, shopId: orderAssignments.shopId, orderId: orderAssignments.orderId })
    .from(orderAssignments)
    .where(eq(orderAssignments.id, assignmentId))
    .limit(1);
  if (!a || !shopIds.includes(a.shopId)) throw new NotFoundError('Offer not found');
  return a;
}

/** Accept: compare-and-set on the offer (late accepts fail), order confirmed, reservations committed. */
export async function acceptShopOffer(
  db: Tx,
  input: { shopIds: readonly string[]; assignmentId: string; staffUserId: string },
) {
  return db.transaction(async (tx) => {
    const a = await ownAssignment(tx, input.shopIds, input.assignmentId);
    const row = await acceptAssignment(tx, {
      assignmentId: a.id,
      shopId: a.shopId,
      actor: { type: 'shop', userId: input.staffUserId },
    });
    const held = await tx
      .select({ id: reservations.id, shopId: shopInventory.shopId })
      .from(reservations)
      .innerJoin(shopInventory, eq(shopInventory.id, reservations.inventoryId))
      .where(and(eq(reservations.orderId, a.orderId), eq(reservations.status, 'active')));
    if (held.length === 0 || held.some((h) => h.shopId !== a.shopId))
      throw new ConflictError(
        'Stock for this order is not held at your shop; ask MechDost to reroute',
        'STOCK_NOT_HELD',
      );
    for (const h of held) await commitReservation(tx, h.id);
    return { status: row.status, version: row.version };
  });
}

export async function declineShopOffer(
  db: Tx,
  input: {
    shopIds: readonly string[];
    assignmentId: string;
    reasonCode: AssignmentDeclineReason;
    staffUserId: string;
  },
) {
  if (!ASSIGNMENT_DECLINE_REASONS.includes(input.reasonCode))
    throw new ValidationError('Unknown reason', 'DECLINE_REASON');
  return db.transaction(async (tx) => {
    const a = await ownAssignment(tx, input.shopIds, input.assignmentId);
    const row = await declineAssignment(tx, {
      assignmentId: a.id,
      shopId: a.shopId,
      reason: input.reasonCode,
      actor: { type: 'shop', userId: input.staffUserId },
    });
    return { status: row.status, version: row.version };
  });
}

async function ownOrder(tx: Tx, shopIds: readonly string[], code: string) {
  const [o] = await tx
    .select({ id: orders.id, status: orders.status, version: orders.version, shopId: orders.shopId })
    .from(orders)
    .where(eq(orders.code, code))
    .limit(1);
  if (!o?.shopId || !shopIds.includes(o.shopId)) throw new NotFoundError('Order not found');
  return o;
}

async function shipmentOf(tx: Tx, orderId: string) {
  const [s] = await tx
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .limit(1);
  if (!s) throw new ConflictError('This order has not been handed over yet', 'NO_SHIPMENT');
  return s;
}

export type ShopStep =
  | { to: 'packed' }
  | { to: 'shipped'; mode: 'own' | 'courier'; courier?: string | null; awb?: string | null }
  | { to: 'out_for_delivery' };

/** Pack → hand over → out for delivery (issues the customer's code). Compare-and-set on the order version. */
export async function advanceShopOrder(
  db: Tx,
  input: {
    shopIds: readonly string[];
    code: string;
    expectedVersion: number;
    step: ShopStep;
    staffUserId: string;
    keyring: Keyring | null;
  },
) {
  const { step } = input;
  if (step.to === 'shipped' && step.mode === 'courier' && !(step.courier?.trim() && step.awb?.trim()))
    throw new ValidationError('A courier hand-over needs the courier name and AWB number', 'COURIER_DETAILS');
  if (step.to === 'out_for_delivery' && !input.keyring)
    throw new ConflictError('Delivery codes are not configured on this server', 'DELIVERY_CODES_UNAVAILABLE');
  return db.transaction(async (tx) => {
    const o = await ownOrder(tx, input.shopIds, input.code);
    const from = { packed: 'confirmed', shipped: 'packed', out_for_delivery: 'shipped' } as const;
    if (o.status !== from[step.to]) throw new ConflictError(`Order is ${o.status}`, 'WRONG_STEP');
    const actor = { type: 'shop' as const, userId: input.staffUserId };
    if (step.to === 'shipped') {
      await tx.insert(shipments).values({
        orderId: o.id,
        mode: step.mode,
        courier: step.mode === 'courier' ? (step.courier?.trim() ?? null) : null,
        awb: step.mode === 'courier' ? (step.awb?.trim() ?? null) : null,
        status: 'in_transit',
      });
    }
    const row = await transitionOrder(tx, {
      orderId: o.id,
      from: from[step.to],
      to: step.to,
      expectedVersion: input.expectedVersion,
      actor,
    });
    if (step.to === 'out_for_delivery' && input.keyring) {
      const shipment = await shipmentOf(tx, o.id);
      await tx.update(shipments).set({ status: 'out_for_delivery' }).where(eq(shipments.id, shipment.id));
      await issueDeliveryCode(tx, input.keyring, shipment.id);
    }
    return { status: row.status, version: row.version };
  });
}

/**
 * Delivered only with the customer's 4-digit code (decision 2026-11-01). A wrong code is counted (5 then locked)
 * and the order stays out for delivery; the right code delivers the shipment and the order together.
 */
export async function deliverShopOrder(
  db: Tx,
  input: {
    shopIds: readonly string[];
    code: string;
    deliveryCode: string;
    expectedVersion: number;
    staffUserId: string;
    keyring: Keyring | null;
  },
): Promise<DeliveryCheck & { version?: number }> {
  if (!input.keyring)
    throw new ConflictError('Delivery codes are not configured on this server', 'DELIVERY_CODES_UNAVAILABLE');
  const keyring = input.keyring;
  return db.transaction(async (tx) => {
    const o = await ownOrder(tx, input.shopIds, input.code);
    if (o.status !== 'out_for_delivery') throw new ConflictError(`Order is ${o.status}`, 'WRONG_STEP');
    const shipment = await shipmentOf(tx, o.id);
    const check = await verifyDeliveryCode(tx, keyring, shipment.id, input.deliveryCode);
    if (!check.ok) return check;
    const row = await transitionOrder(tx, {
      orderId: o.id,
      from: 'out_for_delivery',
      to: 'delivered',
      expectedVersion: input.expectedVersion,
      actor: { type: 'shop', userId: input.staffUserId },
      patch: { deliveredAt: new Date() },
    });
    return { ok: true, version: row.version };
  });
}
