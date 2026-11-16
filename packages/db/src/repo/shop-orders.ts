import { and, eq, inArray, sql } from 'drizzle-orm';
import { ASSIGNMENT_DECLINE_REASONS, type AssignmentDeclineReason } from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import {
  auditLog,
  orderAssignments,
  orderItems,
  orders,
  reservations,
  shipments,
  shopInventory,
  shops,
} from '../schema';
import { acceptAssignment, declineAssignment } from './assignments';
import {
  DELIVERY_CODE_MAX_ATTEMPTS,
  issueDeliveryCode,
  verifyDeliveryCode,
  type DeliveryCheck,
} from './delivery';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { commitReservation, reserveStock } from './inventory';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { recordServerEvent } from './events';
import { transitionOrder, type Tx } from './orders';
import { num, numOrNull, rowsOf } from './sql-rows';

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

/** Every shop-side action is audited in its own transaction (CLAUDE.md conventions; spec 04 disputes). */
async function auditShop(
  tx: Tx,
  input: { staffUserId: string; action: string; orderId: string; after: Record<string, unknown> },
) {
  await tx.insert(auditLog).values({
    actorUserId: input.staffUserId,
    actorRole: 'shop',
    action: input.action,
    entity: 'order',
    entityId: input.orderId,
    after: input.after,
  });
}

export type ShopView = 'offers' | 'active' | 'done';

export interface ShopOrderItem {
  code: string;
  status: string;
  version: number;
  /** The customer's total for this sub-order. */
  totalPaise: number;
  /**
   * What the shop is paid: its own price × qty over the lines (never the customer price or a quote discount).
   * Null on a `given_up` history row: the order may since be priced for another shop (security review 2026-11-15).
   */
  payoutPaise: number | null;
  /** Cash to collect from the customer at delivery (cash-on-delivery orders), else null. */
  collectPaise: number | null;
  /** MechDost Coins discount on this part (paid by MechDost, never by the shop; spec 20); 0 when none. */
  coinDiscountPaise: number;
  pincode: string;
  /**
   * `unitPaise` is the shop's own price per unit (review I1, 2026-11-14), not the customer's; null on a `given_up`
   * row, whose lines now carry the next shop's price (never shown to a competitor, security review 2026-11-15).
   */
  items: { title: string; titleHi: string | null; sku: string; qty: number; unitPaise: number | null }[];
  /** Offers only. */
  /** History only: the reason code of an order this shop accepted and gave up (status `given_up`). */
  givenUpReason: string | null;
  assignmentId: string | null;
  expiresAt: Date | null;
  /** Accepted orders only (null on offers: the customer's details are shared once the shop accepts). */
  address: Record<string, unknown> | null;
  /** Active orders: 5 wrong delivery codes were entered (server state; support takes over). */
  deliveryLocked: boolean;
}

/**
 * Offers and active orders are a shop's live working set (capped at 100, oldest first); finished orders are
 * history, newest first and keyset-paged on (updated_at, id) (hard rule 7).
 */
export async function listShopOrders(
  db: Tx,
  shopIds: readonly string[],
  view: ShopView,
  page: { cursor?: string | null; limit?: number; moneyShopIds?: readonly string[] } = {},
): Promise<{ items: ShopOrderItem[]; nextCursor: string | null }> {
  // Staff never see what the shop is paid (design 2026-11-15, spec 13): money only for shops where the caller holds
  // `payouts:read` (the API passes those ids). Default: all the shops, for callers that already checked.
  const moneyShops = new Set(page.moneyShopIds ?? shopIds);
  const doneLimit = pageSize(page.limit, 30, 50);
  const after = view === 'done' && page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const fetched = rowsOf<{
    id: string;
    code: string;
    status: string;
    shop_id: string;
    delivery_locked?: boolean;
    version: unknown;
    total_paise: unknown;
    coin_discount_paise: unknown;
    pincode: string;
    shipping_address: Record<string, unknown>;
    give_up_reason?: string | null;
    payment_method: string;
    assignment_id: string | null;
    expires_at: string | Date | null;
    sort_key: string;
  }>(
    view === 'offers'
      ? await db.execute(sql`
          select o.id, o.code, o.status, a.shop_id, o.version, o.total_paise, o.coin_discount_paise,
            (select g.payment_method from order_groups g where g.id = o.group_id) as payment_method,
            o.pincode, o.shipping_address,
            a.id as assignment_id, a.expires_at, '' as sort_key
          from order_assignments a join orders o on o.id = a.order_id
          where a.status = 'offered' and a.expires_at > now() and ${inShops(shopIds, 'a.shop_id')}
          order by a.expires_at limit 100`)
      : view === 'active'
        ? await db.execute(sql`
          select o.id, o.code, o.status, o.shop_id, o.version, o.total_paise, o.coin_discount_paise,
            (select g.payment_method from order_groups g where g.id = o.group_id) as payment_method,
            o.pincode, o.shipping_address,
            exists (select 1 from shipments sh where sh.order_id = o.id
              and sh.delivery_code_attempts >= ${DELIVERY_CODE_MAX_ATTEMPTS}) as delivery_locked,
            null::uuid as assignment_id, null::timestamptz as expires_at, '' as sort_key
          from orders o
          where ${inShops(shopIds, 'o.shop_id')} and o.status in ('confirmed', 'packed', 'shipped', 'out_for_delivery')
          order by o.placed_at limit 100`)
        : await db.execute(sql`
          select u.id, u.code, u.status, u.shop_id, u.version, u.total_paise, u.coin_discount_paise, u.payment_method,
            u.pincode, u.shipping_address, u.give_up_reason, u.assignment_id, u.expires_at,
            u.sort_ts::text as sort_key
          from (
            select o.id, o.code, o.status, o.shop_id, o.version, o.total_paise, o.coin_discount_paise,
              (select g.payment_method from order_groups g where g.id = o.group_id) as payment_method,
              o.pincode, o.shipping_address, null::text as give_up_reason,
              null::uuid as assignment_id, null::timestamptz as expires_at, o.updated_at as sort_ts
            from orders o
            where ${inShops(shopIds, 'o.shop_id')} and o.status in ('delivered', 'cancelled')
              and o.updated_at > now() - interval '30 days'
            union all
            select o.id, o.code, 'given_up' as status, a.shop_id, o.version, o.total_paise, o.coin_discount_paise,
              (select g.payment_method from order_groups g where g.id = o.group_id) as payment_method,
              o.pincode, o.shipping_address, a.give_up_reason,
              null::uuid as assignment_id, null::timestamptz as expires_at, a.given_up_at as sort_ts
            from order_assignments a join orders o on o.id = a.order_id
            where a.status = 'given_up' and ${inShops(shopIds, 'a.shop_id')}
              and a.given_up_at > now() - interval '30 days'
          ) u
          where true
            ${after ? sql`and (u.sort_ts, u.id) < (cast(${after.k} as timestamptz), cast(${after.id} as uuid))` : sql``}
          order by u.sort_ts desc, u.id desc limit ${doneLimit + 1}`),
  );
  const more = view === 'done' && fetched.length > doneLimit;
  const rows = more ? fetched.slice(0, doneLimit) : fetched;
  const last = rows.at(-1);
  const nextCursor = more && last ? encodeCursor({ k: last.sort_key, id: last.id }) : null;
  const ids = rows.map((r) => r.id);
  const items =
    ids.length === 0
      ? []
      : await db
          .select({
            orderId: orderItems.orderId,
            title: orderItems.title,
            titleHi: orderItems.titleHi,
            sku: orderItems.sku,
            qty: orderItems.qty,
            // The shop's own price (snapshot at routing); older orders without one fall back to the unit price.
            unitPaise: sql<number>`coalesce(${orderItems.shopUnitPaise}, ${orderItems.unitPaise})`,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids));
  const list = rows.map((r) => {
    const lines = items.filter((i) => i.orderId === r.id);
    const priced = r.status !== 'given_up';
    const shows = priced && moneyShops.has(r.shop_id);
    return {
      code: r.code,
      status: r.status,
      version: num(r.version),
      totalPaise: num(r.total_paise),
      coinDiscountPaise: num(r.coin_discount_paise),
      payoutPaise: shows ? lines.reduce((sum, i) => sum + num(i.unitPaise) * num(i.qty), 0) : null,
      collectPaise: r.payment_method === 'cod' ? num(r.total_paise) : null,
      pincode: r.pincode,
      items: lines.map((i) => ({
        title: i.title,
        titleHi: i.titleHi,
        sku: i.sku,
        qty: num(i.qty),
        unitPaise: shows ? num(i.unitPaise) : null,
      })),
      givenUpReason: r.give_up_reason ?? null,
      assignmentId: r.assignment_id,
      expiresAt: r.expires_at ? new Date(r.expires_at) : null,
      // Shared only while the shop is fulfilling the order (DPDP minimisation, advisor review 2026-11-03).
      address: view === 'active' ? r.shipping_address : null,
      deliveryLocked: r.delivery_locked === true,
    };
  });
  return { items: list, nextCursor };
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

/**
 * Accepting sells every item from this shop, so each item needs a hold here (spec 04). The expiry sweep may have
 * freed holds of an order that waited too long; those are re-reserved now, inside the accept transaction, or
 * the whole accept is refused — a shop never sells stock its inventory does not cover. A hold at another shop
 * means routing and holds disagree: refused too, for admin to reroute. Returns the hold ids to commit.
 */
async function holdEveryItem(tx: Tx, orderId: string, shopId: string): Promise<string[]> {
  const notHeld = () =>
    new ConflictError(
      'Your shop no longer has stock held for every item in this order; ask MechDost to reroute',
      'STOCK_NOT_HELD',
    );
  const held = await tx
    .select({ id: reservations.id, shopId: shopInventory.shopId, variantId: shopInventory.variantId })
    .from(reservations)
    .innerJoin(shopInventory, eq(shopInventory.id, reservations.inventoryId))
    .where(and(eq(reservations.orderId, orderId), eq(reservations.status, 'active')));
  if (held.some((h) => h.shopId !== shopId)) throw notHeld();
  const items = await tx
    .select({ variantId: orderItems.variantId, qty: orderItems.qty, inventoryId: shopInventory.id })
    .from(orderItems)
    .leftJoin(
      shopInventory,
      and(eq(shopInventory.variantId, orderItems.variantId), eq(shopInventory.shopId, shopId)),
    )
    .where(eq(orderItems.orderId, orderId));
  if (items.length === 0) throw notHeld();
  const covered = new Set(held.map((h) => h.variantId));
  const ids = held.map((h) => h.id);
  for (const item of items.filter((i) => !covered.has(i.variantId))) {
    const again = item.inventoryId
      ? await reserveStock(tx, { inventoryId: item.inventoryId, orderId, qty: item.qty })
      : null;
    if (!again) throw notHeld();
    ids.push(again.id);
  }
  return ids;
}

/** Accept: compare-and-set on the offer (late accepts fail), order confirmed, every item's hold committed. */
export async function acceptShopOffer(
  db: Tx,
  input: { shopIds: readonly string[]; assignmentId: string; staffUserId: string },
) {
  return db.transaction(async (tx) => {
    const a = await ownAssignment(tx, input.shopIds, input.assignmentId);
    // Decision 2026-11-01: a paused or suspended shop takes no new work — also not an offer made before the
    // pause (advisor review 2026-11-03; the demo already refused it). FOR SHARE: a concurrent pause waits.
    const [standing] = await tx
      .select({ status: shops.status })
      .from(shops)
      .where(eq(shops.id, a.shopId))
      .for('share');
    if (standing?.status !== 'approved')
      throw new ForbiddenError(
        'Your shop is paused or suspended and cannot take new orders',
        'SHOP_NOT_ACTIVE',
      );
    const row = await acceptAssignment(tx, {
      assignmentId: a.id,
      shopId: a.shopId,
      actor: { type: 'shop', userId: input.staffUserId },
    });
    for (const id of await holdEveryItem(tx, a.orderId, a.shopId)) await commitReservation(tx, id);
    const [info] = rowsOf<{ code: string; city_id: string; seconds: unknown }>(
      await tx.execute(sql`select o.code, o.city_id, extract(epoch from a.responded_at - a.offered_at)::int as seconds
        from order_assignments a join orders o on o.id = a.order_id where a.id = ${a.id}`),
    );
    if (info)
      await recordServerEvent(tx, 'seller_order_accepted', {
        userId: input.staffUserId,
        cityId: info.city_id,
        props: { orderCode: info.code, shopId: a.shopId, secondsToAccept: numOrNull(info.seconds) ?? 0 },
      });
    await auditShop(tx, {
      staffUserId: input.staffUserId,
      action: 'order.accepted_by_shop',
      orderId: a.orderId,
      after: { shopId: a.shopId },
    });
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
    const [o] = await tx
      .select({ code: orders.code, cityId: orders.cityId })
      .from(orders)
      .where(eq(orders.id, a.orderId))
      .limit(1);
    if (o)
      await recordServerEvent(tx, 'seller_order_declined', {
        userId: input.staffUserId,
        cityId: o.cityId,
        props: { orderCode: o.code, shopId: a.shopId, reasonCode: input.reasonCode },
      });
    await auditShop(tx, {
      staffUserId: input.staffUserId,
      action: 'order.declined_by_shop',
      orderId: a.orderId,
      after: { shopId: a.shopId, reasonCode: input.reasonCode },
    });
    return { status: row.status, version: row.version };
  });
}

async function ownOrder(tx: Tx, shopIds: readonly string[], code: string) {
  const [o] = await tx
    .select({
      id: orders.id,
      status: orders.status,
      version: orders.version,
      shopId: orders.shopId,
      cityId: orders.cityId,
    })
    .from(orders)
    .where(eq(orders.code, code))
    .limit(1);
  const shopId = o?.shopId;
  if (!o || !shopId || !shopIds.includes(shopId)) throw new NotFoundError('Order not found');
  return { ...o, shopId }; // narrowed: an order a shop acts on always has its shop
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
  /** `handOverOwn`: from `packed`, hand over for own delivery and go out for delivery in this one call. */
  | { to: 'out_for_delivery'; handOverOwn?: boolean };

/**
 * Pack → hand over → out for delivery (issues the customer's code). Compare-and-set on the order version.
 * `out_for_delivery` with `handOverOwn` from `packed` runs both moves in ONE transaction (one request, the version
 * check on the first move; QA pass 4, bug 3).
 */
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
    const compound = step.to === 'out_for_delivery' && step.handOverOwn === true && o.status === 'packed';
    const moves: ShopStep[] = compound
      ? [{ to: 'shipped', mode: 'own' }, { to: 'out_for_delivery' }]
      : [step];
    const from = { packed: 'confirmed', shipped: 'packed', out_for_delivery: 'shipped' } as const;
    const first = moves[0];
    if (!first || o.status !== from[first.to]) throw new ConflictError(`Order is ${o.status}`, 'WRONG_STEP');
    const actor = { type: 'shop' as const, userId: input.staffUserId };
    let version = input.expectedVersion;
    let status: string = o.status;
    for (const move of moves) {
      // Order row first (lock order, spec 14), then the shipment.
      const row = await transitionOrder(tx, {
        orderId: o.id,
        from: from[move.to],
        to: move.to,
        expectedVersion: version,
        actor,
      });
      version = row.version;
      status = row.status;
      if (move.to === 'shipped') {
        await tx.insert(shipments).values({
          orderId: o.id,
          mode: move.mode,
          courier: move.mode === 'courier' ? (move.courier?.trim() ?? null) : null,
          awb: move.mode === 'courier' ? (move.awb?.trim() ?? null) : null,
          status: 'in_transit',
        });
      }
      if (move.to === 'out_for_delivery' && input.keyring) {
        const shipment = await shipmentOf(tx, o.id);
        await tx.update(shipments).set({ status: 'out_for_delivery' }).where(eq(shipments.id, shipment.id));
        await issueDeliveryCode(tx, input.keyring, shipment.id);
      }
      await auditShop(tx, {
        staffUserId: input.staffUserId,
        action: `order.${move.to}`,
        orderId: o.id,
        after: { status: move.to },
      });
      await recordServerEvent(tx, 'order_fulfilment_step', {
        userId: input.staffUserId,
        cityId: o.cityId,
        props: { orderCode: input.code, shopId: o.shopId, step: move.to },
      });
    }
    return { status, version };
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
    await recordServerEvent(tx, 'order_delivered', {
      userId: input.staffUserId,
      cityId: o.cityId,
      props: { orderCode: input.code, shopId: o.shopId },
    });
    await auditShop(tx, {
      staffUserId: input.staffUserId,
      action: 'order.delivered',
      orderId: o.id,
      after: { via: 'code' },
    });
    return { ok: true, version: row.version };
  });
}
