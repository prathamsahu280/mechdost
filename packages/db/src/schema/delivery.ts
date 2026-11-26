/**
 * Delivery agents (docs/specs/24-delivery-agents.md, design 2026-11-26). A delivery job carries one agent-mode
 * sub-order from its shop to the customer and moves through `deliveryJobMachine` (packages/shared/src/state/delivery.ts)
 * by conditional UPDATEs on (status, version); one active job per sub-order and one open offer per job (partial unique
 * indexes); `delivery_job_events` and `delivery_agent_events` are append-only. Pickup and return codes live in their own
 * rows so guesses never bump the job's `version` (like `rsa_arrival_codes`). Written only by `repo/delivery-*.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AGENT_DOCUMENT_KINDS,
  AGENT_DOCUMENT_REJECT_REASONS,
  AGENT_DOCUMENT_STATUSES,
  AGENT_INVITE_STATES,
  AGENT_STATUS_REASONS,
  AGENT_VEHICLE_TYPES,
  DELIVERY_DECLINE_REASONS,
  DELIVERY_FAIL_REASONS,
  DELIVERY_RATING_REASONS,
  DELIVERY_GIVE_UP_REASONS,
  DELIVERY_SWITCH_DECLINE_REASONS,
  DELIVERY_SWITCH_REASONS,
  DELIVERY_SWITCH_STATES,
  DELIVERY_WITHDRAW_REASONS,
  LOAD_CLASSES,
  SHOP_DELIVERY_MODES,
  SHOP_MODE_REJECT_REASONS,
  SHOP_MODE_REQUEST_REASONS,
  SHOP_MODE_REQUEST_STATES,
} from '@mechdost/shared/delivery/codes';
import {
  AGENT_STATUSES,
  DELIVERY_ACTIVE_JOB_STATES,
  DELIVERY_JOB_STATES,
  DELIVERY_OFFER_STATES,
} from '@mechdost/shared/state';
import { citext, createdAt, encryptedCheck, geographyPoint, id, ts, updatedAt, version } from './_common';
import { shops } from './catalogue';
import { cities } from './geography';
import { users } from './identity';
import { mediaObjects } from './media';
import { orders } from './orders';
import { partnerApplications } from './platform';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/** Admin invites a person (who applied, or not) to become an agent: a one-time link bound to their phone. */
export const deliveryAgentInvites = pgTable(
  'delivery_agent_invites',
  {
    id: id(),
    /** SHA-256 (hex) of the token; the token itself is shown to staff once and sealed in the outbox. */
    tokenHash: text().notNull().unique(),
    name: text().notNull(),
    phone: text().notNull(),
    /** Optional: WhatsApp may be the only channel. */
    email: citext(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    vehicleType: text().notNull(),
    applicationId: uuid().references(() => partnerApplications.id, { onDelete: 'set null' }),
    status: text().notNull().default('sent'),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    usedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('delivery_agent_invites_status_valid', sql`${t.status} in (${inList(AGENT_INVITE_STATES)})`),
    check('delivery_agent_invites_vehicle_valid', sql`${t.vehicleType} in (${inList(AGENT_VEHICLE_TYPES)})`),
    check('delivery_agent_invites_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('delivery_agent_invites_phone', sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check(
      'delivery_agent_invites_used',
      sql`(${t.status} = 'used') = (${t.usedAt} is not null and ${t.usedBy} is not null)`,
    ),
    uniqueIndex('delivery_agent_invites_one_open_per_phone_uq')
      .on(t.phone)
      .where(sql`${t.status} = 'sent'`),
    index().on(t.cityId, t.createdAt, t.id),
    index().on(t.status, t.expiresAt),
    index().on(t.createdBy),
    index().on(t.usedBy),
    index().on(t.applicationId),
  ],
);

/** One delivery agent (exists from the accepted invite on). Staff-set standing with a reason and history. */
export const deliveryAgents = pgTable(
  'delivery_agents',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    /** As on the invite (the agent's legal name is on the verified documents). */
    name: text().notNull(),
    /** E.164; the OTP-proven phone that accepted the invite. Never shown to customers. */
    phone: text().notNull(),
    vehicleType: text().notNull(),
    status: text().notNull().default('onboarding'),
    statusReason: text(),
    statusNote: text(),
    statusChangedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    statusChangedAt: ts(),
    pausedUntil: ts(),
    online: boolean().notNull().default(false),
    lastOnlineAt: ts(),
    /** Where the agent usually starts from (ranking only; optional). */
    homeLocation: geographyPoint(),
    inviteId: uuid().references(() => deliveryAgentInvites.id, { onDelete: 'set null' }),
    applicationId: uuid().references(() => partnerApplications.id, { onDelete: 'set null' }),
    verifiedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: ts(),
    offboardedAt: ts(),
    /** Customer ratings (founder 2026-11-26): running sum of stars and count; average = sum / count. */
    ratingSum: integer().notNull().default(0),
    ratingCount: integer().notNull().default(0),
    /** When staff were last alerted about a low average (one alert per drop below the threshold). */
    lowRatingAlertedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('delivery_agents_status_valid', sql`${t.status} in (${inList(AGENT_STATUSES)})`),
    check('delivery_agents_vehicle_valid', sql`${t.vehicleType} in (${inList(AGENT_VEHICLE_TYPES)})`),
    check('delivery_agents_phone', sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check(
      'delivery_agents_reason_valid',
      sql`${t.statusReason} is null or ${t.statusReason} in (${inList(AGENT_STATUS_REASONS)})`,
    ),
    // Paused, suspended and offboarded agents carry a reason and who set it (decision 2026-11-01 partner standing).
    check(
      'delivery_agents_standing_has_reason',
      sql`${t.status} not in ('paused','suspended','offboarded') or (${t.statusReason} is not null and ${t.statusChangedBy} is not null)`,
    ),
    // Only active agents can be online (a pause or suspension takes them offline in the same UPDATE).
    check('delivery_agents_online_active', sql`not ${t.online} or ${t.status} = 'active'`),
    check(
      'delivery_agents_rating_range',
      sql`${t.ratingCount} >= 0 and ${t.ratingSum} between ${t.ratingCount} and ${t.ratingCount} * 5`,
    ),
    check('delivery_agents_active_verified', sql`${t.status} <> 'active' or ${t.verifiedAt} is not null`),
    index('delivery_agents_city_status_online_idx').on(t.cityId, t.status, t.online),
    index('delivery_agents_city_created_idx').on(t.cityId, t.createdAt, t.id),
    index('delivery_agents_home_gix').using('gist', t.homeLocation),
    index().on(t.statusChangedBy),
    index().on(t.inviteId),
    index().on(t.applicationId),
    index().on(t.verifiedBy),
    index('delivery_agents_paused_until_idx')
      .on(t.pausedUntil)
      .where(sql`${t.status} = 'paused' and ${t.pausedUntil} is not null`),
  ],
);

/** The current PAN, licence and RC of an agent: number encrypted (+ blind index), photo in the private media host. */
export const deliveryAgentDocuments = pgTable(
  'delivery_agent_documents',
  {
    id: id(),
    agentId: uuid()
      .notNull()
      .references(() => deliveryAgents.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    /** AES-256-GCM (`encryptField(…, 'delivery_agent_documents.number_enc')`). */
    numberEnc: text().notNull(),
    /** Blind index (`blindIndex(…, 'agent_document')`): duplicates across agents without decrypting. */
    numberIndex: text().notNull(),
    numberLast4: text().notNull(),
    mediaId: uuid()
      .notNull()
      .references(() => mediaObjects.id, { onDelete: 'restrict' }),
    status: text().notNull().default('submitted'),
    rejectReason: text(),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('delivery_agent_documents_kind_valid', sql`${t.kind} in (${inList(AGENT_DOCUMENT_KINDS)})`),
    check('delivery_agent_documents_status_valid', sql`${t.status} in (${inList(AGENT_DOCUMENT_STATUSES)})`),
    check('delivery_agent_documents_encrypted', encryptedCheck(t.numberEnc)),
    check('delivery_agent_documents_last4', sql`${t.numberLast4} ~ '^[0-9A-Z]{4}$'`),
    check(
      'delivery_agent_documents_reject_reason',
      sql`(${t.status} = 'rejected') = (${t.rejectReason} is not null) and (${t.rejectReason} is null or ${t.rejectReason} in (${inList(AGENT_DOCUMENT_REJECT_REASONS)}))`,
    ),
    check(
      'delivery_agent_documents_reviewed',
      sql`${t.status} = 'submitted' or (${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`,
    ),
    uniqueIndex('delivery_agent_documents_kind_uq').on(t.agentId, t.kind),
    index().on(t.kind, t.numberIndex),
    index().on(t.mediaId),
    index().on(t.reviewedBy),
    index('delivery_agent_documents_queue_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.status} = 'submitted'`),
  ],
);

/** Append-only agent history: standing, documents, online toggles, invite acceptance. */
export const deliveryAgentEvents = pgTable(
  'delivery_agent_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    agentId: uuid()
      .notNull()
      .references(() => deliveryAgents.id, { onDelete: 'restrict' }),
    /** `status` | `document_submitted` | `document_verified` | `document_rejected` | `online` | `offline` | `vehicle`. */
    kind: text().notNull(),
    fromStatus: text(),
    toStatus: text(),
    reasonCode: text(),
    note: text(),
    documentKind: text(),
    actorType: text().notNull(),
    actorId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'delivery_agent_events_kind_valid',
      sql`${t.kind} in ('joined','status','document_submitted','document_verified','document_rejected','online','offline','vehicle','document_viewed')`,
    ),
    check('delivery_agent_events_actor_valid', sql`${t.actorType} in ('delivery_agent','admin','system')`),
    check(
      'delivery_agent_events_status_valid',
      sql`(${t.fromStatus} is null or ${t.fromStatus} in (${inList(AGENT_STATUSES)})) and (${t.toStatus} is null or ${t.toStatus} in (${inList(AGENT_STATUSES)}))`,
    ),
    check(
      'delivery_agent_events_document_kind',
      sql`${t.documentKind} is null or ${t.documentKind} in (${inList(AGENT_DOCUMENT_KINDS)})`,
    ),
    index().on(t.agentId, t.createdAt),
    index().on(t.actorId),
  ],
);

/** One trip carrying one agent-mode sub-order. */
export const deliveryJobs = pgTable(
  'delivery_jobs',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    agentId: uuid().references(() => deliveryAgents.id, { onDelete: 'restrict' }),
    status: text().notNull().default('needs_agent'),
    /** 1 for the first job of a sub-order, 2 after a hand-back for another agent, and so on. */
    seq: smallint().notNull().default(1),
    /** Failed delivery attempts on this sub-order so far (carried into the next job; Lead's call 13). */
    failedAttempts: smallint().notNull().default(0),
    /** Known weight of the lines (grams) and the heaviest class of lines without a weight. */
    loadWeightG: integer().notNull().default(0),
    loadClass: text().notNull().default('light'),
    unknownWeight: boolean().notNull().default(false),
    pickupPhotoId: uuid().references(() => mediaObjects.id, { onDelete: 'restrict' }),
    deliveryPhotoId: uuid().references(() => mediaObjects.id, { onDelete: 'restrict' }),
    failPhotoId: uuid().references(() => mediaObjects.id, { onDelete: 'restrict' }),
    failReason: text(),
    failNote: text(),
    /** Why the job ended `returned`: brought back to send again (`retry`) or to close the sub-order (`close`). */
    returnOutcome: text(),
    /** Staff's choice when a failed parcel goes back: send it out again with another agent, or close the sub-order. */
    returnIntent: text(),
    cancelReason: text(),
    acceptedAt: ts(),
    pickedUpAt: ts(),
    deliveredAt: ts(),
    failedAt: ts(),
    returnedAt: ts(),
    closedAt: ts(),
    /** How the job ended when staff stepped in (`override_pickup` | `override_delivery` | `override_return`). */
    overrideKind: text(),
    overrideReason: text(),
    overrideBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('delivery_jobs_status_valid', sql`${t.status} in (${inList(DELIVERY_JOB_STATES)})`),
    check('delivery_jobs_load_class_valid', sql`${t.loadClass} in (${inList(LOAD_CLASSES)})`),
    check(
      'delivery_jobs_load_nonneg',
      sql`${t.loadWeightG} >= 0 and ${t.seq} >= 1 and ${t.failedAttempts} >= 0`,
    ),
    check(
      'delivery_jobs_agent_when_held',
      sql`${t.status} in ('needs_agent','offered','cancelled') or ${t.agentId} is not null`,
    ),
    check(
      'delivery_jobs_fail_reason_valid',
      sql`${t.failReason} is null or ${t.failReason} in (${inList(DELIVERY_FAIL_REASONS)})`,
    ),
    check('delivery_jobs_failed_explained', sql`${t.status} <> 'failed' or ${t.failReason} is not null`),
    check(
      'delivery_jobs_return_outcome',
      sql`(${t.status} = 'returned') = (${t.returnOutcome} is not null) and (${t.returnOutcome} is null or ${t.returnOutcome} in ('retry','close'))`,
    ),
    check(
      'delivery_jobs_return_intent',
      sql`(${t.returnIntent} is null or ${t.returnIntent} in ('retry','close')) and (${t.status} <> 'returning' or ${t.returnIntent} is not null)`,
    ),
    check(
      'delivery_jobs_override',
      sql`${t.overrideKind} is null or (${t.overrideKind} in ('override_pickup','override_delivery','override_return') and char_length(${t.overrideReason}) between 5 and 300 and ${t.overrideBy} is not null)`,
    ),
    uniqueIndex('delivery_jobs_one_active_uq')
      .on(t.orderId)
      .where(sql`${t.status} in (${inList(DELIVERY_ACTIVE_JOB_STATES)})`),
    index('delivery_jobs_city_status_idx').on(t.cityId, t.status, t.updatedAt),
    index('delivery_jobs_agent_status_idx').on(t.agentId, t.status, t.updatedAt),
    index().on(t.orderId, t.seq),
    index().on(t.shopId),
    index().on(t.pickupPhotoId),
    index().on(t.deliveryPhotoId),
    index().on(t.failPhotoId),
    index().on(t.overrideBy),
  ],
);

/**
 * Pickup code (the shop shows it, the agent types it) and return code (the agent shows it, the shop types it):
 * 4 digits, encrypted, 5 tries, then only the audited override. Own row so guesses never bump the job's version.
 */
export const deliveryHandoverCodes = pgTable(
  'delivery_handover_codes',
  {
    jobId: uuid()
      .notNull()
      .references(() => deliveryJobs.id, { onDelete: 'restrict' }),
    purpose: text().notNull(),
    codeEnc: text().notNull(),
    attempts: smallint().notNull().default(0),
    usedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.purpose] }),
    check('delivery_handover_codes_purpose', sql`${t.purpose} in ('pickup','return')`),
    check('delivery_handover_codes_attempts', sql`${t.attempts} between 0 and 5`),
    check('delivery_handover_codes_encrypted', encryptedCheck(t.codeEnc)),
  ],
);

/** One offer of a job to one agent; one open (offered or accepted) offer per job. */
export const deliveryJobOffers = pgTable(
  'delivery_job_offers',
  {
    id: id(),
    jobId: uuid()
      .notNull()
      .references(() => deliveryJobs.id, { onDelete: 'restrict' }),
    agentId: uuid()
      .notNull()
      .references(() => deliveryAgents.id, { onDelete: 'restrict' }),
    status: text().notNull().default('offered'),
    offeredBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    offeredAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    respondedAt: ts(),
    /** Decline, give-up or withdraw reason code (per the offer status). */
    reasonCode: text(),
    note: text(),
    distanceM: integer(),
    version: version(),
  },
  (t) => [
    check('delivery_job_offers_status_valid', sql`${t.status} in (${inList(DELIVERY_OFFER_STATES)})`),
    check('delivery_job_offers_expiry_after_offer', sql`${t.expiresAt} > ${t.offeredAt}`),
    check(
      'delivery_job_offers_reason',
      sql`case ${t.status}
        when 'declined' then ${t.reasonCode} in (${inList(DELIVERY_DECLINE_REASONS)})
        when 'given_up' then ${t.reasonCode} in (${inList(DELIVERY_GIVE_UP_REASONS)})
        when 'withdrawn' then ${t.reasonCode} is null or ${t.reasonCode} in (${inList(DELIVERY_WITHDRAW_REASONS)})
        else ${t.reasonCode} is null end`,
    ),
    uniqueIndex('delivery_job_offers_one_open_uq')
      .on(t.jobId)
      .where(sql`${t.status} in ('offered','accepted')`),
    index('delivery_job_offers_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'offered'`),
    index('delivery_job_offers_agent_idx').on(t.agentId, t.status, t.offeredAt),
    index().on(t.jobId, t.offeredAt),
    index().on(t.offeredBy),
  ],
);

/** Append-only job timeline: every move, offer, reveal, photo and wrong code (rule 16: codes, ids, UTC). */
export const deliveryJobEvents = pgTable(
  'delivery_job_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid()
      .notNull()
      .references(() => deliveryJobs.id, { onDelete: 'restrict' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    fromStatus: text(),
    toStatus: text(),
    reasonCode: text(),
    offerId: uuid().references(() => deliveryJobOffers.id, { onDelete: 'restrict' }),
    agentId: uuid().references(() => deliveryAgents.id, { onDelete: 'restrict' }),
    mediaId: uuid().references(() => mediaObjects.id, { onDelete: 'restrict' }),
    actorType: text().notNull(),
    actorId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'delivery_job_events_kind_valid',
      sql`${t.kind} in ('created','status','offered','offer_declined','offer_expired','offer_withdrawn','offer_given_up','contact_revealed','photo','code_wrong','code_locked','override','agent_unavailable')`,
    ),
    check(
      'delivery_job_events_actor_valid',
      sql`${t.actorType} in ('delivery_agent','shop','admin','system')`,
    ),
    check(
      'delivery_job_events_status_valid',
      sql`(${t.fromStatus} is null or ${t.fromStatus} in (${inList(DELIVERY_JOB_STATES)})) and (${t.toStatus} is null or ${t.toStatus} in (${inList(DELIVERY_JOB_STATES)}))`,
    ),
    index().on(t.jobId, t.createdAt),
    index().on(t.orderId),
    index().on(t.offerId),
    index().on(t.agentId, t.createdAt),
    index().on(t.mediaId),
    index().on(t.actorId),
    index('delivery_job_events_kind_idx').on(t.kind, t.createdAt),
  ],
);

/** Staff ask the shop to deliver an agent-mode sub-order itself (Lead's call 9); the shop confirms or declines. */
export const orderDeliverySwitches = pgTable(
  'order_delivery_switches',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    status: text().notNull().default('requested'),
    reasonCode: text().notNull(),
    note: text(),
    declineReason: text(),
    declineNote: text(),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('order_delivery_switches_status_valid', sql`${t.status} in (${inList(DELIVERY_SWITCH_STATES)})`),
    check(
      'order_delivery_switches_reason_valid',
      sql`${t.reasonCode} in (${inList(DELIVERY_SWITCH_REASONS)})`,
    ),
    check(
      'order_delivery_switches_decline',
      sql`(${t.status} = 'declined') = (${t.declineReason} is not null) and (${t.declineReason} is null or ${t.declineReason} in (${inList(DELIVERY_SWITCH_DECLINE_REASONS)}))`,
    ),
    uniqueIndex('order_delivery_switches_one_open_uq')
      .on(t.orderId)
      .where(sql`${t.status} = 'requested'`),
    index().on(t.shopId, t.status),
    index().on(t.requestedBy),
    index().on(t.decidedBy),
  ],
);

/** A shop asks to deliver its own orders, or to go back to agents; staff approve or reject (history kept). */
export const shopDeliveryModeRequests = pgTable(
  'shop_delivery_mode_requests',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    requestedMode: text().notNull(),
    /** `shop`: asked in the portal; `staff`: set directly by staff (recorded approved). */
    source: text().notNull().default('shop'),
    reasonCode: text(),
    note: text(),
    status: text().notNull().default('pending'),
    decisionReason: text(),
    decisionNote: text(),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'shop_delivery_mode_requests_mode_valid',
      sql`${t.requestedMode} in (${inList(SHOP_DELIVERY_MODES)})`,
    ),
    check('shop_delivery_mode_requests_source_valid', sql`${t.source} in ('shop','staff')`),
    check(
      'shop_delivery_mode_requests_status_valid',
      sql`${t.status} in (${inList(SHOP_MODE_REQUEST_STATES)})`,
    ),
    check(
      'shop_delivery_mode_requests_reason',
      sql`${t.source} = 'staff' or ${t.reasonCode} in (${inList(SHOP_MODE_REQUEST_REASONS)})`,
    ),
    check(
      'shop_delivery_mode_requests_decision',
      sql`(${t.status} = 'rejected') = (${t.decisionReason} is not null) and (${t.decisionReason} is null or ${t.decisionReason} in (${inList(SHOP_MODE_REJECT_REASONS)}))`,
    ),
    uniqueIndex('shop_delivery_mode_requests_one_pending_uq')
      .on(t.shopId)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.status, t.createdAt),
    index().on(t.shopId, t.createdAt),
    index().on(t.requestedBy),
    index().on(t.decidedBy),
  ],
);

/**
 * The customer's rating of the agent for one delivered job (founder 2026-11-26): 1?5 stars, reason codes, optional
 * note; one per job, editable until `editable_until` (24 h). The agent row keeps the running sum and count.
 */
export const deliveryRatings = pgTable(
  'delivery_ratings',
  {
    id: id(),
    jobId: uuid()
      .notNull()
      .unique()
      .references(() => deliveryJobs.id, { onDelete: 'restrict' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    agentId: uuid()
      .notNull()
      .references(() => deliveryAgents.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stars: smallint().notNull(),
    reasons: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    note: text(),
    editableUntil: ts().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('delivery_ratings_stars', sql`${t.stars} between 1 and 5`),
    check('delivery_ratings_reasons', sql`${t.reasons} <@ array[${inList(DELIVERY_RATING_REASONS)}]::text[]`),
    check('delivery_ratings_other_note', sql`not ('other' = any(${t.reasons})) or ${t.note} is not null`),
    index('delivery_ratings_agent_idx').on(t.agentId, t.createdAt),
    index().on(t.orderId),
    index().on(t.userId),
  ],
);
