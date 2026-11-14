import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  QUOTE_DECLINE_REASONS,
  QUOTE_EXPIRE_REASONS,
  QUOTE_OFFER_STATES,
  QUOTE_STATES,
  QUOTE_WITHDRAW_REASONS,
} from '@mechdost/shared/state';
import { createdAt, id, paise, ts, updatedAt, version } from './_common';
import { cities, pincodes } from './geography';
import { users } from './identity';
import { products, productVariants } from './catalogue';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Bulk quotes (spec 19): a customer asks for a bulk price, MechDost staff negotiate in a thread and send versioned
 * offers; accepting the active offer creates a normal order (`order_groups.quote_id` / `quote_offer_id`, one per
 * quote). Status follows `quoteMachine` as compare-and-set on (id, status, version); lines, messages and events are
 * append-only snapshots.
 */
export const quoteRequests = pgTable(
  'quote_requests',
  {
    id: id(),
    code: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    pincode: text()
      .notNull()
      .references(() => pincodes.pincode, { onDelete: 'restrict' }),
    /** Delivery contact and address snapshot (contactName, contactPhone, line1, landmark, pincode). */
    shippingAddress: jsonb().notNull(),
    status: text().notNull().default('open'),
    /** Why it closed: a decline, withdraw or expiry code matching the status. */
    statusReasonCode: text(),
    /** Staff's message to the customer when withdrawing. */
    closingMessage: text(),
    /** Latest offer version sent (0 = none yet). */
    offerVersion: integer().notNull().default(0),
    /** Sum of catalogue prices at request time; null when a product had no price for the PIN. */
    listTotalPaise: paise(),
    units: integer().notNull(),
    lastMessageAt: ts(),
    lastMessageBy: text(),
    closedAt: ts(),
    /** An open quote nobody writes on closes as `expired` (inactive) at this time; each message moves it on. */
    expiresAt: ts().notNull(),
    idempotencyKey: text().notNull(),
    requestHash: text().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('quote_requests_idempotency_uq').on(t.userId, t.idempotencyKey),
    check('quote_requests_code_format', sql`${t.code} ~ '^QT-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'`),
    check('quote_requests_status_valid', sql`${t.status} in (${inList(QUOTE_STATES)})`),
    check(
      'quotes_reason_code_valid',
      sql`case ${t.status}
        when 'declined' then ${t.statusReasonCode} in (${inList(QUOTE_DECLINE_REASONS)})
        when 'withdrawn' then ${t.statusReasonCode} in (${inList(QUOTE_WITHDRAW_REASONS)})
        when 'expired' then ${t.statusReasonCode} in (${inList(QUOTE_EXPIRE_REASONS)})
        else ${t.statusReasonCode} is null end`,
    ),
    check(
      'quotes_withdrawn_explained',
      sql`${t.status} <> 'withdrawn' or char_length(${t.closingMessage}) between 10 and 500`,
    ),
    check(
      'quotes_closed_at',
      sql`(${t.closedAt} is null) = (${t.status} in ('open','negotiating','offered'))`,
    ),
    check(
      'quote_requests_offered_has_offer',
      sql`${t.status} not in ('offered','accepted') or ${t.offerVersion} > 0`,
    ),
    check('quote_requests_offer_version_nonneg', sql`${t.offerVersion} >= 0`),
    check('quote_requests_units_range', sql`${t.units} between 1 and 1980`),
    check('quote_requests_list_total_nonneg', sql`${t.listTotalPaise} is null or ${t.listTotalPaise} >= 0`),
    check(
      'quotes_last_message_by_valid',
      sql`${t.lastMessageBy} is null or ${t.lastMessageBy} in ('customer','staff')`,
    ),
    check('quote_requests_address_object', sql`jsonb_typeof(${t.shippingAddress}) = 'object'`),
    check('quote_requests_idempotency_format', sql`${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{16,64}$'`),
    index().on(t.userId, t.createdAt),
    index().on(t.status, t.cityId, t.updatedAt),
    index().on(t.status, t.expiresAt),
    index().on(t.cityId),
    index().on(t.pincode),
  ],
);

/** Requested products: a snapshot of what was asked for and the catalogue price then (append-only). */
export const quoteLines = pgTable(
  'quote_lines',
  {
    id: id(),
    quoteId: uuid()
      .notNull()
      .references(() => quoteRequests.id, { onDelete: 'restrict' }),
    lineNo: smallint().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    sku: text().notNull(),
    slug: text().notNull(),
    /** Brand + name in English and Hindi at request time (hard rule 10). */
    title: text().notNull(),
    titleHi: text(),
    qty: smallint().notNull(),
    /** The catalogue price per unit for the PIN at request time (GST-inclusive); null when none was on offer. */
    listUnitPaise: paise(),
    mrpPaise: paise().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('quote_lines_line_uq').on(t.quoteId, t.lineNo),
    unique('quote_lines_variant_uq').on(t.quoteId, t.variantId),
    check('quote_lines_line_no', sql`${t.lineNo} between 1 and 20`),
    check('quote_lines_qty_range', sql`${t.qty} between 1 and 99`),
    check(
      'quote_lines_prices_nonneg',
      sql`${t.mrpPaise} >= 0 and (${t.listUnitPaise} is null or ${t.listUnitPaise} >= 0)`,
    ),
    index().on(t.productId),
    index().on(t.variantId),
  ],
);

/** The negotiation thread (append-only). Bodies are personal data: never logged or sent to analytics. */
export const quoteMessages = pgTable(
  'quote_messages',
  {
    id: id(),
    quoteId: uuid()
      .notNull()
      .references(() => quoteRequests.id, { onDelete: 'restrict' }),
    authorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    authorRole: text().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('quote_messages_role_valid', sql`${t.authorRole} in ('customer','staff','system')`),
    check('quote_messages_body_len', sql`char_length(${t.body}) between 1 and 1000`),
    index().on(t.quoteId, t.createdAt),
    index().on(t.authorUserId),
  ],
);

/**
 * Versioned offers. `lines` = [{ lineNo, unitPaise }] for every quote line (GST-inclusive unit prices). One active
 * offer per quote (partial unique); a new version supersedes it. Accepting checks version + validity in the same
 * transaction that places the order.
 */
export const quoteOffers = pgTable(
  'quote_offers',
  {
    id: id(),
    quoteId: uuid()
      .notNull()
      .references(() => quoteRequests.id, { onDelete: 'restrict' }),
    offerVersion: integer().notNull(),
    status: text().notNull().default('active'),
    lines: jsonb().notNull(),
    subtotalPaise: paise().notNull(),
    deliveryPaise: paise().notNull(),
    totalPaise: paise().notNull(),
    /** Catalogue total at request time, for the discount shown to staff (information only, Q20). */
    listTotalPaise: paise(),
    paymentMethod: text().notNull().default('cod'),
    validUntil: ts().notNull(),
    terms: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('quote_offers_version_uq').on(t.quoteId, t.offerVersion),
    uniqueIndex('quote_offers_one_active_uq')
      .on(t.quoteId)
      .where(sql`${t.status} = 'active'`),
    check('quote_offers_version_positive', sql`${t.offerVersion} > 0`),
    check('quote_offers_status_valid', sql`${t.status} in (${inList(QUOTE_OFFER_STATES)})`),
    check(
      'quote_offers_lines_array',
      sql`jsonb_typeof(${t.lines}) = 'array' and jsonb_array_length(${t.lines}) between 1 and 20`,
    ),
    check(
      'quote_offers_amounts',
      sql`${t.subtotalPaise} > 0 and ${t.deliveryPaise} >= 0 and ${t.totalPaise} = ${t.subtotalPaise} + ${t.deliveryPaise}`,
    ),
    check('quote_offers_list_total_nonneg', sql`${t.listTotalPaise} is null or ${t.listTotalPaise} >= 0`),
    check('quote_offers_payment_valid', sql`${t.paymentMethod} in ('cod')`),
    check('quote_offers_valid_after_created', sql`${t.validUntil} > ${t.createdAt}`),
    check('quote_offers_terms_len', sql`${t.terms} is null or char_length(${t.terms}) between 1 and 500`),
    check('quote_offers_decided', sql`${t.status} <> 'accepted' or ${t.decidedAt} is not null`),
    index().on(t.createdBy),
  ],
);

/** Append-only quote timeline (status changes, offers, messages): the per-entity event log. */
export const quoteEvents = pgTable(
  'quote_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    quoteId: uuid()
      .notNull()
      .references(() => quoteRequests.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorType: text().notNull(),
    actorId: uuid(),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    check('quote_events_kind_valid', sql`${t.kind} in ('requested','message','offer','status')`),
    check('quote_events_actor_valid', sql`${t.actorType} in ('customer','admin','system')`),
    index().on(t.quoteId, t.id),
  ],
);
