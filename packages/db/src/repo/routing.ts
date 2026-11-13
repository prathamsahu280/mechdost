import { and, eq, inArray, sql } from 'drizzle-orm';
import type { OrderRejectReason, OrderStatus } from '@mechdost/shared/state';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { ORDER_REJECT_REASONS } from '@mechdost/shared/state';
import { auditLog, orderAssignments, orders, reservations, shipments, shopInventory } from '../schema';
import { overrideShipmentInTx } from './delivery';
import { expireAssignment, offerOrderToShop } from './assignments';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { releaseReservation, reserveStock } from './inventory';
import { localized } from './localized';
import { transitionOrder, type Tx } from './orders';
import { num, numOrNull, rowsOf } from './sql-rows';
import type { CatalogueLocale } from './catalogue';

/**
 * Admin routing (spec 04, CLAUDE.md core flow): placed / needs-rerouting sub-orders wait in a city-scoped queue;
 * staff see the shops ranked (stocks every item → nearest to the delivery PIN → acceptance rate → rating →
 * price; paused, suspended or busy shops and shops that already declined or let it expire are never offered) and
 * route with one action. Routing moves the order's stock reservations to the chosen shop in the same
 * transaction, so stock is never promised twice. Reject needs a reason code and a customer message.
 */
export type CityScope = { all: true } | { all: false; cityIds: string[] };

/** City scope of the grants holding `permission` (staff grants only; shop/workshop grants never count). */
export function cityScopeFrom(
  grants: readonly {
    permissions: readonly string[];
    cityId: string | null;
    shopId: string | null;
    workshopId: string | null;
  }[],
  permission: string,
): CityScope {
  const relevant = grants.filter(
    (g) => g.permissions.includes(permission) && g.shopId === null && g.workshopId === null,
  );
  if (relevant.some((g) => g.cityId === null)) return { all: true };
  return { all: false, cityIds: relevant.map((g) => g.cityId).filter((c): c is string => c !== null) };
}

const inScope = (scope: CityScope) =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`o.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

/** Settings (city first, then global): accept timer minutes (decision: admin-editable, demo default 15). */
export const ROUTING_SETTINGS = {
  acceptanceTimeoutMin: {
    key: 'orders.acceptance_timeout_min',
    fallback: OPERATIONAL_SETTINGS['orders.acceptance_timeout_min'].default,
  },
  reservationMinutes: {
    key: 'checkout.cod_reservation_minutes',
    fallback: OPERATIONAL_SETTINGS['checkout.cod_reservation_minutes'].default,
  },
} as const;

async function citySetting(db: Tx, cityId: string, s: { key: string; fallback: number }): Promise<number> {
  const rows = rowsOf<{ city_id: string | null; value: unknown }>(
    await db.execute(sql`select city_id, value from settings
      where key = ${s.key} and (city_id = ${cityId} or city_id is null)`),
  );
  const v = (rows.find((r) => r.city_id === cityId) ?? rows.find((r) => r.city_id === null))?.value;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : s.fallback;
}

export type QueueView = 'needs_routing' | 'awaiting_shop' | 'in_progress' | 'closed';
const VIEW_STATUSES: Record<QueueView, readonly OrderStatus[]> = {
  needs_routing: ['placed', 'needs_rerouting'],
  awaiting_shop: ['awaiting_shop'],
  in_progress: ['confirmed', 'packed', 'shipped', 'out_for_delivery'],
  closed: ['delivered', 'cancelled', 'rejected'],
};

export interface QueueItem {
  code: string;
  status: string;
  pincode: string;
  placedAt: Date;
  totalPaise: number;
  items: number;
  version: number;
  /** Shops already tried (declined or expired). */
  attempts: number;
  offer: { shop: string; expiresAt: Date } | null;
}

/** The routing queue, oldest first (FIFO), keyset on (placed_at, id). */
export async function listRoutingQueue(
  db: Tx,
  scope: CityScope,
  opts: {
    view: QueueView;
    limit?: number;
    cursor?: { placedAt: string; id: string } | null;
    locale: CatalogueLocale;
  },
): Promise<{ items: QueueItem[]; next: { placedAt: string; id: string } | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const statuses = sql.join(
    VIEW_STATUSES[opts.view].map((s) => sql`${s}`),
    sql`, `,
  );
  const after = opts.cursor
    ? sql`(o.placed_at, o.id) > (cast(${opts.cursor.placedAt} as timestamptz), cast(${opts.cursor.id} as uuid))`
    : sql`true`;
  const rows = rowsOf<{
    id: string;
    code: string;
    status: string;
    pincode: string;
    placed_at: string | Date;
    placed_key: string;
    total_paise: unknown;
    items: unknown;
    version: unknown;
    attempts: unknown;
    shop_name: string | null;
    shop_name_hi: string | null;
    expires_at: string | Date | null;
  }>(
    await db.execute(sql`
      select o.id, o.code, o.status, o.pincode, o.placed_at, o.placed_at::text as placed_key, o.total_paise,
        o.version,
        (select count(*) from order_items i where i.order_id = o.id)::int as items,
        (select count(*) from order_assignments a where a.order_id = o.id and a.status in ('declined', 'expired'))::int
          as attempts,
        cur.shop_name, cur.shop_name_hi, cur.expires_at
      from orders o
      left join lateral (
        select s.name as shop_name, s.name_hi as shop_name_hi, a.expires_at from order_assignments a
        join shops s on s.id = a.shop_id where a.order_id = o.id and a.status = 'offered' limit 1) cur on true
      where o.status in (${statuses}) and ${inScope(scope)} and ${after}
        and exists (select 1 from order_groups g where g.id = o.group_id
          and (g.payment_method = 'cod' or g.payment_status in ('paid', 'partially_refunded', 'refunded')))
      order by o.placed_at, o.id
      limit ${limit + 1}`),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      code: r.code,
      status: r.status,
      pincode: r.pincode,
      placedAt: new Date(r.placed_at),
      totalPaise: num(r.total_paise),
      items: num(r.items),
      version: num(r.version),
      attempts: num(r.attempts),
      offer:
        r.shop_name && r.expires_at
          ? { shop: localized(r.shop_name, r.shop_name_hi, opts.locale), expiresAt: new Date(r.expires_at) }
          : null,
    })),
    next: rows.length > limit && last ? { placedAt: last.placed_key, id: last.id } : null,
  };
}

interface ScopedOrder {
  id: string;
  code: string;
  status: OrderStatus;
  version: number;
  cityId: string;
  pincode: string;
}

async function findOrder(db: Tx, scope: CityScope, code: string, lock = false): Promise<ScopedOrder> {
  const [o] = rowsOf<{
    id: string;
    code: string;
    status: OrderStatus;
    version: unknown;
    city_id: string;
    pincode: string;
  }>(
    await db.execute(sql`select o.id, o.code, o.status, o.version, o.city_id, o.pincode from orders o
      where o.code = ${code} and ${inScope(scope)}${lock ? sql` for update of o` : sql``}`),
  );
  if (!o) throw new NotFoundError('Order not found');
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    version: num(o.version),
    cityId: o.city_id,
    pincode: o.pincode,
  };
}

export interface RankedShop {
  shopId: string;
  name: string;
  distanceKm: number | null;
  /** Items this shop can supply in full right now (this order's own reservations count as available). */
  stockedItems: number;
  totalItems: number;
  /** Accepted ÷ (accepted + declined + expired) over the last 30 days; null below 5 offers. */
  acceptanceRate: number | null;
  rating: number | null;
  pricePaise: number | null;
  /** Declined or let this order expire before: never offered again. */
  triedBefore: boolean;
  eligible: boolean;
}

const MIN_SAMPLE = 5;

/** Shops covering the order's PIN, ranked; eligible ones first. */
export async function rankShopsForOrder(
  db: Tx,
  orderId: string,
  locale: CatalogueLocale,
): Promise<RankedShop[]> {
  const rows = rowsOf<{
    shop_id: string;
    name: string;
    name_hi: string | null;
    dist_m: unknown;
    stocked: unknown;
    total: unknown;
    price: unknown;
    rating: unknown;
    accepted: unknown;
    answered: unknown;
    tried: boolean;
  }>(
    await db.execute(sql`
      with o as (select id, pincode from orders where id = ${orderId}),
      items as (select variant_id, qty, unit_paise from order_items where order_id = ${orderId})
      select s.id as shop_id, s.name, s.name_hi,
        st_distance(s.location, (select centroid from pincodes where pincode = o.pincode)) as dist_m,
        -- A shop counts for an item only if it is paid at or below what the customer pays (admin prices, Q26).
        (select count(*) from items i join shop_inventory si on si.variant_id = i.variant_id and si.shop_id = s.id
           and si.active and not si.admin_blocked and si.selling_paise <= i.unit_paise
           and si.on_hand - si.reserved + coalesce((select sum(r.qty) from reservations r
             where r.order_id = o.id and r.status = 'active' and r.inventory_id = si.id), 0) >= i.qty)::int as stocked,
        (select count(*) from items)::int as total,
        (select sum(si.selling_paise * i.qty) from items i join shop_inventory si
           on si.variant_id = i.variant_id and si.shop_id = s.id and si.active) as price,
        s.rating_avg::float8 as rating,
        stats.accepted, stats.answered,
        exists (select 1 from order_assignments a where a.order_id = o.id and a.shop_id = s.id
          and a.status in ('declined', 'expired')) as tried
      from o
      join shop_pincodes sp on sp.pincode = o.pincode and sp.active
      join shops s on s.id = sp.shop_id and s.status = 'approved' and s.gst_status = 'registered'
        and not (s.busy and (s.busy_until is null or s.busy_until > now()))
      left join lateral (
        select count(*) filter (where a.status = 'accepted')::int as accepted,
          count(*) filter (where a.status in ('accepted', 'declined', 'expired'))::int as answered
        from order_assignments a where a.shop_id = s.id and a.offered_at > now() - interval '30 days') stats on true`),
  );
  const ranked = rows.map((r): RankedShop => {
    const total = num(r.total);
    const stocked = num(r.stocked);
    const answered = num(r.answered ?? 0);
    const dist = numOrNull(r.dist_m);
    return {
      shopId: r.shop_id,
      name: localized(r.name, r.name_hi, locale),
      distanceKm: dist === null ? null : Math.round(dist / 100) / 10,
      stockedItems: stocked,
      totalItems: total,
      acceptanceRate: answered >= MIN_SAMPLE ? num(r.accepted ?? 0) / answered : null,
      rating: numOrNull(r.rating),
      pricePaise: stocked === total ? numOrNull(r.price) : null,
      triedBefore: r.tried,
      eligible: !r.tried && stocked === total && total > 0,
    };
  });
  const key = (s: RankedShop) => [
    s.eligible ? 0 : 1,
    s.distanceKm ?? Number.MAX_SAFE_INTEGER,
    -(s.acceptanceRate ?? 0),
    -(s.rating ?? 0),
    s.pricePaise ?? Number.MAX_SAFE_INTEGER,
  ];
  return ranked.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) {
      const d = (ka[i] ?? 0) - (kb[i] ?? 0);
      if (d !== 0) return d;
    }
    return a.shopId.localeCompare(b.shopId);
  });
}

export interface RoutingOrderView {
  code: string;
  status: string;
  version: number;
  pincode: string;
  totalPaise: number;
  items: { sku: string; title: string; qty: number; unitPaise: number }[];
  history: {
    shop: string;
    status: string;
    offeredAt: Date;
    respondedAt: Date | null;
    declineReason: string | null;
  }[];
  shops: RankedShop[];
}

export async function getRoutingOrder(
  db: Tx,
  scope: CityScope,
  code: string,
  locale: CatalogueLocale,
): Promise<RoutingOrderView> {
  const o = await findOrder(db, scope, code);
  const items = rowsOf<{
    sku: string;
    title: string;
    title_hi: string | null;
    qty: unknown;
    unit_paise: unknown;
  }>(
    await db.execute(
      sql`select sku, title, title_hi, qty, unit_paise from order_items where order_id = ${o.id} order by sku`,
    ),
  );
  const history = rowsOf<{
    name: string;
    name_hi: string | null;
    status: string;
    offered_at: string | Date;
    responded_at: string | Date | null;
    decline_reason: string | null;
  }>(
    await db.execute(sql`select s.name, s.name_hi, a.status, a.offered_at, a.responded_at, a.decline_reason
      from order_assignments a join shops s on s.id = a.shop_id where a.order_id = ${o.id} order by a.offered_at`),
  );
  const [total] = rowsOf<{ total_paise: unknown }>(
    await db.execute(sql`select total_paise from orders where id = ${o.id}`),
  );
  return {
    code: o.code,
    status: o.status,
    version: o.version,
    pincode: o.pincode,
    totalPaise: num(total?.total_paise ?? 0),
    items: items.map((i) => ({
      sku: i.sku,
      title: localized(i.title, i.title_hi, locale),
      qty: num(i.qty),
      unitPaise: num(i.unit_paise),
    })),
    history: history.map((h) => ({
      shop: localized(h.name, h.name_hi, locale),
      status: h.status,
      offeredAt: new Date(h.offered_at),
      respondedAt: h.responded_at ? new Date(h.responded_at) : null,
      declineReason: h.decline_reason,
    })),
    shops: ['placed', 'needs_rerouting'].includes(o.status) ? await rankShopsForOrder(db, o.id, locale) : [],
  };
}

/** Move the order's active reservations to `shopId`, reserving anything not yet held there and renewing kept holds. */
async function moveReservations(tx: Tx, orderId: string, shopId: string, ttlMinutes: number): Promise<void> {
  const held = await tx
    .select({
      id: reservations.id,
      qty: reservations.qty,
      shopId: shopInventory.shopId,
      variantId: shopInventory.variantId,
    })
    .from(reservations)
    .innerJoin(shopInventory, eq(shopInventory.id, reservations.inventoryId))
    .where(and(eq(reservations.orderId, orderId), eq(reservations.status, 'active')));
  for (const r of held.filter((h) => h.shopId !== shopId)) await releaseReservation(tx, r.id);
  const keep = new Set(held.filter((h) => h.shopId === shopId).map((h) => h.variantId));
  // Holds kept at this shop must last through the accept window too, or the sweep frees them mid-offer and the
  // accept fails with STOCK_NOT_HELD (review B8). Never shortens a hold.
  const kept = held.filter((h) => h.shopId === shopId).map((h) => h.id);
  if (kept.length > 0)
    await tx
      .update(reservations)
      .set({
        expiresAt: sql`greatest(${reservations.expiresAt}, now() + make_interval(mins => ${ttlMinutes}))`,
      })
      .where(inArray(reservations.id, kept));
  const items = rowsOf<{ variant_id: string; qty: unknown; inventory_id: string | null }>(
    await tx.execute(sql`select i.variant_id, i.qty, si.id as inventory_id from order_items i
      left join shop_inventory si on si.variant_id = i.variant_id and si.shop_id = ${shopId} and si.active
      where i.order_id = ${orderId}`),
  );
  for (const item of items.filter((i) => !keep.has(i.variant_id))) {
    const reserved = item.inventory_id
      ? await reserveStock(tx, { inventoryId: item.inventory_id, orderId, qty: num(item.qty), ttlMinutes })
      : null;
    if (!reserved) throw new ConflictError('That shop no longer has every item in stock', 'OUT_OF_STOCK');
  }
}

/** Cash on delivery, or an online payment that completed (plan 2026-11-12: unpaid orders never reach a shop). */
async function paymentAllowsRouting(tx: Tx, orderId: string): Promise<boolean> {
  const [g] = rowsOf<{ ok: boolean }>(
    await tx.execute(sql`select (g.payment_method = 'cod'
        or g.payment_status in ('paid', 'partially_refunded', 'refunded')) as ok
      from orders o join order_groups g on g.id = o.group_id where o.id = ${orderId}`),
  );
  return g?.ok === true;
}

/** Route (or reroute) to one shop: eligible only; reservations move; accept timer from settings. */
export async function routeOrder(
  db: Tx,
  input: { scope: CityScope; code: string; shopId: string; expectedVersion: number; staffUserId: string },
) {
  return db.transaction(async (tx) => {
    const o = await findOrder(tx, input.scope, input.code, true); // order row first (lockOrder)
    if (o.version !== input.expectedVersion)
      throw new ConflictError('This order changed meanwhile; reload', 'STALE_ORDER');
    if (o.status !== 'placed' && o.status !== 'needs_rerouting')
      throw new ConflictError(`Order is ${o.status}; it cannot be routed now`, 'NOT_ROUTABLE');
    if (!(await paymentAllowsRouting(tx, o.id)))
      throw new ConflictError('This order is waiting for its online payment', 'AWAITING_PAYMENT');
    const shop = (await rankShopsForOrder(tx, o.id, 'en')).find((s) => s.shopId === input.shopId);
    if (!shop?.eligible)
      throw new ConflictError(
        shop?.triedBefore ? 'This shop already declined this order' : 'This shop cannot take this order',
        'SHOP_NOT_ELIGIBLE',
      );
    await moveReservations(
      tx,
      o.id,
      input.shopId,
      await citySetting(tx, o.cityId, ROUTING_SETTINGS.reservationMinutes),
    );
    const timeout = await citySetting(tx, o.cityId, ROUTING_SETTINGS.acceptanceTimeoutMin);
    const assignment = await offerOrderToShop(tx, {
      orderId: o.id,
      shopId: input.shopId,
      expectedOrderVersion: o.version,
      timeoutMinutes: Math.min(timeout, 24 * 60),
      actor: { type: 'admin', userId: input.staffUserId },
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: o.status === 'placed' ? 'order.routed' : 'order.rerouted',
      entity: 'order',
      entityId: o.id,
      after: { shopId: input.shopId, assignmentId: assignment.id, timeoutMinutes: timeout },
    });
    await recordServerEvent(tx, o.status === 'placed' ? 'admin_order_routed' : 'admin_order_rerouted', {
      userId: input.staffUserId,
      cityId: o.cityId,
      props: {
        orderCode: o.code,
        shopId: input.shopId,
        attempt: await tx.$count(orderAssignments, eq(orderAssignments.orderId, o.id)),
      },
    });
    return { assignmentId: assignment.id, expiresAt: assignment.expiresAt };
  });
}

/** Reject with a reason code and the message the customer sees; reservations are released. */
export async function rejectOrder(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    reasonCode: OrderRejectReason;
    message: string;
    expectedVersion: number;
    staffUserId: string;
  },
) {
  if (!ORDER_REJECT_REASONS.includes(input.reasonCode))
    throw new ValidationError('Unknown reason', 'REJECT_REASON');
  const message = input.message.trim();
  if (message.length < 10 || message.length > 500)
    throw new ValidationError('Write a message for the customer (10 to 500 characters)', 'REJECT_MESSAGE');
  return db.transaction(async (tx) => {
    const o = await findOrder(tx, input.scope, input.code, true); // order row first (lockOrder)
    if (o.status !== 'placed' && o.status !== 'needs_rerouting')
      throw new ConflictError(`Order is ${o.status}; only unrouted orders can be rejected`, 'NOT_REJECTABLE');
    const row = await transitionOrder(tx, {
      orderId: o.id,
      from: o.status,
      to: 'rejected',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      patch: { statusReasonCode: input.reasonCode, customerMessage: message },
    });
    const held = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.orderId, o.id), inArray(reservations.status, ['active'])));
    for (const r of held) await releaseReservation(tx, r.id);
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'order.rejected',
      entity: 'order',
      entityId: o.id,
      after: { reasonCode: input.reasonCode },
      reason: input.reasonCode,
    });
    await recordServerEvent(tx, 'admin_order_rejected', {
      userId: input.staffUserId,
      cityId: o.cityId,
      props: { orderCode: o.code, reasonCode: input.reasonCode },
    });
    // Prepaid orders get an automatic refund here once online payment exists (spec 05); COD has nothing to refund.
    return { status: row.status, version: row.version };
  });
}

/**
 * Timer job (worker, every 30 s): expire offers past their DB-clock deadline, one transaction each, so a
 * failure on one never blocks the rest (code review 2026-11-03: one bad row used to stop every timer, because
 * it sorts first on every run). Failures are returned for the worker to log. Concurrent workers are safe
 * (`expireAssignment` is a CAS).
 */
export async function expireDueAssignments(
  db: Tx,
  limit = 50,
): Promise<{ expired: number; failed: { assignmentId: string; error: unknown }[] }> {
  const due = rowsOf<{ id: string }>(
    await db.execute(sql`select id from order_assignments where status = 'offered' and expires_at <= now()
      order by expires_at limit ${limit}`),
  );
  let expired = 0;
  const failed: { assignmentId: string; error: unknown }[] = [];
  for (const a of due) {
    try {
      const done = await db.transaction((tx) => expireAssignment(tx, { assignmentId: a.id }));
      if (done) expired += 1;
    } catch (error) {
      failed.push({ assignmentId: a.id, error });
    }
  }
  return { expired, failed };
}

/**
 * Staff confirm delivery without the customer's code (spec 04: code locked after 5 wrong tries, lost, or the
 * customer unreachable). Order row first (lock order), then the shipment override and the order move in one
 * transaction, audited, with a reason of 5–300 characters. Other cities' orders are 404 (review B2).
 */
export async function overrideOrderDelivery(
  db: Tx,
  input: { scope: CityScope; code: string; reason: string; expectedVersion: number; staffUserId: string },
): Promise<{ status: 'delivered'; version: number }> {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300)
    throw new ValidationError('Give a reason (5 to 300 characters)', 'OVERRIDE_REASON');
  return db.transaction(async (tx) => {
    const o = await findOrder(tx, input.scope, input.code, true);
    if (o.status !== 'out_for_delivery') throw new ConflictError(`Order is ${o.status}`, 'WRONG_STEP');
    const [shipment] = await tx
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.orderId, o.id))
      .limit(1);
    if (!shipment) throw new ConflictError('This order has not been handed over yet', 'NO_SHIPMENT');
    await overrideShipmentInTx(tx, { shipmentId: shipment.id, staffUserId: input.staffUserId, reason });
    const row = await transitionOrder(tx, {
      orderId: o.id,
      from: 'out_for_delivery',
      to: 'delivered',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      patch: { deliveredAt: new Date() },
    });
    await recordServerEvent(tx, 'admin_delivery_override', {
      userId: input.staffUserId,
      cityId: o.cityId,
      props: { orderCode: o.code },
    });
    // Delivered counts include overridden deliveries, like the code path (final review 2026-11-12).
    const [owner] = await tx.select({ shopId: orders.shopId }).from(orders).where(eq(orders.id, o.id));
    if (owner?.shopId)
      await recordServerEvent(tx, 'order_delivered', {
        userId: input.staffUserId,
        cityId: o.cityId,
        props: { orderCode: o.code, shopId: owner.shopId },
      });
    return { status: 'delivered', version: row.version };
  });
}
