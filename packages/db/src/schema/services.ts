/**
 * Workshops and service requests (docs/specs/06-workshops-service-requests.md). A request moves through
 * `serviceRequestMachine` (packages/shared/src/state) by conditional UPDATEs on (status, version); proposals and
 * estimates keep one active row per request (partial unique indexes); the bill is a snapshot of the approved lines;
 * `service_events` is the append-only timeline. Money is integer paise; rates basis points.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  SERVICE_CANCEL_REASONS,
  SERVICE_REJECT_REASONS,
  SERVICE_REQUEST_STATES,
} from '@mechdost/shared/state';
import { ESTIMATE_GST_RATES_BP } from '@mechdost/shared/service-bill';
import { createdAt, geographyPoint, id, paise, ts, updatedAt, version } from './_common';
import { cities, pincodes } from './geography';
import { users, vehicles } from './identity';

const inList = (values: readonly (string | number)[]) =>
  sql.raw(values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(','));

const SLOTS = ['morning', 'afternoon', 'evening'] as const;

export const workshops = pgTable(
  'workshops',
  {
    id: id(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    slug: text().notNull().unique(),
    name: text().notNull(),
    /** Hindi (transliterated) name and street for /hi pages; null = English shown and flagged in admin (rule 10). */
    nameHi: text(),
    addressLine: text().notNull(),
    addressLineHi: text(),
    area: text().notNull(),
    areaHi: text(),
    pincode: text()
      .notNull()
      .references(() => pincodes.pincode, { onDelete: 'restrict' }),
    location: geographyPoint().notNull(),
    /** Business phone (E.164), shown to the customer once a visit is confirmed. */
    phone: text(),
    vehicleTypes: text().array().notNull(),
    evBasic: boolean().notNull().default(false),
    pickup: boolean().notNull().default(false),
    /** `{ open: 'HH:MM', close: 'HH:MM', days: [0-6] }` in IST, formatted per locale on screen. */
    hours: jsonb().notNull(),
    gstin: text(),
    /** Bills carry GST only when registered (0 % otherwise; `computeServiceBill`). */
    gstRegistered: boolean().notNull().default(false),
    locationVerified: boolean().notNull().default(false),
    published: boolean().notNull().default(false),
    /** Standing, set by staff only (decision 2026-11-01): approved ↔ paused → suspended, with a reason. */
    status: text().notNull().default('approved'),
    statusReason: text(),
    statusChangedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    statusChangedAt: ts(),
    /** Availability: a busy workshop takes no new requests. */
    busy: boolean().notNull().default(false),
    ratingAvg: numeric({ precision: 3, scale: 2 }),
    ratingCount: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'workshops_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 80`,
    ),
    check(
      'workshops_vehicle_types_valid',
      sql`cardinality(${t.vehicleTypes}) > 0 and ${t.vehicleTypes} <@ array['2W','3W','4W']::text[]`,
    ),
    check('workshops_hours_object', sql`jsonb_typeof(${t.hours}) = 'object'`),
    check('workshops_status_valid', sql`${t.status} in ('approved','paused','suspended')`),
    check(
      'workshops_standing_has_reason',
      sql`${t.status} = 'approved' or (coalesce(char_length(${t.statusReason}), 0) >= 5 and ${t.statusChangedBy} is not null)`,
    ),
    check('workshops_published_needs_location', sql`not ${t.published} or ${t.locationVerified}`),
    check(
      'workshops_gstin_format',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('workshops_gst_registered_has_gstin', sql`${t.gstRegistered} = (${t.gstin} is not null)`),
    check('workshops_phone_format', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('workshops_rating_count_nonneg', sql`${t.ratingCount} >= 0`),
    index('workshops_location_gist').using('gist', t.location),
    index().on(t.cityId, t.published),
    index().on(t.pincode),
    index().on(t.statusChangedBy),
    index().on(t.createdBy),
  ],
);

/** A workshop's service menu (title + Hindi, price range, duration range). Keyed by a stable `key`. */
export const workshopServices = pgTable(
  'workshop_services',
  {
    id: id(),
    workshopId: uuid()
      .notNull()
      .references(() => workshops.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    title: text().notNull(),
    titleHi: text(),
    included: text(),
    includedHi: text(),
    lowPaise: paise().notNull(),
    highPaise: paise().notNull(),
    minMinutes: integer().notNull(),
    maxMinutes: integer().notNull(),
    /** null: every vehicle type the workshop serves. */
    vehicleType: text(),
    active: boolean().notNull().default(true),
    sortOrder: smallint().notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('workshop_services_key_uq').on(t.workshopId, t.key),
    check('workshop_services_key_format', sql`${t.key} ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'`),
    check('workshop_services_range', sql`${t.lowPaise} >= 0 and ${t.highPaise} >= ${t.lowPaise}`),
    check(
      'workshop_services_minutes',
      sql`${t.minMinutes} between 5 and 10080 and ${t.maxMinutes} between ${t.minMinutes} and 10080`,
    ),
    check(
      'workshop_services_vehicle_type_valid',
      sql`${t.vehicleType} is null or ${t.vehicleType} in ('2W','3W','4W')`,
    ),
  ],
);

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: id(),
    code: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    workshopId: uuid().references(() => workshops.id, { onDelete: 'restrict' }),
    routingMode: text().notNull(),
    vehicleId: uuid().references(() => vehicles.id, { onDelete: 'set null' }),
    vehicleType: text().notNull(),
    /** Snapshot of what the customer typed or picked ("Honda Activa 6G"). */
    vehicleText: text().notNull(),
    /** Odometer history key: the saved vehicle id, or the normalised vehicle text. */
    vehicleKey: text().notNull(),
    /** Snapshot of the chosen menu lines: [{ key, title, titleHi, lowPaise, highPaise }]. */
    services: jsonb().notNull(),
    concern: text(),
    pincode: text()
      .notNull()
      .references(() => pincodes.pincode, { onDelete: 'restrict' }),
    location: geographyPoint(),
    preferredDate: date({ mode: 'string' }).notNull(),
    preferredSlot: text().notNull(),
    pickupRequested: boolean().notNull().default(false),
    status: text().notNull().default('requested'),
    /** Cancel or reject reason code, belonging to its status (like orders, 0034). */
    statusReasonCode: text(),
    customerMessage: text(),
    odometerKm: integer(),
    receivedAt: ts(),
    completedAt: ts(),
    idempotencyKey: text().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('service_requests_idempotency_uq').on(t.userId, t.idempotencyKey),
    check('service_requests_code_format', sql`${t.code} ~ '^SR-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'`),
    check('service_requests_status_valid', sql`${t.status} in (${inList(SERVICE_REQUEST_STATES)})`),
    check('service_requests_routing_valid', sql`${t.routingMode} in ('chosen','mechdost')`),
    check('service_requests_vehicle_type_valid', sql`${t.vehicleType} in ('2W','3W','4W')`),
    check('service_requests_vehicle_text_len', sql`char_length(${t.vehicleText}) between 2 and 80`),
    check('service_requests_slot_valid', sql`${t.preferredSlot} in (${inList(SLOTS)})`),
    check('service_requests_services_array', sql`jsonb_typeof(${t.services}) = 'array'`),
    check('service_requests_concern_len', sql`${t.concern} is null or char_length(${t.concern}) <= 500`),
    check(
      'service_requests_odometer_range',
      sql`${t.odometerKm} is null or ${t.odometerKm} between 0 and 2000000`,
    ),
    check('service_requests_idempotency_format', sql`${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{16,64}$'`),
    // A workshop is attached from awaiting_workshop on; only routing states may be without one.
    check(
      'service_requests_workshop_when_assigned',
      sql`${t.status} in ('requested','needs_routing','cancelled','rejected') or ${t.workshopId} is not null`,
    ),
    check(
      'service_requests_odometer_when_received',
      sql`${t.status} in ('requested','needs_routing','awaiting_workshop','proposed','confirmed','cancelled','rejected') or ${t.odometerKm} is not null`,
    ),
    check(
      'service_requests_reason_code_valid',
      sql`case ${t.status}
        when 'rejected' then ${t.statusReasonCode} in (${inList(SERVICE_REJECT_REASONS)})
        when 'cancelled' then ${t.statusReasonCode} in (${inList(SERVICE_CANCEL_REASONS)})
        else ${t.statusReasonCode} is null end`,
    ),
    check(
      'service_requests_rejected_explained',
      sql`${t.status} <> 'rejected' or char_length(${t.customerMessage}) between 10 and 500`,
    ),
    index().on(t.userId, t.createdAt),
    index().on(t.workshopId, t.status),
    index().on(t.status, t.cityId, t.createdAt),
    index().on(t.cityId),
    index().on(t.vehicleId),
    index().on(t.pincode),
    index().on(t.userId, t.vehicleKey),
  ],
);

/** A workshop's slot + expected cost for a request. One pending proposal per request. */
export const serviceProposals = pgTable(
  'service_proposals',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'restrict' }),
    workshopId: uuid()
      .notNull()
      .references(() => workshops.id, { onDelete: 'restrict' }),
    proposedDate: date({ mode: 'string' }).notNull(),
    slot: text().notNull(),
    lowPaise: paise().notNull(),
    highPaise: paise().notNull(),
    note: text(),
    status: text().notNull().default('pending'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('service_proposals_slot_valid', sql`${t.slot} in (${inList(SLOTS)})`),
    check('service_proposals_range', sql`${t.lowPaise} >= 0 and ${t.highPaise} >= ${t.lowPaise}`),
    check(
      'service_proposals_status_valid',
      sql`${t.status} in ('pending','accepted','declined','withdrawn')`,
    ),
    check('service_proposals_note_len', sql`${t.note} is null or char_length(${t.note}) <= 300`),
    uniqueIndex('service_proposals_one_pending_uq')
      .on(t.requestId)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.requestId),
    index().on(t.workshopId),
    index().on(t.createdBy),
  ],
);

/**
 * Itemised estimate `revision` n of a request. A new revision supersedes the previous one (every decision starts
 * pending again); one non-superseded estimate per request. `version` is the optimistic lock, not the revision.
 */
export const estimates = pgTable(
  'estimates',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'restrict' }),
    revision: integer().notNull(),
    status: text().notNull().default('sent'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('estimates_revision_uq').on(t.requestId, t.revision),
    check('estimates_revision_positive', sql`${t.revision} > 0`),
    check('estimates_status_valid', sql`${t.status} in ('sent','decided','superseded')`),
    check('estimates_decided_at', sql`${t.status} <> 'decided' or ${t.decidedAt} is not null`),
    uniqueIndex('estimates_one_active_uq')
      .on(t.requestId)
      .where(sql`${t.status} <> 'superseded'`),
    index().on(t.createdBy),
    index().on(t.decidedBy),
  ],
);

export const estimateItems = pgTable(
  'estimate_items',
  {
    id: id(),
    estimateId: uuid()
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    lineNo: smallint().notNull(),
    description: text().notNull(),
    serviceKey: text(),
    qty: smallint().notNull(),
    unitPaise: paise().notNull(),
    gstRateBp: integer().notNull(),
    decision: text().notNull().default('pending'),
  },
  (t) => [
    unique('estimate_items_line_uq').on(t.estimateId, t.lineNo),
    check('estimate_items_line_no', sql`${t.lineNo} between 1 and 20`),
    check('estimate_items_description_len', sql`char_length(${t.description}) between 2 and 120`),
    check('estimate_items_qty_range', sql`${t.qty} between 1 and 99`),
    check('estimate_items_unit_range', sql`${t.unitPaise} between 1 and 10000000`),
    check('estimate_items_gst_slab', sql`${t.gstRateBp} in (${inList(ESTIMATE_GST_RATES_BP)})`),
    check('estimate_items_decision_valid', sql`${t.decision} in ('pending','approved','declined')`),
  ],
);

/** The bill: approved lines + GST (0 % when unregistered) + round-off, frozen when the workshop bills. */
export const serviceBills = pgTable(
  'service_bills',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .unique()
      .references(() => serviceRequests.id, { onDelete: 'restrict' }),
    estimateId: uuid()
      .notNull()
      .references(() => estimates.id, { onDelete: 'restrict' }),
    lines: jsonb().notNull(),
    gstRegistered: boolean().notNull(),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull(),
    sgstPaise: paise().notNull(),
    roundOffPaise: integer().notNull(),
    totalPaise: paise().notNull(),
    billedAt: ts().notNull().defaultNow(),
    billedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    paidAt: ts(),
    method: text(),
    paidRecordedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'service_bills_amounts_nonneg',
      sql`${t.taxablePaise} >= 0 and ${t.cgstPaise} >= 0 and ${t.sgstPaise} >= 0 and ${t.totalPaise} >= 0`,
    ),
    check('service_bills_cgst_equals_sgst', sql`${t.cgstPaise} = ${t.sgstPaise}`),
    check('service_bills_round_off_range', sql`${t.roundOffPaise} between -50 and 50`),
    check(
      'service_bills_total_consistent',
      sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.roundOffPaise}`,
    ),
    check('service_bills_unregistered_no_gst', sql`${t.gstRegistered} or ${t.cgstPaise} = 0`),
    check('service_bills_lines_array', sql`jsonb_typeof(${t.lines}) = 'array'`),
    check('service_bills_method_valid', sql`${t.method} is null or ${t.method} in ('cash','upi','card')`),
    check('service_bills_paid_pair', sql`(${t.paidAt} is null) = (${t.method} is null)`),
    index().on(t.estimateId),
    index().on(t.billedBy),
    index().on(t.paidRecordedBy),
  ],
);

/** Append-only timeline (update/delete blocked by `forbid_update_delete`, migration 0044). */
export const serviceEvents = pgTable(
  'service_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: uuid()
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'restrict' }),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorType: text().notNull(),
    actorId: uuid(),
    visibleToCustomer: boolean().notNull().default(true),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    check('service_events_actor_valid', sql`${t.actorType} in ('customer','workshop','admin','system')`),
    index().on(t.requestId, t.id),
  ],
);
