import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  COIN_REASON_CODES,
  COIN_REWARD_CANCEL_REASONS,
  COIN_REWARD_SOURCES,
  COIN_REWARD_STATES,
} from '@mechdost/shared/coins';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { orderGroups, orders } from './orders';
import { serviceRequests } from './services';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * MechDost Coins (decision 2026-11-01, spec 20): a loyalty bonus, NOT a wallet. No cash value, not transferable,
 * not purchasable, never cashed out or refunded as money; only redeemed as an order discount. Earning (Q24):
 * `coin_rewards` below, credited to the ledger after the unlock wait.
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
    /** Why, as a code (hard rule 16): reward source, staff reason, or a system code; `reason` keeps the text. */
    reasonCode: text(),
    orderGroupId: uuid().references(() => orderGroups.id, { onDelete: 'restrict' }),
    /** One ledger row per business event: retries and double clicks are no-ops. */
    idemKey: text().notNull().unique(),
    /** For coins added (earned, granted, returned): when they lapse (worker expiry job, first-expiring used first). */
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
    check(
      'coin_ledger_reason_code_valid',
      sql`${t.reasonCode} is null or ${t.reasonCode} in (${inList(COIN_REASON_CODES)})`,
    ),
    check('coin_ledger_reason_length', sql`char_length(${t.reason}) between 3 and 200`),
    check('coin_ledger_idem_key_format', sql`${t.idemKey} ~ '^[A-Za-z0-9:_-]{10,100}$'`),
    index().on(t.userId, t.createdAt),
    index().on(t.orderGroupId),
    index().on(t.createdBy),
    // Admin → Coins recent activity (newest first, keyset on created_at, id).
    index().on(t.createdAt, t.id),
    // The expiry job finds lots that lapsed recently.
    index('coin_ledger_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null and ${t.delta} > 0`),
  ],
);

/**
 * Coins on the way (Q24, user 2026-11-13): a reward waits `coins.unlock_days` after it is earned (delivery, a paid
 * workshop booking), then the worker credits it to the ledger once (`reward:<id>` key) — or it is cancelled when its
 * order is cancelled or refunded first. One reward per source event (unique indexes), one first-order bonus per
 * customer. Status changes are compare-and-set on (status, version).
 */
export const coinRewards = pgTable(
  'coin_rewards',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: text().notNull(),
    coins: integer().notNull(),
    status: text().notNull().default('pending'),
    /** When the coins become usable (the worker credits them from then). */
    availableAt: ts().notNull(),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    serviceRequestId: uuid().references(() => serviceRequests.id, { onDelete: 'restrict' }),
    /** The ledger row that credited it (status credited). */
    ledgerId: uuid().references(() => coinLedger.id, { onDelete: 'restrict' }),
    cancelReasonCode: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('coin_rewards_source_valid', sql`${t.source} in (${inList(COIN_REWARD_SOURCES)})`),
    check('coin_rewards_status_valid', sql`${t.status} in (${inList(COIN_REWARD_STATES)})`),
    check('coin_rewards_coins_positive', sql`${t.coins} > 0 and ${t.coins} <= 1000000`),
    check('coin_rewards_credited_has_ledger', sql`(${t.status} = 'credited') = (${t.ledgerId} is not null)`),
    check(
      'coin_rewards_cancel_reason',
      sql`(${t.status} = 'cancelled') = (${t.cancelReasonCode} is not null) and (${t.cancelReasonCode} is null or ${t.cancelReasonCode} in (${inList(COIN_REWARD_CANCEL_REASONS)}))`,
    ),
    check(
      'coin_rewards_has_source_ref',
      sql`case ${t.source} when 'workshop_booking' then ${t.serviceRequestId} is not null else ${t.orderId} is not null end`,
    ),
    uniqueIndex('coin_rewards_order_source_uq')
      .on(t.source, t.orderId)
      .where(sql`${t.orderId} is not null`),
    uniqueIndex('coin_rewards_service_uq')
      .on(t.serviceRequestId)
      .where(sql`${t.serviceRequestId} is not null`),
    uniqueIndex('coin_rewards_first_order_uq')
      .on(t.userId)
      .where(sql`${t.source} = 'first_order'`),
    index().on(t.status, t.availableAt),
    index().on(t.userId, t.createdAt),
    index().on(t.orderId),
    index().on(t.ledgerId),
  ],
);
