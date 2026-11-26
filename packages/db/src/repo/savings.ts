import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  savingsBreakdown,
  savingsPeriodBounds,
  savingsReversal,
  type SavingsBreakdown,
  type SavingsPeriod,
} from '@mechdost/shared/savings';
import {
  auditLog,
  customerSavingsEntries,
  customerSavingsLines,
  orderGroups,
  orderItems,
  orders,
  refunds,
} from '../schema';
import { NotFoundError } from './errors';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * "Your savings" (shopping personalisation phase 4; decision 2026-11-26; spec 14 "Savings ledger"). The ledger is
 * derived from facts already on the order (the MRP and waived-delivery snapshots, the coupon and Coins columns) and
 * from processed refunds, so one idempotent `syncOrderSavings` serves every caller: the delivered transition, a
 * processed refund, a catch-up run. It takes a transaction-scoped advisory lock on the order as its LAST lock (the
 * deliver path holds order → group, the refund path group → payment), then writes only what is missing: partial
 * unique indexes plus ON CONFLICT DO NOTHING make a duplicate write impossible, never a read-then-write race.
 */

interface OrderFacts {
  id: string;
  userId: string;
  cityId: string;
  status: string;
  deliveredAt: Date | null;
  totalPaise: number;
  couponDiscountPaise: number;
  coinDiscountPaise: number;
  deliveryWaivedPaise: number;
}

async function breakdownOf(tx: Tx, o: OrderFacts): Promise<SavingsBreakdown> {
  const items = await tx
    .select({
      id: orderItems.id,
      qty: orderItems.qty,
      unitPaise: orderItems.unitPaise,
      mrpPaise: orderItems.mrpPaise,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, o.id))
    .orderBy(asc(orderItems.id));
  return savingsBreakdown({
    lines: items.map((i) => ({ itemId: i.id, qty: i.qty, unitPaise: i.unitPaise, mrpPaise: i.mrpPaise })),
    couponPaise: o.couponDiscountPaise,
    coinsPaise: o.coinDiscountPaise,
    deliveryWaivedPaise: o.deliveryWaivedPaise,
  });
}

const factColumns = {
  id: orders.id,
  userId: orders.userId,
  cityId: orders.cityId,
  status: orders.status,
  deliveredAt: orders.deliveredAt,
  totalPaise: orders.totalPaise,
  couponDiscountPaise: orders.couponDiscountPaise,
  coinDiscountPaise: orders.coinDiscountPaise,
  deliveryWaivedPaise: orders.deliveryWaivedPaise,
};

async function insertEntry(
  tx: Tx,
  o: OrderFacts,
  b: SavingsBreakdown,
  e: { kind: 'delivered' | 'refund'; refundId: string | null; refundPaise: number; periodAt: Date },
): Promise<boolean> {
  const [row] = await tx
    .insert(customerSavingsEntries)
    .values({
      userId: o.userId,
      orderId: o.id,
      refundId: e.refundId,
      cityId: o.cityId,
      kind: e.kind,
      mrpPaise: b.mrpPaise,
      couponPaise: b.couponPaise,
      coinsPaise: b.coinsPaise,
      deliveryPaise: b.deliveryPaise,
      totalPaise: b.totalPaise,
      refundPaise: e.refundPaise,
      countedLines: b.countedLines,
      excludedLines: b.excludedLines,
      periodAt: e.periodAt,
    })
    .onConflictDoNothing()
    .returning({ id: customerSavingsEntries.id });
  if (!row) return false;
  if (b.lines.length > 0)
    await tx
      .insert(customerSavingsLines)
      .values(
        b.lines.map((l) => ({ entryId: row.id, orderItemId: l.itemId, mrpSavingPaise: l.mrpSavingPaise })),
      );
  return true;
}

/** Write whatever is missing for one sub-order: its `delivered` row, then one reversal per processed refund. */
export async function syncOrderSavings(tx: Tx, orderId: string): Promise<{ written: number }> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('customer_savings'), hashtext(${orderId}::text))`,
  );
  const [o] = await tx.select(factColumns).from(orders).where(eq(orders.id, orderId));
  if (o?.status !== 'delivered') return { written: 0 };
  const b = await breakdownOf(tx, o);
  let written = 0;
  if (
    await insertEntry(tx, o, b, {
      kind: 'delivered',
      refundId: null,
      refundPaise: 0,
      periodAt: o.deliveredAt ?? new Date(),
    })
  )
    written += 1;
  const [delivered] = await tx
    .select({ periodAt: customerSavingsEntries.periodAt })
    .from(customerSavingsEntries)
    .where(and(eq(customerSavingsEntries.orderId, orderId), eq(customerSavingsEntries.kind, 'delivered')));
  if (!delivered) return { written };
  const done = await tx
    .select({ refundId: customerSavingsEntries.refundId, refundPaise: customerSavingsEntries.refundPaise })
    .from(customerSavingsEntries)
    .where(and(eq(customerSavingsEntries.orderId, orderId), eq(customerSavingsEntries.kind, 'refund')));
  const reversed = new Set(done.map((d) => d.refundId));
  let prior = done.reduce((a, d) => a + d.refundPaise, 0);
  const processed = await tx
    .select({ id: refunds.id, amountPaise: refunds.amountPaise })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), eq(refunds.status, 'processed')))
    .orderBy(asc(refunds.settledAt), asc(refunds.id));
  for (const r of processed) {
    if (reversed.has(r.id)) continue;
    const rev = savingsReversal(b, {
      priorRefundedPaise: prior,
      refundPaise: r.amountPaise,
      orderTotalPaise: o.totalPaise,
    });
    if (
      await insertEntry(tx, o, rev, {
        kind: 'refund',
        refundId: r.id,
        refundPaise: r.amountPaise,
        periodAt: delivered.periodAt,
      })
    )
      written += 1;
    prior += r.amountPaise;
  }
  return { written };
}

/**
 * The hook the delivered transition and a processed refund call: a savepoint, so a savings bug can never undo a
 * delivery or a settled refund. A failure leaves an audit alert; the next sync for the order repairs it.
 */
export async function syncOrderSavingsSafely(tx: Tx, orderId: string): Promise<void> {
  try {
    await tx.transaction((sp) => syncOrderSavings(sp, orderId));
  } catch {
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'savings.alert.not_written',
      entity: 'order',
      entityId: orderId,
    });
  }
}

export interface SavingsTotals {
  mrpPaise: number;
  couponPaise: number;
  coinsPaise: number;
  deliveryPaise: number;
  totalPaise: number;
}

export interface MySavings extends SavingsTotals {
  period: SavingsPeriod;
  /** YYYY-MM (month) or YYYY (year), IST. */
  label: string;
  from: Date;
  to: Date;
  /** Delivered sub-orders counted in the period. */
  orders: number;
  /** Lines left out because no printed MRP was recorded. */
  excludedLines: number;
}

/** The customer's savings in the IST month or year containing `now`, net of refunds (by delivery time). */
export async function mySavings(
  db: Tx,
  userId: string,
  input: { period: SavingsPeriod; now: Date },
): Promise<MySavings> {
  const { from, to, label } = savingsPeriodBounds(input.period, input.now);
  const [r] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      select coalesce(sum(mrp_paise), 0) as mrp, coalesce(sum(coupon_paise), 0) as coupon,
        coalesce(sum(coins_paise), 0) as coins, coalesce(sum(delivery_paise), 0) as delivery,
        coalesce(sum(total_paise), 0) as total,
        count(*) filter (where kind = 'delivered') as orders,
        coalesce(sum(excluded_lines) filter (where kind = 'delivered'), 0) as excluded
      from customer_savings_entries
      where user_id = ${userId} and period_at >= ${from.toISOString()}::timestamptz
        and period_at < ${to.toISOString()}::timestamptz`),
  );
  return {
    period: input.period,
    label,
    from,
    to,
    mrpPaise: num(r?.mrp ?? 0),
    couponPaise: num(r?.coupon ?? 0),
    coinsPaise: num(r?.coins ?? 0),
    deliveryPaise: num(r?.delivery ?? 0),
    totalPaise: num(r?.total ?? 0),
    orders: num(r?.orders ?? 0),
    excludedLines: num(r?.excluded ?? 0),
  };
}

export interface OrderSavingsView extends SavingsTotals {
  /** `final` = every live part delivered (ledger, net of refunds); `estimate` = some part still on its way; `none`. */
  status: 'final' | 'estimate' | 'none';
  excludedLines: number;
  /** A refund reduced the saving. */
  refunded: boolean;
}

/**
 * Savings on one order the customer owns, by checkout code or one part's code (anything else is 404, rule 3).
 * Delivered parts read the ledger; parts still on their way are estimated from their own snapshot.
 */
export async function orderSavingsForCustomer(
  db: Tx,
  userId: string,
  code: string,
): Promise<OrderSavingsView> {
  const subs = await db
    .select(factColumns)
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .where(and(eq(orders.userId, userId), or(eq(orders.code, code), eq(orderGroups.code, code))));
  if (subs.length === 0) throw new NotFoundError('Order not found');
  const live = subs.filter((o) => o.status !== 'cancelled' && o.status !== 'rejected');
  const out: OrderSavingsView = {
    status: 'none',
    mrpPaise: 0,
    couponPaise: 0,
    coinsPaise: 0,
    deliveryPaise: 0,
    totalPaise: 0,
    excludedLines: 0,
    refunded: false,
  };
  const add = (b: SavingsTotals) => {
    out.mrpPaise += b.mrpPaise;
    out.couponPaise += b.couponPaise;
    out.coinsPaise += b.coinsPaise;
    out.deliveryPaise += b.deliveryPaise;
    out.totalPaise += b.totalPaise;
  };
  const delivered = live.filter((o) => o.status === 'delivered').map((o) => o.id);
  const rows =
    delivered.length === 0
      ? []
      : await db
          .select()
          .from(customerSavingsEntries)
          .where(inArray(customerSavingsEntries.orderId, delivered));
  let anyFinal = false;
  let anyOnTheWay = false;
  for (const o of live) {
    const mine = rows.filter((r) => r.orderId === o.id);
    if (o.status === 'delivered') {
      // Delivered: only the ledger counts. A part delivered before the ledger existed (migration 0101) has no row
      // and shows nothing, never an "estimate" on a delivered order.
      if (!mine.some((r) => r.kind === 'delivered')) continue;
      anyFinal = true;
      for (const r of mine) {
        add(r);
        if (r.kind === 'delivered') out.excludedLines += r.excludedLines;
        else out.refunded = true;
      }
    } else {
      // On its way: the honest estimate from this part's own snapshot.
      anyOnTheWay = true;
      const b = await breakdownOf(db, o);
      add(b);
      out.excludedLines += b.excludedLines;
    }
  }
  out.status = anyOnTheWay ? 'estimate' : anyFinal ? 'final' : 'none';
  return out;
}

/**
 * Daily price history (design 2026-11-25, Consumer Protection E-Commerce amendment from 1 Jan 2027): per live pack and
 * live city, the printed MRP and the lowest customer price among live listings (admin city price, else the shop's;
 * MechDost never sells below what a shop is paid). One row per IST day; a second run that day writes nothing.
 */
export async function recordDailyPrices(db: Tx, day: string): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError(`Invalid day: ${day}`);
  const rows = rowsOf<{ variant_id: string }>(
    await db.execute(sql`
      insert into variant_price_daily (day, variant_id, city_id, mrp_paise, min_price_paise, offers)
      select ${day}::date, v.id, s.city_id, v.mrp_paise,
        min(coalesce(ap.selling_paise, si.selling_paise)), count(*)::int
      from shop_inventory si
      join product_variants v on v.id = si.variant_id and v.status = 'active'
      join shops s on s.id = si.shop_id and s.status = 'approved'
      join cities c on c.id = s.city_id and c.status = 'live'
      left join admin_prices ap on ap.variant_id = v.id and ap.city_id = s.city_id and ap.pincode is null
      where si.active and not si.admin_blocked
        and si.selling_paise <= coalesce(ap.selling_paise, si.selling_paise)
      group by v.id, s.city_id, v.mrp_paise
      on conflict do nothing
      returning variant_id`),
  );
  return rows.length;
}
