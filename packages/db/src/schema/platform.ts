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
import { createdAt, encryptedCheck, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { orders } from './orders';
import { shops } from './catalogue';

/** Brandur-style idempotency keys for money-moving endpoints (docs/research/data-integrity.md §4). */
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
    index().on(t.status, t.slaAckDue),
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
    createdAt: createdAt(),
  },
  (t) => [
    check('ticket_messages_role_valid', sql`${t.authorRole} in ('customer','guest','staff','system')`),
    check('ticket_messages_body_len', sql`length(${t.body}) between 1 and 5000`),
    index().on(t.ticketId, t.createdAt),
    index().on(t.authorUserId),
  ],
);

/** "Apply as a seller / workshop / mechanic" (concept launchRequest forms). */
export const partnerApplications = pgTable(
  'partner_applications',
  {
    id: id(),
    code: text().notNull().unique(),
    kind: text().notNull(),
    name: text().notNull(),
    phone: text().notNull(),
    business: text(),
    pincode: text().notNull(),
    details: text().notNull(),
    /** KYC details (PAN, GSTIN, bank/UPI for payouts) as encrypted JSON (`encryptField(…, 'partner_applications.kyc_enc')`). */
    kycEnc: text(),
    status: text().notNull().default('new'),
    convertedShopId: uuid().references(() => shops.id, { onDelete: 'set null' }),
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
    check('partner_applications_status_valid', sql`${t.status} in ('new','in_review','approved','rejected')`),
    check('partner_applications_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('partner_applications_kyc_encrypted', encryptedCheck(t.kycEnc)),
    index().on(t.status, t.createdAt),
    index().on(t.convertedShopId),
    index().on(t.reviewedBy),
  ],
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
