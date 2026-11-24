/**
 * Roadside assistance (docs/specs/22-roadside-assistance.md, design 2026-11-24). A request moves through `rsaMachine`
 * (packages/shared/src/state/rsa.ts) by conditional UPDATEs on (status, version); one active offer per request
 * (partial unique index); `rsa_events` is the append-only timeline; the advance is snapshotted on the request. Money is
 * integer paise. Written only by `repo/roadside*.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import {
  RSA_BALANCE_METHODS,
  RSA_BILL_LINE_KINDS,
  RSA_CANCEL_REASONS,
  RSA_DECLINE_REASONS,
  RSA_FUELS,
  RSA_PROBLEM_TYPES,
  RSA_ROUTING_MODES,
  RSA_SYSTEM_CANCEL_REASONS,
} from '@mechdost/shared/rsa';
import { RSA_OFFER_STATES, RSA_STATES } from '@mechdost/shared/state';
import { createdAt, encryptedCheck, geographyPoint, id, paise, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { workshops } from './services';

const inList = (values: readonly (string | number)[]) =>
  sql.raw(values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(','));

const CANCEL_REASONS = [...RSA_CANCEL_REASONS, ...RSA_SYSTEM_CANCEL_REASONS] as const;

/** Per-city admin settings (one row per city; no row = the defaults in `defaultRsaSettings`). Audited on every save. */
export const rsaCitySettings = pgTable(
  'rsa_city_settings',
  {
    cityId: uuid()
      .primaryKey()
      .references(() => cities.id, { onDelete: 'restrict' }),
    enabled: boolean().notNull().default(false),
    /** The vehicle types offered (user ruling 2026-11-24: 2W and 4W; 3W is added here later). */
    vehicleTypes: text()
      .array()
      .notNull()
      .default(sql`'{2W,4W}'::text[]`),
    /** `{ "2W": 50000, "4W": 50000 }` in paise: exactly the offered types (CHECK). */
    advancePaise: jsonb()
      .notNull()
      .default(sql`'{"2W":50000,"4W":50000}'::jsonb`),
    pincodes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    alwaysOpen: boolean().notNull().default(true),
    opensAtMinute: smallint().notNull().default(0),
    closesAtMinute: smallint().notNull().default(0),
    routingMode: text().notNull().default('manual'),
    acceptTimerSeconds: integer().notNull().default(150),
    maxAutoAttempts: smallint().notNull().default(3),
    problemTypes: text()
      .array()
      .notNull()
      .default(sql`'{dead_battery,flat_tyre,out_of_fuel,minor_fix,needs_towing,unknown}'::text[]`),
    sosPhone: text(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'rsa_city_settings_vehicle_types',
      sql`${t.vehicleTypes} <@ array[${inList(VEHICLE_TYPES)}]::text[] and cardinality(${t.vehicleTypes}) between 1 and 3`,
    ),
    check(
      'rsa_city_settings_advance_matches',
      sql`jsonb_typeof(${t.advancePaise}) = 'object' and ${t.advancePaise} ?& ${t.vehicleTypes} and (${t.advancePaise} - ${t.vehicleTypes}) = '{}'::jsonb`,
    ),
    check('rsa_city_settings_routing_mode', sql`${t.routingMode} in (${inList(RSA_ROUTING_MODES)})`),
    check(
      'rsa_city_settings_hours',
      sql`${t.opensAtMinute} between 0 and 1439 and ${t.closesAtMinute} between 0 and 1439`,
    ),
    check(
      'rsa_city_settings_timer',
      sql`${t.acceptTimerSeconds} between 60 and 900 and ${t.maxAutoAttempts} between 1 and 10`,
    ),
    check(
      'rsa_city_settings_problem_types',
      sql`${t.problemTypes} <@ array[${inList(RSA_PROBLEM_TYPES)}]::text[] and cardinality(${t.problemTypes}) >= 1`,
    ),
    check(
      'rsa_city_settings_sos_phone',
      sql`${t.sosPhone} is null or ${t.sosPhone} ~ '^\\+91[6-9][0-9]{9}$'`,
    ),
    index().on(t.updatedBy),
  ],
);

/** A workshop's roadside opt-in (portal). Only a workshop responder exists today; mechanics get their own key later. */
export const rsaResponders = pgTable(
  'rsa_responders',
  {
    workshopId: uuid()
      .primaryKey()
      .references(() => workshops.id, { onDelete: 'restrict' }),
    enabled: boolean().notNull().default(false),
    radiusKm: smallint().notNull().default(10),
    vehicleTypes: text()
      .array()
      .notNull()
      .default(sql`'{2W,4W}'::text[]`),
    problemTypes: text()
      .array()
      .notNull()
      .default(sql`'{dead_battery,flat_tyre,out_of_fuel,minor_fix,unknown}'::text[]`),
    towing: boolean().notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('rsa_responders_radius', sql`${t.radiusKm} between 1 and 50`),
    check(
      'rsa_responders_vehicle_types',
      sql`${t.vehicleTypes} <@ array[${inList(VEHICLE_TYPES)}]::text[] and cardinality(${t.vehicleTypes}) >= 1`,
    ),
    check(
      'rsa_responders_problem_types',
      sql`${t.problemTypes} <@ array[${inList(RSA_PROBLEM_TYPES)}]::text[] and cardinality(${t.problemTypes}) >= 1`,
    ),
    index().on(t.enabled),
  ],
);

export const rsaRequests = pgTable(
  'rsa_requests',
  {
    id: id(),
    /** `RSA-{CITY}-{YYYY}-{6 base32}`. */
    code: text().notNull().unique(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text().notNull().default('awaiting_payment'),
    /** Vehicle snapshot (rule 16): the type and fuel as chosen, an optional make/model label. */
    vehicleType: text().notNull(),
    fuel: text().notNull(),
    vehicleLabel: text(),
    /** What the customer thinks happened; null when skipped, `unknown` when they said they do not know. */
    problemType: text(),
    note: text(),
    /** Up to three photo storage paths (upload arrives with the customer photo step; the column is ready). */
    photoPaths: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    location: geographyPoint().notNull(),
    pincode: text().notNull(),
    addressLine: text(),
    /** The advance in paise, copied from the city setting when the request was made; every payment asserts against it. */
    advancePaise: paise().notNull(),
    advancePaidAt: ts(),
    /** The responder once an offer is accepted. */
    workshopId: uuid().references(() => workshops.id, { onDelete: 'restrict' }),
    totalPaise: paise(),
    balancePaise: paise(),
    /** Refund raised because the total came in under the advance. */
    overpaidPaise: paise(),
    /** `none` = the advance covered the whole bill, nothing was owed. */
    balanceMethod: text(),
    balancePaidAt: ts(),
    billedAt: ts(),
    completedAt: ts(),
    cancelledAt: ts(),
    cancelReason: text(),
    cancelNote: text(),
    /** The customer's `Idempotency-Key`: a retried create returns the same request. */
    idemKey: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('rsa_requests_status_valid', sql`${t.status} in (${inList(RSA_STATES)})`),
    check('rsa_requests_vehicle_type', sql`${t.vehicleType} in (${inList(VEHICLE_TYPES)})`),
    check('rsa_requests_fuel', sql`${t.fuel} in (${inList(RSA_FUELS)})`),
    check(
      'rsa_requests_problem_type',
      sql`${t.problemType} is null or ${t.problemType} in (${inList(RSA_PROBLEM_TYPES)})`,
    ),
    check('rsa_requests_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('rsa_requests_note_len', sql`${t.note} is null or char_length(${t.note}) between 1 and 300`),
    check('rsa_requests_photos', sql`cardinality(${t.photoPaths}) <= 3`),
    check('rsa_requests_advance_positive', sql`${t.advancePaise} > 0`),
    check(
      'rsa_requests_money',
      sql`(${t.totalPaise} is null or ${t.totalPaise} > 0) and (${t.balancePaise} is null or ${t.balancePaise} >= 0) and (${t.overpaidPaise} is null or ${t.overpaidPaise} >= 0)`,
    ),
    // Balance maths is enforced where the bill is written, and again here: balance = max(total - advance, 0).
    check(
      'rsa_requests_balance_maths',
      sql`${t.totalPaise} is null or (${t.balancePaise} = greatest(${t.totalPaise} - ${t.advancePaise}, 0) and ${t.overpaidPaise} = greatest(${t.advancePaise} - ${t.totalPaise}, 0))`,
    ),
    check(
      'rsa_requests_balance_method',
      sql`${t.balanceMethod} is null or ${t.balanceMethod} in (${inList(RSA_BALANCE_METHODS)}, 'none')`,
    ),
    check(
      'rsa_requests_billed_has_total',
      sql`${t.status} not in ('billed','completed') or (${t.totalPaise} is not null and ${t.billedAt} is not null)`,
    ),
    check(
      'rsa_requests_completed_settled',
      sql`${t.status} <> 'completed' or (${t.balanceMethod} is not null and ${t.completedAt} is not null)`,
    ),
    check(
      'rsa_requests_cancel_explained',
      sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null and ${t.cancelledAt} is not null) and (${t.cancelReason} is null or ${t.cancelReason} in (${inList(CANCEL_REASONS)}))`,
    ),
    check(
      'rsa_requests_responder_attached',
      sql`${t.status} not in ('accepted','en_route','arrived','in_progress','billed') or ${t.workshopId} is not null`,
    ),
    check(
      'rsa_requests_advance_paid',
      sql`${t.status} = 'awaiting_payment' or ${t.status} = 'cancelled' or ${t.advancePaidAt} is not null`,
    ),
    check('rsa_requests_idem_format', sql`${t.idemKey} is null or ${t.idemKey} ~ '^[A-Za-z0-9_-]{10,64}$'`),
    // One live request per customer: a second help request while one is open is refused (abuse and double-tap guard).
    uniqueIndex('rsa_requests_one_live_per_user_uq')
      .on(t.userId)
      .where(sql`${t.status} not in ('completed','cancelled')`),
    uniqueIndex('rsa_requests_idem_uq')
      .on(t.userId, t.idemKey)
      .where(sql`${t.idemKey} is not null`),
    // The dispatch queue and the city board: status within a city, oldest first.
    index('rsa_requests_city_status_idx').on(t.cityId, t.status, t.createdAt, t.id),
    index().on(t.userId, t.createdAt),
    index().on(t.workshopId, t.status),
    index().on(t.createdBy),
    index('rsa_requests_location_gix').using('gist', t.location),
    // The worker's expiry of unpaid requests touches only these.
    index('rsa_requests_unpaid_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'awaiting_payment'`),
  ],
);

/** An offer of a request to one responder. One active (offered or accepted) per request. */
export const rsaOffers = pgTable(
  'rsa_offers',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => rsaRequests.id, { onDelete: 'restrict' }),
    /** Only `workshop` today; `mechanic` joins in phase 2 (widen the CHECK, add `mechanic_id`). */
    responderType: text().notNull().default('workshop'),
    workshopId: uuid()
      .notNull()
      .references(() => workshops.id, { onDelete: 'restrict' }),
    status: text().notNull().default('offered'),
    /** 1 for the first offer of a request, 2 for the next after a decline or timeout, and so on. */
    attempt: smallint().notNull().default(1),
    distanceM: integer(),
    offeredBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    offeredAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    respondedAt: ts(),
    declineReason: text(),
    version: version(),
  },
  (t) => [
    check('rsa_offers_status_valid', sql`${t.status} in (${inList(RSA_OFFER_STATES)})`),
    check('rsa_offers_responder_type', sql`${t.responderType} in ('workshop')`),
    check('rsa_offers_expiry_after_offer', sql`${t.expiresAt} > ${t.offeredAt}`),
    check(
      'rsa_offers_decline_reason',
      sql`(${t.status} = 'declined') = (${t.declineReason} is not null) and (${t.declineReason} is null or ${t.declineReason} in (${inList(RSA_DECLINE_REASONS)}))`,
    ),
    uniqueIndex('rsa_offers_one_active_uq')
      .on(t.requestId)
      .where(sql`${t.status} in ('offered','accepted')`),
    index('rsa_offers_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'offered'`),
    index().on(t.workshopId, t.status),
    index().on(t.requestId, t.attempt),
    index().on(t.offeredBy),
  ],
);

/** Append-only timeline (update/delete blocked by `forbid_update_delete`). */
export const rsaEvents = pgTable(
  'rsa_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: uuid()
      .notNull()
      .references(() => rsaRequests.id, { onDelete: 'restrict' }),
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
    check('rsa_events_actor_valid', sql`${t.actorType} in ('customer','workshop','admin','system')`),
    check('rsa_events_status_valid', sql`${t.toStatus} in (${inList(RSA_STATES)})`),
    index().on(t.requestId, t.id),
  ],
);

/** The bill the responder enters after the work: written once, never edited (append-only trigger). */
export const rsaBillLines = pgTable(
  'rsa_bill_lines',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => rsaRequests.id, { onDelete: 'restrict' }),
    position: smallint().notNull(),
    kind: text().notNull(),
    description: text().notNull(),
    quantity: integer().notNull(),
    unitPricePaise: paise().notNull(),
    totalPaise: paise().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('rsa_bill_lines_kind', sql`${t.kind} in (${inList(RSA_BILL_LINE_KINDS)})`),
    check('rsa_bill_lines_description', sql`char_length(${t.description}) between 1 and 120`),
    check('rsa_bill_lines_qty', sql`${t.quantity} between 1 and 99`),
    check(
      'rsa_bill_lines_money',
      sql`${t.unitPricePaise} >= 0 and ${t.totalPaise} = ${t.quantity} * ${t.unitPricePaise}`,
    ),
    uniqueIndex('rsa_bill_lines_position_uq').on(t.requestId, t.position),
    index().on(t.createdBy),
  ],
);

/** The arrival code of a roadside job (same protection as `service_arrival_codes`; module `repo/arrival-code.ts`). */
export const rsaArrivalCodes = pgTable(
  'rsa_arrival_codes',
  {
    requestId: uuid()
      .primaryKey()
      .references(() => rsaRequests.id, { onDelete: 'restrict' }),
    codeEnc: text().notNull(),
    attempts: smallint().notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('rsa_arrival_codes_attempts', sql`${t.attempts} between 0 and 5`),
    check('rsa_arrival_codes_encrypted', encryptedCheck(t.codeEnc)),
  ],
);
