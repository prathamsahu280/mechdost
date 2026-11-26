import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { SAVINGS_ENTRY_KINDS } from '@mechdost/shared/savings';
import { createdAt, paise, ts } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { productVariants } from './catalogue';
import { orderItems, orders, refunds } from './orders';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * "Your savings" ledger (shopping personalisation phase 4, decision 2026-11-26; spec 14 "Savings ledger"). Append-only
 * (`forbid_update_delete` trigger): one `delivered` row when a sub-order is delivered, one `refund` row (negative
 * amounts) per processed refund on it. Each component in integer paise: the printed-MRP saving, the coupon, the
 * redeemed Coins, the waived delivery fee. Written only by `syncOrderSavings` (advisory lock per order, partial unique
 * indexes, ON CONFLICT DO NOTHING), never read-then-write. `period_at` is the order's delivery time, so a refund in a
 * later month reduces the month the saving was counted in (no negative months). Deny-all RLS: the API is the reader.
 */
export const customerSavingsEntries = pgTable(
  'customer_savings_entries',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    refundId: uuid().references(() => refunds.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    mrpPaise: paise().notNull(),
    couponPaise: paise().notNull(),
    coinsPaise: paise().notNull(),
    deliveryPaise: paise().notNull(),
    totalPaise: paise().notNull(),
    /** The refund's amount on a `refund` row (the telescoping sum of earlier refunds reads it); 0 on `delivered`. */
    refundPaise: paise().notNull().default(0),
    countedLines: smallint().notNull(),
    excludedLines: smallint().notNull(),
    /** The order's delivery time (UTC): the period this saving belongs to, also for its refunds. */
    periodAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('customer_savings_entries_kind_valid', sql`${t.kind} in (${inList(SAVINGS_ENTRY_KINDS)})`),
    check('customer_savings_entries_refund_set', sql`(${t.kind} = 'refund') = (${t.refundId} is not null)`),
    check(
      'customer_savings_entries_total',
      sql`${t.totalPaise} = ${t.mrpPaise} + ${t.couponPaise} + ${t.coinsPaise} + ${t.deliveryPaise}`,
    ),
    check(
      'customer_savings_entries_sign',
      sql`case ${t.kind}
        when 'delivered' then ${t.mrpPaise} >= 0 and ${t.couponPaise} >= 0 and ${t.coinsPaise} >= 0 and ${t.deliveryPaise} >= 0 and ${t.refundPaise} = 0
        else ${t.mrpPaise} <= 0 and ${t.couponPaise} <= 0 and ${t.coinsPaise} <= 0 and ${t.deliveryPaise} <= 0 and ${t.refundPaise} > 0 end`,
    ),
    check('customer_savings_entries_lines_nonneg', sql`${t.countedLines} >= 0 and ${t.excludedLines} >= 0`),
    // Idempotency: one delivered row per sub-order, one reversal per refund.
    uniqueIndex('customer_savings_entries_delivered_once')
      .on(t.orderId)
      .where(sql`${t.kind} = 'delivered'`),
    uniqueIndex('customer_savings_entries_refund_once').on(t.refundId),
    // "This month / this year": a customer's rows in a period window.
    index('customer_savings_entries_user_period_idx').on(t.userId, t.periodAt),
    index().on(t.orderId),
    index().on(t.cityId),
  ],
);

/** Per-line detail of a ledger row (rule 16: a foreign key per line, not a JSON blob). Append-only. */
export const customerSavingsLines = pgTable(
  'customer_savings_lines',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entryId: bigint({ mode: 'number' })
      .notNull()
      .references(() => customerSavingsEntries.id, { onDelete: 'restrict' }),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    mrpSavingPaise: paise().notNull(),
  },
  (t) => [unique().on(t.entryId, t.orderItemId), index().on(t.orderItemId)],
);

/**
 * Daily price history per pack and city (design 2026-11-25 "from 1 Jan 2027 … start recording daily price history
 * now"): the printed MRP and the lowest customer price on offer that IST day, written once a day by the worker
 * (`ON CONFLICT DO NOTHING`; rows are never updated). The basis for any future "lowest price in the last N days" claim.
 */
export const variantPriceDaily = pgTable(
  'variant_price_daily',
  {
    /** IST calendar day. */
    day: date({ mode: 'string' }).notNull(),
    /** Cascade: removing a pack (only demo data is ever deleted; live packs are archived) takes its history along. */
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    mrpPaise: paise(),
    /** Lowest customer price (admin city price, else the shop's) among live listings; null = nobody sells it. */
    minPricePaise: paise(),
    /** Live listings counted. */
    offers: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.variantId, t.cityId] }),
    check(
      'variant_price_daily_amounts',
      sql`(${t.mrpPaise} is null or ${t.mrpPaise} >= 0) and (${t.minPricePaise} is null or ${t.minPricePaise} >= 0) and ${t.offers} >= 0`,
    ),
    index().on(t.variantId, t.day),
    index().on(t.cityId),
  ],
);
