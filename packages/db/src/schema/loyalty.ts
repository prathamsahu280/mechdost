import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { orderGroups } from './orders';

/**
 * MechDost Coins (decision 2026-11-01, spec 20): a loyalty bonus, NOT a wallet. No cash value, not transferable,
 * not purchasable, never cashed out or refunded as money; only redeemed as an order discount. Earning rules come
 * later (inbox Q24); the ledger supports any of them.
 *
 * Integrity: the balance changes only by compare-and-set (`balance >= n`), CHECK keeps it non-negative, and every
 * change is one append-only ledger row with a unique idempotency key (no double credit, no double spend).
 */
export const coinAccounts = pgTable(
  'coin_accounts',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    balance: integer().notNull().default(0),
    lifetimeEarned: integer().notNull().default(0),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('coin_accounts_balance_nonneg', sql`${t.balance} >= 0`),
    check('coin_accounts_lifetime_nonneg', sql`${t.lifetimeEarned} >= 0`),
  ],
);

export const COIN_ENTRY_KINDS = ['earn', 'redeem', 'restore', 'expire', 'adjust'] as const;

export const coinLedger = pgTable(
  'coin_ledger',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Positive = coins added (earn, restore, adjust up); negative = coins used or removed. */
    delta: integer().notNull(),
    kind: text().notNull(),
    reason: text().notNull(),
    orderGroupId: uuid().references(() => orderGroups.id, { onDelete: 'restrict' }),
    /** One ledger row per business event: retries and double clicks are no-ops. */
    idemKey: text().notNull().unique(),
    /** For earned coins: when they lapse (expiry job, P1). */
    expiresAt: ts(),
    /** Staff member for manual adjustments; null for system events. */
    createdBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('coin_ledger_delta_nonzero', sql`${t.delta} <> 0`),
    check('coin_ledger_kind_valid', sql`${t.kind} in ('earn','redeem','restore','expire','adjust')`),
    check(
      'coin_ledger_sign_matches_kind',
      sql`(${t.kind} in ('earn','restore') and ${t.delta} > 0) or (${t.kind} in ('redeem','expire') and ${t.delta} < 0) or ${t.kind} = 'adjust'`,
    ),
    check(
      'coin_ledger_redeem_has_order',
      sql`${t.kind} not in ('redeem','restore') or ${t.orderGroupId} is not null`,
    ),
    check('coin_ledger_adjust_has_staff', sql`${t.kind} <> 'adjust' or ${t.createdBy} is not null`),
    check('coin_ledger_reason_length', sql`char_length(${t.reason}) between 3 and 200`),
    check('coin_ledger_idem_key_format', sql`${t.idemKey} ~ '^[A-Za-z0-9:_-]{10,100}$'`),
    index().on(t.userId, t.createdAt),
    index().on(t.orderGroupId),
    index().on(t.createdBy),
  ],
);
