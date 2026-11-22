import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  BUSINESS_APPLICATION_KINDS,
  FLEET_NEEDS,
  TRADE_BUSINESS_TYPES,
  TRADE_REVOKE_REASONS,
  TRADE_SPEND_BANDS,
} from '@mechdost/shared/business-codes';
import { APPLICATION_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import { BUSINESS_APPLICATION_STATES, TRADE_ACCOUNT_STATES } from '@mechdost/shared/state';
import { citext, createdAt, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Trade account and fleet applications (audience entry design 2026-11-22, item 3). One table for both kinds:
 * - `trade`: sent signed in (`user_id` is the account that gets verified); business, GSTIN (public identifier,
 *   optional, checksum-checked in the API), spend band, categories bought (category slugs);
 * - `fleet`: a lead (`user_id` null when signed out); company, vehicles by type, needs (codes), optional note.
 * Contact is a snapshot (the account's at the time, or the enquiry's). Status moves only through
 * `businessApplicationMachine` as conditional UPDATEs on `(status, version)`.
 */
export const businessApplications = pgTable(
  'business_applications',
  {
    id: id(),
    code: text().notNull().unique(),
    kind: text().notNull(),
    status: text().notNull().default('new'),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    pincode: text().notNull(),
    contactName: text().notNull(),
    contactPhone: text(),
    contactEmail: citext(),
    businessName: text().notNull(),
    businessType: text(),
    gstin: text(),
    spendBand: text(),
    categories: text().array(),
    fleet2w: integer(),
    fleet3w: integer(),
    fleet4w: integer(),
    needs: text().array(),
    note: text(),
    /** Why staff rejected (`APPLICATION_REJECT_REASONS`); null otherwise. */
    reasonCode: text(),
    reviewNote: text(),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts(),
    consentAt: ts().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('business_applications_kind_valid', sql`${t.kind} in (${inList(BUSINESS_APPLICATION_KINDS)})`),
    check('business_applications_status_valid', sql`${t.status} in (${inList(BUSINESS_APPLICATION_STATES)})`),
    check('business_applications_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check(
      'business_applications_phone',
      sql`${t.contactPhone} is null or ${t.contactPhone} ~ '^\\+91[6-9][0-9]{9}$'`,
    ),
    check(
      'business_applications_gstin',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    // A trade application belongs to an account and is decided; a fleet enquiry is only reviewed and closed.
    check(
      'business_applications_trade_shape',
      sql`${t.kind} <> 'trade' or (${t.userId} is not null and ${t.businessType} is not null
        and ${t.businessType} in (${inList(TRADE_BUSINESS_TYPES)}) and ${t.spendBand} is not null
        and ${t.spendBand} in (${inList(TRADE_SPEND_BANDS)}) and ${t.categories} is not null
        and cardinality(${t.categories}) between 1 and 30
        and ${t.status} <> 'closed' and ${t.fleet2w} is null and ${t.needs} is null)`,
    ),
    check(
      'business_applications_fleet_shape',
      sql`${t.kind} <> 'fleet' or (${t.contactPhone} is not null and ${t.contactEmail} is not null
        and ${t.fleet2w} is not null and ${t.fleet3w} is not null and ${t.fleet4w} is not null
        and ${t.fleet2w} >= 0 and ${t.fleet3w} >= 0 and ${t.fleet4w} >= 0
        and ${t.fleet2w} + ${t.fleet3w} + ${t.fleet4w} > 0
        and ${t.needs} is not null and cardinality(${t.needs}) >= 1
        and ${t.needs} <@ array[${inList(FLEET_NEEDS)}]::text[]
        and ${t.status} in ('new','in_review','closed') and ${t.businessType} is null and ${t.categories} is null)`,
    ),
    check(
      'business_applications_reason_valid',
      sql`(${t.status} = 'rejected') = (${t.reasonCode} is not null)
        and (${t.reasonCode} is null or ${t.reasonCode} in (${inList(APPLICATION_REJECT_REASONS)}))`,
    ),
    // One open trade application per account (a second one while the first waits is refused, never stacked).
    uniqueIndex('business_applications_one_open_trade_uq')
      .on(t.userId)
      .where(sql`${t.kind} = 'trade' and ${t.status} in ('new','in_review')`),
    index().on(t.status, t.kind, t.createdAt, t.id),
    index().on(t.cityId, t.createdAt, t.id),
    index().on(t.userId),
    index().on(t.reviewedBy),
    index().on(t.createdBy),
  ],
);

/** Append-only history of one application (submitted, moved, decided). */
export const businessApplicationEvents = pgTable(
  'business_application_events',
  {
    id: id(),
    applicationId: uuid()
      .notNull()
      .references(() => businessApplications.id, { onDelete: 'restrict' }),
    fromStatus: text(),
    toStatus: text().notNull(),
    reasonCode: text(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'business_application_events_status_valid',
      sql`${t.toStatus} in (${inList(BUSINESS_APPLICATION_STATES)})`,
    ),
    index().on(t.applicationId, t.createdAt),
    index().on(t.actorUserId),
  ],
);

/**
 * A customer's trade account (one per user): verified when staff approve a trade application, `revoked` when staff
 * take it back with a reason code (history in `trade_account_events`), restorable. Pricing plugs in later (Q203);
 * today it shows a badge and pre-fills the optional buyer GSTIN at checkout.
 */
export const tradeAccounts = pgTable(
  'trade_accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text().notNull(),
    businessName: text().notNull(),
    businessType: text().notNull(),
    gstin: text(),
    applicationId: uuid().references(() => businessApplications.id, { onDelete: 'set null' }),
    verifiedAt: ts(),
    revokedAt: ts(),
    /** The last revoke's reason (`TRADE_REVOKE_REASONS`); null while verified. */
    reasonCode: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('trade_accounts_status_valid', sql`${t.status} in (${inList(TRADE_ACCOUNT_STATES)})`),
    check('trade_accounts_type_valid', sql`${t.businessType} in (${inList(TRADE_BUSINESS_TYPES)})`),
    check(
      'trade_accounts_gstin',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check(
      'trade_accounts_reason_valid',
      sql`(${t.status} = 'revoked') = (${t.reasonCode} is not null)
        and (${t.reasonCode} is null or ${t.reasonCode} in (${inList(TRADE_REVOKE_REASONS)}))`,
    ),
    index().on(t.status),
    index().on(t.applicationId),
    index().on(t.createdBy),
  ],
);

/** Append-only: `trade_account_verified` (also a restore) and `trade_account_revoked`, who and why. */
export const tradeAccountEvents = pgTable(
  'trade_account_events',
  {
    id: id(),
    tradeAccountId: uuid()
      .notNull()
      .references(() => tradeAccounts.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    event: text().notNull(),
    reasonCode: text(),
    applicationId: uuid().references(() => businessApplications.id, { onDelete: 'set null' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'trade_account_events_event_valid',
      sql`${t.event} in ('trade_account_verified','trade_account_revoked')`,
    ),
    index().on(t.tradeAccountId, t.createdAt),
    index().on(t.userId),
    index().on(t.applicationId),
    index().on(t.actorUserId),
  ],
);
