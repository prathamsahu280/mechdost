import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { RECO_LABEL_MAX, RECO_PRIORITY_MAX } from '@mechdost/shared/recommendation-limits';
import { EXPORT_MAX_BYTES, EXPORT_STATES } from '@mechdost/shared/privacy-api';
import { WAITLIST_STATES } from '@mechdost/shared/waitlist';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { categories, products } from './catalogue';
import { users } from './identity';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Admin recommendation rules (spec 11, design 2026-11-15 item 4): "when a customer looks at / carries a product of
 * the trigger category (or a sub-category of it), suggest products of the suggested category". Both languages for the
 * reason shown (hard rule 10).
 */
export const recommendationRules = pgTable(
  'recommendation_rules',
  {
    id: id(),
    triggerCategoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    suggestCategoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    labelHi: text().notNull(),
    priority: smallint().notNull().default(10),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('recommendation_rules_pair_uq').on(t.triggerCategoryId, t.suggestCategoryId),
    check('recommendation_rules_distinct', sql`${t.triggerCategoryId} <> ${t.suggestCategoryId}`),
    check(
      'recommendation_rules_label_len',
      sql`char_length(${t.label}) between 2 and ${sql.raw(String(RECO_LABEL_MAX))} and char_length(${t.labelHi}) between 2 and ${sql.raw(String(RECO_LABEL_MAX))}`,
    ),
    check('recommendation_rules_label_hi_script', sql`${t.labelHi} ~ '[ऀ-ॿ]'`),
    check(
      'recommendation_rules_priority_range',
      sql`${t.priority} between 1 and ${sql.raw(String(RECO_PRIORITY_MAX))}`,
    ),
    index('recommendation_rules_suggest_idx').on(t.suggestCategoryId),
    index('recommendation_rules_created_by_idx').on(t.createdBy),
    index('recommendation_rules_active_trigger_idx')
      .on(t.triggerCategoryId, t.priority)
      .where(sql`active`),
  ],
);

/**
 * "Bought together" counts (spec 11): products (not packs) that appeared in the same order group of delivered
 * orders, at least `RECO_MIN_SUPPORT` times. Derived data rebuilt nightly by the worker in one transaction; both
 * directions are stored. Holds ids and counts only, never who bought (hard rule 16).
 */
export const copurchasePairs = pgTable(
  'copurchase_pairs',
  {
    aProductId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    bProductId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    pairCount: integer().notNull(),
    computedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.aProductId, t.bProductId] }),
    check('copurchase_pairs_distinct', sql`${t.aProductId} <> ${t.bProductId}`),
    check('copurchase_pairs_count_positive', sql`${t.pairCount} >= 1`),
    index('copurchase_pairs_a_count_idx').on(t.aProductId, t.pairCount.desc()),
    index('copurchase_pairs_b_idx').on(t.bProductId),
  ],
);

/**
 * A customer's request to download their data (DPDP; design 2026-11-15 item 6). The worker builds the JSON into
 * `payload` (at most `EXPORT_MAX_BYTES`), it is downloadable by its owner until `expires_at`, then the worker clears
 * it. One active (requested or ready) export per person.
 */
export const dataExportRequests = pgTable(
  'data_export_requests',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text().notNull().default('requested'),
    payload: jsonb(),
    payloadBytes: integer(),
    readyAt: ts(),
    expiresAt: ts(),
    downloadedAt: ts(),
    /** Failure reason code (`too_large`, `build_error`); never text from the data. */
    errorCode: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('data_export_status_valid', sql`${t.status} in (${inList(EXPORT_STATES)})`),
    check(
      'data_export_ready_has_payload',
      sql`(${t.status} = 'ready') = (${t.payload} is not null) and (${t.status} <> 'ready' or (${t.expiresAt} is not null and ${t.readyAt} is not null))`,
    ),
    check(
      'data_export_size_bounded',
      sql`${t.payloadBytes} is null or ${t.payloadBytes} between 1 and ${sql.raw(String(EXPORT_MAX_BYTES))}`,
    ),
    uniqueIndex('data_export_one_active_uq')
      .on(t.userId)
      .where(sql`${t.status} in ('requested','ready')`),
    index('data_export_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('data_export_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'ready'`),
    index('data_export_requested_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'requested'`),
  ],
);

/**
 * "Notify me" waitlist for a PIN code that is not served yet (spec 15, design 2026-11-15 item 7). One row per
 * (signed-in customer, PIN); no contact data is copied here, the notice goes to the account. The PIN need not be in
 * `pincodes` (people ask about places MechDost has not even listed).
 */
export const pincodeWaitlist = pgTable(
  'pincode_waitlist',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pincode: text().notNull(),
    status: text().notNull().default('waiting'),
    notifiedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pincode_waitlist_user_pin_uq').on(t.userId, t.pincode),
    check('pincode_waitlist_pin_format', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('pincode_waitlist_status_valid', sql`${t.status} in (${inList(WAITLIST_STATES)})`),
    check('pincode_waitlist_notified', sql`(${t.status} = 'notified') = (${t.notifiedAt} is not null)`),
    index('pincode_waitlist_pin_status_idx').on(t.pincode, t.status),
    index('pincode_waitlist_waiting_idx')
      .on(t.pincode)
      .where(sql`${t.status} = 'waiting'`),
  ],
);
