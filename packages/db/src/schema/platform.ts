import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CUSTOMER_BLOCK_LEVELS, CUSTOMER_BLOCK_REASONS } from '@mechdost/shared/customers';
import { GST_STATUSES, LOCATION_SOURCES, PARTNER_STANDING_REASONS } from '@mechdost/shared/partner-codes';
import { APPLICATION_STATES, INVITE_STATES } from '@mechdost/shared/state';
import { citext, createdAt, encryptedCheck, geographyPoint, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { orders } from './orders';
import { products, shops } from './catalogue';

/** Brandur-style idempotency keys for money-moving endpoints (docs/research/data-integrity.md §4). */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    requestHash: text().notNull(),
    lockedAt: ts(),
    recoveryPoint: text().notNull().default('started'),
    responseStatus: smallint(),
    responseBody: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    check('idempotency_keys_key_format', sql`${t.key} ~ '^[A-Za-z0-9_-]{16,128}$'`),
    index().on(t.createdAt),
  ],
);

/** Provider webhook deliveries, deduplicated by the provider's event id (at-least-once delivery). */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text().primaryKey(), // e.g. x-razorpay-event-id
    provider: text().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    status: text().notNull().default('received'),
    attempts: integer().notNull().default(0),
    error: text(),
    receivedAt: ts().notNull().defaultNow(),
    processedAt: ts(),
  },
  (t) => [
    check('webhook_events_status_valid', sql`${t.status} in ('received','processed','parked','failed')`),
    index('webhook_events_pending_idx')
      .on(t.receivedAt)
      .where(sql`${t.status} in ('received','parked')`),
  ],
);

/** Job handlers are at-least-once; the first statement of a handler claims its key here. */
export const processedJobs = pgTable('processed_jobs', {
  jobKey: text().primaryKey(),
  processedAt: ts().notNull().defaultNow(),
});

/** Immutable audit trail of every mutation (update/delete blocked by trigger). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid(),
    actorRole: text(),
    ipTruncated: text(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.entity, t.entityId, t.createdAt), index().on(t.actorUserId, t.createdAt)],
);

/** Transactional outbox: written in the same transaction as the business change. */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: id(),
    dedupeKey: text().notNull().unique(),
    channel: text().notNull(),
    recipientUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    recipient: text(),
    templateKey: text().notNull(),
    locale: text().notNull().default('en'),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    lastError: text(),
    providerId: text(),
    /** Dispatcher lease (FOR UPDATE SKIP LOCKED claim); a crashed sender's claim lapses and is retried. */
    claimedAt: ts(),
    /**
     * Fencing token of the current claim (security review 2026-11-02): the sender renews its lease right before
     * sending and records the result only while it still holds this token, so a reclaimed row is never sent twice.
     */
    claimToken: uuid(),
    /** Earliest next try (backoff; 24 h for WhatsApp marketing caps). */
    nextAttemptAt: ts().notNull().defaultNow(),
    /** Provider delivery receipts (WhatsApp statuses webhook), for delivery-rate and cost analytics (rule 16). */
    deliveredAt: ts(),
    readAt: ts(),
    /** Provider pricing category of the delivered message (WhatsApp: utility | authentication | marketing | service). */
    pricingCategory: text(),
    billable: boolean(),
    createdAt: createdAt(),
    sentAt: ts(),
  },
  (t) => [
    check('outbox_channel_valid', sql`${t.channel} in ('inapp','email','sms','whatsapp','push')`),
    check('outbox_status_valid', sql`${t.status} in ('pending','sent','failed','cancelled','suppressed')`),
    check('outbox_locale_valid', sql`${t.locale} in ('en','hi')`),
    check(
      'outbox_pricing_category_valid',
      sql`${t.pricingCategory} is null or ${t.pricingCategory} in ('utility','authentication','authentication_international','marketing','marketing_lite','service','referral_conversion')`,
    ),
    index('outbox_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('outbox_provider_id_uq')
      .on(t.channel, t.providerId)
      .where(sql`${t.providerId} is not null`),
    index().on(t.recipientUserId),
  ],
);

/** In-app notification centre. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    body: text().notNull(),
    link: text(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    key: text().notNull(),
    channel: text().notNull(),
    locale: text().notNull(),
    subject: text(),
    body: text().notNull(),
    dltTemplateId: text(),
    enabled: boolean().notNull().default(true),
    version: version(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.channel, t.locale] }),
    check('templates_locale_valid', sql`${t.locale} in ('en','hi')`),
    index().on(t.updatedBy),
  ],
);

/** Admin-controlled settings, global or per city (timeouts, windows, COD caps, thresholds…). */
export const settings = pgTable(
  'settings',
  {
    id: id(),
    cityId: uuid().references(() => cities.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    value: jsonb().notNull(),
    version: version(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [unique('settings_scope_key_uq').on(t.cityId, t.key).nullsNotDistinct(), index().on(t.updatedBy)],
);

/** CMS: every admin-editable string/section (complete control, decisions 2026-10-31). */
export const contentBlocks = pgTable(
  'content_blocks',
  {
    id: id(),
    key: text().notNull(),
    locale: text().notNull(),
    cityId: uuid().references(() => cities.id, { onDelete: 'cascade' }),
    value: jsonb().notNull(),
    status: text().notNull().default('draft'),
    version: version(),
    publishedAt: ts(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('content_blocks_scope_uq').on(t.key, t.locale, t.cityId, t.status).nullsNotDistinct(),
    check('content_blocks_locale_valid', sql`${t.locale} in ('en','hi')`),
    check('content_blocks_status_valid', sql`${t.status} in ('draft','published')`),
    index().on(t.updatedBy),
    index().on(t.cityId),
  ],
);

export const featureFlags = pgTable('feature_flags', {
  key: text().primaryKey(),
  enabled: boolean().notNull().default(false),
  rules: jsonb()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
});

/** docs/specs/09-support.md */
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    code: text().notNull().unique(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    guestName: text(),
    guestPhone: text(),
    accessKeyHash: text(),
    kind: text().notNull(),
    orderId: uuid().references(() => orders.id, { onDelete: 'set null' }),
    serviceRequestId: uuid(),
    /** City of the linked order (staff scope, rule 7); null = city unknown, visible to all-city staff only. */
    cityId: uuid().references(() => cities.id, { onDelete: 'set null' }),
    /** Where the request started (rule 16: a code). */
    channel: text().notNull().default('web'),
    status: text().notNull().default('open'),
    priority: text().notNull().default('normal'),
    assigneeId: uuid().references(() => users.id, { onDelete: 'set null' }),
    slaAckDue: ts().notNull(),
    slaResolveDue: ts().notNull(),
    resolvedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'support_tickets_status_valid',
      sql`${t.status} in ('open','in_review','awaiting_customer','resolved','closed')`,
    ),
    check('support_tickets_priority_valid', sql`${t.priority} in ('low','normal','high','urgent')`),
    check(
      'support_tickets_kind_valid',
      sql`${t.kind} in ('order_issue','service_issue','refund','fitment','product_sourcing','workshop_request','account','deletion_request','other')`,
    ),
    check(
      'support_tickets_owner',
      sql`${t.userId} is not null or (${t.guestPhone} is not null and ${t.accessKeyHash} is not null)`,
    ),
    check('support_tickets_channel_valid', sql`${t.channel} in ('web','app','whatsapp','email')`),
    index().on(t.status, t.slaAckDue),
    index().on(t.cityId, t.status),
    index().on(t.userId),
    index().on(t.orderId),
    index().on(t.assigneeId),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: uuid()
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    authorRole: text().notNull(),
    body: text().notNull(),
    attachments: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    internal: boolean().notNull().default(false),
    /** Where the message came from (rule 16: a code, not free text). */
    channel: text().notNull().default('web'),
    /** Provider message id (WhatsApp `wamid`): the unique index makes a redelivered message impossible to store twice. */
    externalId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check('ticket_messages_role_valid', sql`${t.authorRole} in ('customer','guest','staff','system')`),
    check(
      'ticket_messages_channel_valid',
      sql`${t.channel} in ('web','app','whatsapp','email','console','system')`,
    ),
    uniqueIndex('ticket_messages_external_uq')
      .on(t.channel, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check('ticket_messages_body_len', sql`length(${t.body}) between 1 and 5000`),
    index().on(t.ticketId, t.createdAt),
    index().on(t.authorUserId),
  ],
);

/** Admin invites to sellers (design 2026-11-13): a one-time link; only the SHA-256 of the token is stored. */
export const partnerInvites = pgTable(
  'partner_invites',
  {
    id: id(),
    tokenHash: text().notNull().unique(),
    name: text().notNull(),
    email: citext().notNull(),
    phone: text().notNull(),
    /** The city the inviting staff member may approve sellers for; the application must be in it. */
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    status: text().notNull().default('sent'),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('partner_invites_status_valid', sql`${t.status} in (${inList(INVITE_STATES)})`),
    check('partner_invites_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('partner_invites_phone', sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    uniqueIndex('partner_invites_one_open_per_phone_uq')
      .on(t.phone)
      .where(sql`${t.status} = 'sent'`),
    index().on(t.createdBy),
    index().on(t.status, t.expiresAt),
    index().on(t.cityId, t.createdAt, t.id),
  ],
);

/**
 * "Apply as a seller / workshop / mechanic" (concept launchRequest forms). Sellers (design 2026-11-13) add the
 * GST status (the GSTIN or enrolment number itself is in `kyc_enc`; `gstin_index` finds duplicates), the address,
 * the map pin and the products they sell (`partner_application_products`).
 */
export const partnerApplications = pgTable(
  'partner_applications',
  {
    id: id(),
    code: text().notNull().unique(),
    kind: text().notNull(),
    name: text().notNull(),
    phone: text().notNull(),
    email: citext(),
    business: text(),
    shopName: text(),
    shopNameHi: text(),
    pincode: text().notNull(),
    details: text(),
    /** KYC details (PAN, GSTIN, bank/UPI for payouts) as encrypted JSON (`encryptField(…, 'partner_applications.kyc_enc')`). */
    kycEnc: text(),
    gstStatus: text(),
    /** Blind index of the GSTIN or enrolment number (`blindIndex(…, 'gstin')`): duplicates without decrypting. */
    gstinIndex: text(),
    addressLine: text(),
    landmark: text(),
    location: geographyPoint(),
    locationAccuracyM: integer(),
    locationSource: text(),
    source: text().notNull().default('public'),
    inviteId: uuid().references(() => partnerInvites.id, { onDelete: 'set null' }),
    status: text().notNull().default('new'),
    reasonCode: text(),
    convertedShopId: uuid().references(() => shops.id, { onDelete: 'set null' }),
    /** Who became the shop's owner from this application (linked once, at their first sign-in; review 2026-11-13). */
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    convertedWorkshopId: uuid(),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewNote: text(),
    consentAt: ts().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('partner_applications_kind_valid', sql`${t.kind} in ('seller','garage','mechanic')`),
    check('partner_applications_status_valid', sql`${t.status} in (${inList(APPLICATION_STATES)})`),
    check('partner_applications_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('partner_applications_kyc_encrypted', encryptedCheck(t.kycEnc)),
    check('partner_applications_source_valid', sql`${t.source} in ('public','invite')`),
    check(
      'partner_applications_gst_status_valid',
      sql`${t.gstStatus} is null or ${t.gstStatus} in (${inList(GST_STATUSES)})`,
    ),
    check(
      'partner_applications_location_source_valid',
      sql`${t.locationSource} is null or ${t.locationSource} in (${inList(LOCATION_SOURCES)})`,
    ),
    check(
      'partner_applications_accuracy_nonneg',
      sql`${t.locationAccuracyM} is null or ${t.locationAccuracyM} >= 0`,
    ),
    // A seller application carries its GST status, address and map pin; other kinds keep the free-text form.
    check(
      'partner_applications_seller_complete',
      sql`${t.kind} <> 'seller' or (${t.gstStatus} is not null and ${t.addressLine} is not null and ${t.location} is not null and ${t.locationSource} is not null)`,
    ),
    check('partner_applications_details_for_others', sql`${t.kind} = 'seller' or ${t.details} is not null`),
    index().on(t.status, t.createdAt),
    index().on(t.convertedShopId),
    index().on(t.reviewedBy),
    index().on(t.gstinIndex),
    index().on(t.inviteId),
    index().on(t.phone),
    index().on(t.ownerUserId),
  ],
);

/** The catalogue products a seller ticked on the application (their prices come after approval). */
export const partnerApplicationProducts = pgTable(
  'partner_application_products',
  {
    applicationId: uuid()
      .notNull()
      .references(() => partnerApplications.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.productId] }), index().on(t.productId)],
);

/** MechDost seller agreement texts (admin CMS, versioned; Q77). */
export const agreementVersions = pgTable(
  'agreement_versions',
  {
    id: id(),
    version: integer().notNull().unique(),
    textEn: text().notNull(),
    textHi: text().notNull(),
    publishedAt: ts()
      .notNull()
      .default(sql`now()`),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [check('agreement_versions_positive', sql`${t.version} > 0`), index().on(t.createdBy)],
);

/** Which shop accepted which agreement version, by whom and when. Append-only. */
export const shopAgreements = pgTable(
  'shop_agreements',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    version: integer()
      .notNull()
      .references(() => agreementVersions.version, { onDelete: 'restrict' }),
    acceptedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptedAt: ts()
      .notNull()
      .default(sql`now()`),
  },
  (t) => [unique().on(t.shopId, t.version), index().on(t.version), index().on(t.acceptedBy)],
);

/** Reviews are verified-purchase only and admin-approved before publish (decisions 2026-10-31). */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'set null' }),
    serviceRequestId: uuid(),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    rating: smallint().notNull(),
    body: text(),
    status: text().notNull().default('pending'),
    reply: text(),
    moderatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    moderatedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
    check('reviews_target_valid', sql`${t.targetType} in ('product','shop','workshop')`),
    check('reviews_status_valid', sql`${t.status} in ('pending','approved','hidden')`),
    check('reviews_verified', sql`${t.orderId} is not null or ${t.serviceRequestId} is not null`),
    unique('reviews_one_per_purchase_uq')
      .on(t.userId, t.orderId, t.serviceRequestId, t.targetType, t.targetId)
      .nullsNotDistinct(),
    index().on(t.targetType, t.targetId, t.status),
    index().on(t.orderId),
    index().on(t.moderatedBy),
  ],
);

/**
 * Append-only history of partner standing changes (pause, suspend, reactivate) for shops now and workshops and
 * mechanics once their tables exist (decision 2026-11-01). `reason` is shown to the partner; `internal_note` is
 * staff-only.
 */
export const partnerStatusEvents = pgTable(
  'partner_status_events',
  {
    id: id(),
    partnerKind: text().notNull(),
    partnerId: uuid().notNull(),
    fromStatus: text().notNull(),
    toStatus: text().notNull(),
    /** Why, as a code (`PARTNER_STANDING_REASONS`, hard rule 16); null on rows written before migration 0049. */
    reasonCode: text(),
    reason: text().notNull(),
    internalNote: text(),
    endsAt: ts(),
    changedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('partner_status_events_kind_valid', sql`${t.partnerKind} in ('shop','workshop','mechanic')`),
    check(
      'partner_status_events_status_valid',
      sql`${t.toStatus} in ('approved','paused','suspended') and ${t.fromStatus} <> ${t.toStatus}`,
    ),
    check('partner_status_events_reason_length', sql`char_length(${t.reason}) between 5 and 300`),
    check(
      'partner_status_events_reason_code_valid',
      sql`${t.reasonCode} is null or ${t.reasonCode} in (${inList(PARTNER_STANDING_REASONS)})`,
    ),
    index().on(t.partnerKind, t.partnerId, t.createdAt),
    index().on(t.changedBy),
  ],
);

/**
 * Live-update outbox (decision 2026-11-01, docs/research/realtime-alternatives.md): one row per changed entity,
 * written by triggers in the same transaction as the change, so a rolled-back change never pings and a crash
 * after commit never loses one. The relay in the worker claims rows (`FOR UPDATE SKIP LOCKED`), resolves
 * recipients from Postgres and publishes thin pings `{e,k,id,v,at}` (packages/shared/src/live.ts) to the active
 * transport (Firebase RTDB inbox; polling needs nothing). Sent rows are purged after 24 h. No PII here.
 */
export const liveOutbox = pgTable(
  'live_outbox',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    topic: text().notNull(),
    kind: text().notNull(),
    entityId: uuid().notNull(),
    entityVersion: integer().notNull(),
    event: text().notNull(),
    attempts: integer().notNull().default(0),
    claimedAt: ts(),
    sentAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'live_outbox_topic_format',
      sql`${t.topic} ~ '^(order|shop|workshop|user|staff_city|quote):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      'live_outbox_kind_valid',
      sql`${t.kind} in ('order','assignment','shop','workshop','request','quote','coins')`,
    ),
    check('live_outbox_event_format', sql`${t.event} ~ '^[a-z_]+[.][a-z_]+$'`),
    check('live_outbox_version_positive', sql`${t.entityVersion} >= 1`),
    check('live_outbox_attempts_nonneg', sql`${t.attempts} >= 0`),
    index('live_outbox_pending_idx')
      .on(t.id)
      .where(sql`${t.sentAt} is null`),
    index('live_outbox_sent_idx')
      .on(t.sentAt)
      .where(sql`${t.sentAt} is not null`),
  ],
);

/**
 * Live-update inboxes to wipe (security review 2026-11-01 follow-up): when someone loses access — account
 * deactivated, removed from a shop, staff role revoked — triggers queue their Firebase uid here in the same
 * transaction, and the relay deletes `inbox/{uid}` so no stale ids stay readable. Rows are tiny and purged after
 * 7 days; the history of the access change itself lives in `audit_log`.
 */
export const liveRevocations = pgTable(
  'live_revocations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    firebaseUid: text().notNull(),
    /** Null = wipe the whole inbox; otherwise one node (`{kind}~{uuid}`), e.g. an order a shop no longer holds. */
    node: text(),
    reason: text().notNull(),
    attempts: integer().notNull().default(0),
    /** When the latest pass ran; the second pass waits REWIPE_SECONDS after it (not after created_at). */
    wipedAt: ts(),
    doneAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'live_revocations_reason_valid',
      sql`${t.reason} in ('deactivated','partner_removed','role_revoked','role_changed','uid_changed','assignment_ended')`,
    ),
    check(
      'live_revocations_node_format',
      sql`${t.node} is null or ${t.node} ~ '^(order|assignment)~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    index('live_revocations_pending_idx')
      .on(t.id)
      .where(sql`${t.doneAt} is null`),
  ],
);

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Customer blocks (shared/customers.ts; research/admin-console.md §5). At most one active (not lifted) block per
 * user and level, enforced by a partial unique index. Lifting keeps the row (who, when, why): history is never
 * deleted. An expired `ends_at` stops the block without lifting it. Enforced in the API: sign-in (`full`),
 * order placement (`orders`), cash on delivery (`cod_only`).
 */
export const customerBlocks = pgTable(
  'customer_blocks',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: text().notNull(),
    reasonCode: text().notNull(),
    note: text(),
    endsAt: ts(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    liftedAt: ts(),
    liftedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    liftedReason: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('customer_blocks_level_valid', sql`${t.level} in (${quoted(CUSTOMER_BLOCK_LEVELS)})`),
    check('customer_blocks_reason_valid', sql`${t.reasonCode} in (${quoted(CUSTOMER_BLOCK_REASONS)})`),
    check('customer_blocks_note_length', sql`${t.note} is null or char_length(${t.note}) <= 500`),
    check('customer_blocks_ends_after_start', sql`${t.endsAt} is null or ${t.endsAt} > ${t.createdAt}`),
    check(
      'customer_blocks_lift_complete',
      sql`(${t.liftedAt} is null and ${t.liftedBy} is null and ${t.liftedReason} is null) or (${t.liftedAt} is not null and ${t.liftedBy} is not null and char_length(${t.liftedReason}) between 5 and 300)`,
    ),
    check('customer_blocks_not_self', sql`${t.createdBy} <> ${t.userId}`),
    uniqueIndex('customer_blocks_one_active_uq')
      .on(t.userId, t.level)
      .where(sql`lifted_at is null`),
    index().on(t.userId, t.createdAt),
    index().on(t.createdBy),
    index().on(t.liftedBy),
  ],
);
