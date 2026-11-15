import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { SHOP_PAYOUT_ENTRY_KINDS } from '@mechdost/shared/coins';
import { createdAt, id, paise } from './_common';
import { shops } from './catalogue';
import { orders } from './orders';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * What MechDost owes a shop, one append-only row per business event (code review 2026-11-14; user: "show line +
 * payout ledger"). Today: `coin_discount` — the MechDost Coins discount on a delivered sub-order, which the shop did
 * not collect from the customer. Written in the delivery transaction, once per order (unique idempotency key);
 * corrections are new rows, never edits (trigger). Weekly payouts (Q11) read from here when they are built.
 */
export const shopPayoutEntries = pgTable(
  'shop_payout_entries',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    /** Owed to the shop, integer paise. */
    amountPaise: paise().notNull(),
    idemKey: text().notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check('shop_payout_entries_kind_valid', sql`${t.kind} in (${inList(SHOP_PAYOUT_ENTRY_KINDS)})`),
    check('shop_payout_entries_amount_positive', sql`${t.amountPaise} > 0`),
    check(
      'shop_payout_entries_order_kind',
      sql`${t.kind} not in ('coin_discount','coupon_discount') or ${t.orderId} is not null`,
    ),
    index().on(t.shopId, t.createdAt, t.id),
    index().on(t.orderId),
    index().on(t.createdAt, t.id),
  ],
);
