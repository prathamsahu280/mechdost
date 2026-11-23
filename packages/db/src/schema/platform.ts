import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { PARTNER_WARNING_REASONS, WARNING_PARTNER_KINDS } from '@mechdost/shared/partner-warnings';
import { REVIEW_HIDE_REASONS, REVIEW_STATES } from '@mechdost/shared/reviews';
import { APPLICATION_STATES, INVITE_STATES } from '@mechdost/shared/state';
import { SUPPORT_ISSUE_CODES } from '@mechdost/shared/support-thread';
import { citext, createdAt, encryptedCheck, geographyPoint, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { orders } from './orders';
import { products, shops } from './catalogue';
import { serviceRequests, workshops } from './services';

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
  (t) => [
    index().on(t.entity, t.entityId, t.createdAt),
    index().on(t.actorUserId, t.createdAt),
    // Admin audit viewer (design 2026-11-15): newest first by id under each filter, and the IST date range.
    index('audit_log_entity_id_idx').on(t.entity, t.id),
    index('audit_log_action_id_idx').on(t.action, t.id),
    index('audit_log_actor_id_idx').on(t.actorUserId, t.id),
    index('audit_log_created_idx').on(t.createdAt),
  ],
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

/**
 * In-app notification centre (spec 10, design 2026-11-15). Rows are written in the business transaction by
 * `queueNotice`, already rendered in the recipient's language (plain text; no personal data beyond what the person
 * sees on the page the link opens). `dedupe_key` makes a retried transaction write once.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `transactional` cannot be switched off in-app; `promotional` needs the marketing consent. */
    category: text().notNull().default('transactional'),
    /** Code such as `order.confirmed` (rule 16: a code, never free text). */
    kind: text(),
    entityType: text(),
    entityId: text(),
    dedupeKey: text(),
    title: text().notNull(),
    body: text().notNull(),
    link: text(),
    readAt: ts(),
    /**
     * Set (with `read_at`) when the thing the notice asked for no longer needs doing: the order was routed, the
     * refund decided, the ticket answered… The bell shows it as done and it stops counting as unread.
     */
    resolvedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    check('notifications_category_valid', sql`${t.category} in ('transactional','promotional','reminders')`),
    check(
      'notifications_entity_type_valid',
      sql`${t.entityType} is null or ${t.entityType} in ('order','service_request','quote','ticket','refund','shop','application','account')`,
    ),
    check('notifications_link_local', sql`${t.link} is null or ${t.link} ~ '^/[^/\\\\]'`),
    index().on(t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    uniqueIndex('notifications_dedupe_uq')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('notifications_created_idx').on(t.createdAt),
    // Finds the still-open notices of one thing when it is resolved (`=` and `LIKE 'id:%'` both use it).
    index('notifications_open_entity_idx')
      .on(t.kind, sql`${t.entityId} text_pattern_ops`)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

/**
 * Browser (later app) push tokens (spec 10). A token is personal data: never in analytics or logs. `revoked_at`
 * is set on sign-out, opt-out, or when Firebase reports the token invalid. One row per token.
 */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fcmToken: text().notNull(),
    platform: text().notNull().default('web'),
    /** Browser family only (`chrome`, `firefox`, `safari`, `edge`, `other`), never the full user agent. */
    uaFamily: text().notNull().default('other'),
    locale: text().notNull().default('en'),
    createdAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
  },
  (t) => [
    check('push_devices_platform_valid', sql`${t.platform} in ('web','android','ios')`),
    check('push_devices_locale_valid', sql`${t.locale} in ('en','hi')`),
    check('push_devices_ua_valid', sql`${t.uaFamily} in ('chrome','firefox','safari','edge','other')`),
    check('push_devices_token_len', sql`char_length(${t.fcmToken}) between 20 and 4096`),
    uniqueIndex('push_devices_token_uq').on(t.fcmToken),
    index('push_devices_user_live_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    key: text().notNull(),
    channel: text().notNull(),
    locale: text().notNull(),
    subject: text(),
    /** Email only (design 2026-11-15): the big line above the body; null = the code default. */
    heading: text(),
    /** For an email row, '' means no body override (the code default is used); other channels always carry text. */
    body: text().notNull(),
    /** Email only: the button label; null = the code default. */
    buttonLabel: text(),
    dltTemplateId: text(),
    enabled: boolean().notNull().default(true),
    version: version(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.channel, t.locale] }),
    check('templates_locale_valid', sql`${t.locale} in ('en','hi')`),
    check('templates_heading_len', sql`${t.heading} is null or char_length(${t.heading}) <= 120`),
    check('templates_button_label_len', sql`${t.buttonLabel} is null or char_length(${t.buttonLabel}) <= 40`),
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

/**
 * Append-only history of what went live for a content entry (policy pages above all; design 2026-11-15 item 5).
 * One row per publish or restore, numbered per entry (key, locale, city) from 1; restoring an old version writes a
 * new row (`action` 'restored', `restoredFrom`), old rows are never changed (trigger `content_versions_append_only`).
 */
export const contentVersions = pgTable(
  'content_versions',
  {
    id: id(),
    key: text().notNull(),
    locale: text().notNull(),
    cityId: uuid().references(() => cities.id, { onDelete: 'cascade' }),
    versionNo: integer().notNull(),
    value: jsonb().notNull(),
    action: text().notNull(),
    restoredFrom: integer(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('content_versions_entry_uq').on(t.key, t.locale, t.cityId, t.versionNo).nullsNotDistinct(),
    check('content_versions_locale_valid', sql`${t.locale} in ('en','hi')`),
    check('content_versions_action_valid', sql`${t.action} in ('published','restored')`),
    check('content_versions_no_positive', sql`${t.versionNo} >= 1`),
    check(
      'content_versions_restored_from',
      sql`(${t.action} = 'restored') = (${t.restoredFrom} is not null)`,
    ),
    index().on(t.createdBy),
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
    /**
     * Quick issue code of an order/request thread (design 2026-11-15; null for older, free-form tickets). One thread
     * open per customer and order (or service request): the partial unique indexes below (a closed one frees the slot).
     */
    issueCode: text(),
    /** COD refund destination (Q104): UPI id or bank details as JSON, encrypted (AAD 'support_tickets.refund_destination_enc'). */
    refundDestinationEnc: text(),
    /** What staff and the customer see of it ("ra***@okbank", "••••1234 · HDFC0001234"); never the full value. */
    refundDestinationMask: text(),
    refundDestinationAt: ts(),
    status: text().notNull().default('open'),
    priority: text().notNull().default('normal'),
    assigneeId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** First-reply target: working minutes inside the support hours (IST, admin settings; design 2026-11-15 item 4). */
    slaAckDue: ts().notNull(),
    slaResolveDue: ts().notNull(),
    /** When staff first answered the customer (an internal note does not count); null until then. */
    firstRepliedAt: ts(),
    /** When the current assignee took the request (audited in `audit_log`). */
    assignedAt: ts(),
    resolvedAt: ts(),
    /** Closed by the worker 7 days after "resolved" (`auto`), or by staff (`staff`); null while open. */
    closedAt: ts(),
    closeReason: text(),
    /** Account deletion requests only: the support agent who confirmed it (nothing is deleted by this; Q122). */
    deletionConfirmedAt: ts(),
    deletionConfirmedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
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
      sql`${t.kind} in ('order_issue','service_issue','refund','fitment','product_sourcing','workshop_request','account','deletion_request','labour_redo','other')`,
    ),
    check(
      'support_tickets_owner',
      sql`${t.userId} is not null or (${t.guestPhone} is not null and ${t.accessKeyHash} is not null)`,
    ),
    check('support_tickets_channel_valid', sql`${t.channel} in ('web','app','whatsapp','email')`),
    check(
      'support_tickets_close_reason_valid',
      sql`${t.closeReason} is null or ${t.closeReason} in ('auto','staff')`,
    ),
    check(
      'support_tickets_deletion_confirm_kind',
      sql`${t.deletionConfirmedAt} is null or ${t.kind} = 'deletion_request'`,
    ),
    uniqueIndex('support_tickets_one_deletion_uq')
      .on(t.userId)
      .where(sql`${t.kind} = 'deletion_request' and ${t.status} <> 'closed'`),
    index('support_tickets_auto_close_idx')
      .on(t.resolvedAt)
      .where(sql`${t.status} = 'resolved'`),
    index().on(t.deletionConfirmedBy),
    check(
      'support_tickets_issue_code_valid',
      sql`${t.issueCode} is null or ${t.issueCode} in (${sql.raw(SUPPORT_ISSUE_CODES.map((c) => `'${c}'`).join(','))})`,
    ),
    check('support_tickets_refund_destination_encrypted', encryptedCheck(t.refundDestinationEnc)),
    check(
      'support_tickets_refund_destination_pair',
      sql`(${t.refundDestinationEnc} is null) = (${t.refundDestinationMask} is null)`,
    ),
    uniqueIndex('support_tickets_order_thread_uq')
      .on(t.userId, t.orderId)
      .where(sql`${t.issueCode} is not null and ${t.orderId} is not null and ${t.status} <> 'closed'`),
    uniqueIndex('support_tickets_service_thread_uq')
      .on(t.userId, t.serviceRequestId)
      .where(
        sql`${t.issueCode} is not null and ${t.serviceRequestId} is not null and ${t.status} <> 'closed'`,
      ),
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

/**
 * Canned replies (design 2026-11-15 item 4): admin-edited answer texts, one per language. Staff insert one into the
 * reply box and edit it before sending, so the stored text is never sent unchecked. Rows are switched off, not deleted.
 */
export const cannedReplies = pgTable(
  'canned_replies',
  {
    id: id(),
    /** Stable slug (the analytics code of the reply), e.g. `refund_started`. */
    key: text().notNull().unique(),
    titleEn: text().notNull(),
    titleHi: text().notNull(),
    bodyEn: text().notNull(),
    bodyHi: text().notNull(),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(100),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('canned_replies_key_valid', sql`${t.key} ~ '^[a-z][a-z0-9_]{2,39}$'`),
    check(
      'canned_replies_title_len',
      sql`length(${t.titleEn}) between 1 and 80 and length(${t.titleHi}) between 1 and 80`,
    ),
    check(
      'canned_replies_body_len',
      sql`length(${t.bodyEn}) between 1 and 2000 and length(${t.bodyHi}) between 1 and 2000`,
    ),
    index().on(t.active, t.sortOrder),
    index().on(t.createdBy),
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

/**
 * Reviews are verified-purchase only and admin-approved before publish (decisions 2026-10-31; spec 02 § Reviews).
 * A product review links the delivered sub-order, a workshop review the paid/completed service request; one per
 * customer, target and purchase. `status` moves through `reviewMachine` (`@mechdost/shared/reviews`) by
 * compare-and-set on `version`; hiding needs a reason code. Only approved rows are public and count in ratings.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** City of the purchase, for city-scoped moderation (hard rule 7). */
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'set null' }),
    serviceRequestId: uuid().references(() => serviceRequests.id, { onDelete: 'restrict' }),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    rating: smallint().notNull(),
    /** Plain text as the customer wrote it (user content: never translated); null = stars only. */
    body: text(),
    status: text().notNull().default('pending'),
    /** Why staff hid it (`REVIEW_HIDE_REASONS`); set exactly while hidden. */
    hiddenReason: text(),
    /** Staff-only note on the last moderation. */
    moderationNote: text(),
    reply: text(),
    moderatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    moderatedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
    check('reviews_target_valid', sql`${t.targetType} in ('product','shop','workshop')`),
    check('reviews_status_valid', sql`${t.status} in (${inList(REVIEW_STATES)})`),
    check('reviews_verified', sql`${t.orderId} is not null or ${t.serviceRequestId} is not null`),
    check(
      'reviews_purchase_matches_target',
      sql`(${t.targetType} <> 'product' or ${t.orderId} is not null) and (${t.targetType} <> 'workshop' or ${t.serviceRequestId} is not null)`,
    ),
    check('reviews_body_length', sql`${t.body} is null or char_length(${t.body}) between 1 and 1000`),
    check(
      'reviews_hidden_reason',
      sql`(${t.status} = 'hidden') = (${t.hiddenReason} is not null) and (${t.hiddenReason} is null or ${t.hiddenReason} in (${inList(REVIEW_HIDE_REASONS)}))`,
    ),
    check('reviews_note_length', sql`${t.moderationNote} is null or char_length(${t.moderationNote}) <= 300`),
    check('reviews_moderated', sql`${t.status} = 'pending' or ${t.moderatedAt} is not null`),
    unique('reviews_one_per_purchase_uq')
      .on(t.userId, t.orderId, t.serviceRequestId, t.targetType, t.targetId)
      .nullsNotDistinct(),
    // Public list (approved, newest first) and rating summary per target.
    index('reviews_target_public_idx').on(t.targetType, t.targetId, t.status, t.createdAt, t.id),
    // Moderation queue (status, oldest first) and the per-customer daily limit.
    index('reviews_status_created_idx').on(t.status, t.createdAt, t.id),
    index('reviews_user_created_idx').on(t.userId, t.createdAt),
    index().on(t.cityId),
    index().on(t.orderId),
    index().on(t.serviceRequestId),
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
 * Warnings staff give a shop or workshop (spec 08, design 2026-11-15). Append-only (trigger in the migration): an
 * `issued` row is the warning; revoking one appends a `withdrawn` row pointing at it (`withdraws_id`, at most one per
 * warning), never an edit. Exactly one of `shop_id` / `workshop_id` is set, with real foreign keys. `reason_code` is
 * the code (rule 16); `note` the optional extra the partner reads. The count of live warnings in the rolling window
 * only prompts staff to consider a pause (settings `partners.warning_threshold` / `partners.warning_window_days`).
 */
export const partnerWarnings = pgTable(
  'partner_warnings',
  {
    id: id(),
    event: text().notNull().default('issued'),
    partnerKind: text().notNull(),
    shopId: uuid().references(() => shops.id, { onDelete: 'restrict' }),
    workshopId: uuid().references(() => workshops.id, { onDelete: 'restrict' }),
    reasonCode: text().notNull(),
    note: text(),
    withdrawsId: uuid().references((): AnyPgColumn => partnerWarnings.id, { onDelete: 'restrict' }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('partner_warnings_event_valid', sql`${t.event} in ('issued','withdrawn')`),
    check('partner_warnings_kind_valid', sql`${t.partnerKind} in (${inList(WARNING_PARTNER_KINDS)})`),
    check(
      'partner_warnings_one_partner',
      sql`(${t.partnerKind} = 'shop' and ${t.shopId} is not null and ${t.workshopId} is null)
        or (${t.partnerKind} = 'workshop' and ${t.workshopId} is not null and ${t.shopId} is null)`,
    ),
    check('partner_warnings_reason_code_valid', sql`${t.reasonCode} in (${inList(PARTNER_WARNING_REASONS)})`),
    check('partner_warnings_note_length', sql`${t.note} is null or char_length(${t.note}) between 5 and 300`),
    check(
      'partner_warnings_withdraws_consistent',
      sql`(${t.event} = 'withdrawn') = (${t.withdrawsId} is not null)`,
    ),
    check(
      'partner_warnings_other_needs_note',
      sql`${t.event} = 'withdrawn' or ${t.reasonCode} <> 'other' or ${t.note} is not null`,
    ),
    uniqueIndex('partner_warnings_one_withdrawal_uq')
      .on(t.withdrawsId)
      .where(sql`${t.withdrawsId} is not null`),
    index('partner_warnings_shop_idx').on(t.shopId, t.createdAt),
    index('partner_warnings_workshop_idx').on(t.workshopId, t.createdAt),
    index().on(t.createdBy),
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
      sql`${t.topic} ~ '^(order|shop|workshop|user|staff_city|quote|request):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      'live_outbox_kind_valid',
      sql`${t.kind} in ('order','assignment','shop','workshop','request','quote','coins','cart','wishlist')`,
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
