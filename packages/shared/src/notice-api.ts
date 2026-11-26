/**
 * Request and response shapes of `/v1/me/notifications`, `/v1/me/push-devices` and
 * `/v1/me/notification-preferences` (design 2026-11-15 bell and push), for the API routes and the website
 * (hard rule 4). Bodies are strict: no unknown field is accepted. This file never imports the notice texts (those
 * stay on the server), so the website can use it without pulling the locale files into a page.
 */
import { z } from 'zod';

export const NOTICE_CATEGORIES = ['transactional', 'promotional', 'reminders'] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_ENTITY_TYPES = [
  'order',
  'service_request',
  'rsa_request',
  'quote',
  'ticket',
  'refund',
  'shop',
  'application',
  'account',
  // Ustaad Network (spec 23 § 12): one entity type; the kind says what it is about.
  'ustaad',
  // The platform itself (usage and free limits, 2026-11-26).
  'platform',
] as const;
export type NoticeEntityType = (typeof NOTICE_ENTITY_TYPES)[number];

/**
 * How much a notification matters (spec 10, decision 2026-11-25). One code per kind, set where the notice is written
 * and stored on the row so the inbox order is an index scan: `urgent` is time-critical or blocks money/orders,
 * `action` asks the person to do something, `info` is a status update, `success` is a good outcome.
 */
export const NOTICE_PRIORITIES = ['urgent', 'action', 'info', 'success'] as const;
export type NoticePriority = (typeof NOTICE_PRIORITIES)[number];

/** The priority of every notice kind (a unit test keeps this equal to the catalogue's kinds). */
export const NOTICE_PRIORITY_OF_KIND = {
  // Customer: orders and money
  'order.placed': 'info',
  'order.confirmed': 'success',
  'order.out_for_delivery': 'info',
  'order.delivered': 'success',
  'order.cancelled': 'info',
  'order.rejected': 'info',
  'payment.received': 'success',
  'refund.requested': 'info',
  'refund.processed': 'success',
  'refund.failed': 'urgent',
  'refund.declined': 'info',
  // Customer: services, roadside, quotes, support
  'service.received': 'info',
  'service.proposed': 'action',
  'service.confirmed': 'success',
  'service.estimate_ready': 'action',
  'service.ready': 'info',
  'service.bill_ready': 'action',
  'service.completed': 'success',
  'service.cancelled': 'info',
  'rsa.accepted': 'info',
  'rsa.arrived': 'info',
  'rsa.bill_ready': 'action',
  'rsa.refunded': 'success',
  'quote.offer': 'action',
  'quote.expiring': 'urgent',
  'account.pin_served': 'success',
  'ticket.received': 'info',
  'ticket.reply': 'action',
  'ticket.resolved': 'success',
  // Shops and workshops
  'rsa.offer': 'urgent',
  'shop.order_routed': 'urgent',
  'shop.offer_expiring': 'urgent',
  'partner.warning': 'action',
  // Ustaad Network (spec 23 § 12)
  'ustaad.question_waiting': 'action',
  'ustaad.answer_received': 'info',
  'ustaad.best_answer': 'success',
  'ustaad.reply': 'info',
  'ustaad.likes_digest': 'info',
  'ustaad.follow': 'info',
  'ustaad.connect_request': 'action',
  'ustaad.connect_accepted': 'success',
  'ustaad.message_request': 'action',
  'ustaad.message': 'info',
  'ustaad.vouch_requested': 'action',
  'ustaad.attestation_requested': 'action',
  'ustaad.verification_decided': 'info',
  'ustaad.level_up': 'success',
  'ustaad.badge_earned': 'success',
  'ustaad.mentor_request': 'action',
  'ustaad.mentor_accepted': 'success',
  'ustaad.job_application': 'action',
  'ustaad.application_status': 'info',
  'ustaad.report_outcome': 'info',
  'ustaad.content_removed': 'action',
  'ustaad.strike': 'action',
  'ustaad.rules_reminder': 'info',
  'ustaad.invite': 'action',
  'ustaad.security_freeze': 'urgent',
  'staff.ustaad_report': 'action',
  'staff.ustaad_report_overdue': 'urgent',
  'staff.ustaad_media_budget': 'urgent',
  'staff.ustaad_verification': 'action',
  // Delivery agents (spec 24)
  'delivery.offer': 'urgent',
  'delivery.job_withdrawn': 'info',
  'delivery.retry': 'action',
  'delivery.return_to_shop': 'action',
  'delivery.document_decided': 'info',
  'delivery.status_changed': 'info',
  'shop.delivery_agent_assigned': 'info',
  'shop.delivery_switch': 'action',
  'shop.delivery_returning': 'action',
  'shop.delivery_mode_decided': 'info',
  'order.picked_up': 'info',
  'order.delivery_failed': 'info',
  'order.returned': 'info',
  'staff.delivery_agent_application': 'action',
  'staff.delivery_documents': 'action',
  'staff.delivery_needs_agent': 'urgent',
  'staff.delivery_offer_expired': 'urgent',
  'staff.delivery_declined': 'urgent',
  'staff.delivery_failed': 'urgent',
  'staff.delivery_switch_declined': 'urgent',
  'staff.shop_delivery_mode_request': 'action',
  'staff.delivery_low_rating': 'action',
  'staff.delivery_agent_unavailable': 'urgent',
  // Staff
  'staff.usage_alert': 'urgent',
  'staff.rsa_cash': 'info',
  'staff.order_needs_routing': 'urgent',
  'staff.shop_declined': 'urgent',
  'staff.shop_timed_out': 'urgent',
  'staff.shop_gave_up': 'urgent',
  'staff.refund_overdue': 'urgent',
  'staff.refund_alert': 'urgent',
  'staff.new_application': 'action',
  'staff.new_ticket': 'action',
} as const satisfies Record<string, NoticePriority>;

/** Unknown or missing kinds are `info`: a stray code must never look urgent. */
export function noticePriorityOf(kind: string | null): NoticePriority {
  return kind !== null && Object.hasOwn(NOTICE_PRIORITY_OF_KIND, kind)
    ? NOTICE_PRIORITY_OF_KIND[kind as keyof typeof NOTICE_PRIORITY_OF_KIND]
    : 'info';
}

/**
 * Inbox order group: 0 = unread and urgent, 1 = unread, 2 = read (then newest first inside each group). The database
 * computes the same expression (`notifications_inbox_idx`); this is its mirror for the website and the tests.
 */
export function noticeBucket(n: { read: boolean; priority: NoticePriority }): 0 | 1 | 2 {
  return n.read ? 2 : n.priority === 'urgent' ? 0 : 1;
}

/** Latest notifications in the bell dropdown. */
export const BELL_PAGE_SIZE = 10;
export const NOTICE_PAGE_MAX = 50;
/** Ids in one "mark read" call. */
export const NOTICE_READ_MAX = 100;
/** Bell badge shows this many, then "99+". */
export const BELL_BADGE_MAX = 99;

/** Push devices one person may keep (an old phone, a laptop, a tablet…); the oldest is revoked past this. */
export const PUSH_DEVICES_MAX = 10;
export const PUSH_TOKEN_MIN = 20;
export const PUSH_TOKEN_MAX = 4096;

/** Only a path on this site: no scheme, no host, no `//`. */
const LocalPath = z.string().regex(/^\/[^/\\]/);

export const NoticeDto = z
  .object({
    id: z.uuid(),
    kind: z.string().nullable(),
    category: z.enum(NOTICE_CATEGORIES),
    /** urgent / action / info / success: drives the colour, icon and sort order (never colour alone). */
    priority: z.enum(NOTICE_PRIORITIES),
    title: z.string(),
    body: z.string(),
    link: LocalPath.nullable(),
    read: z.boolean(),
    /** The action it asked for is no longer needed (order routed, refund decided…): shown as done, never as new. */
    resolved: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type Notice = z.infer<typeof NoticeDto>;

export const NoticePageDto = z
  .object({ notices: z.array(NoticeDto), nextCursor: z.string().nullable(), unread: z.number().int().min(0) })
  .strict();
export type NoticePage = z.infer<typeof NoticePageDto>;

export const NoticeCountDto = z.object({ unread: z.number().int().min(0) }).strict();

/** Ids (own rows only; a foreign id counts as nothing) or everything unread. */
export const NoticeReadDto = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(NOTICE_READ_MAX) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export const NoticeReadResultDto = z
  .object({ updated: z.number().int().min(0), unread: z.number().int().min(0) })
  .strict();

/**
 * Removing notifications from the inbox is a soft delete (`dismissed_at`) so "Undo" can bring them back. The token is
 * the batch's timestamp as Postgres writes it; only the person's own rows with exactly that timestamp come back.
 */
export const UNDO_TOKEN = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/);
export const NoticeDismissResultDto = z
  .object({ dismissed: z.literal(true), undoToken: UNDO_TOKEN, unread: z.number().int().min(0) })
  .strict();
export const NoticeClearResultDto = z
  .object({
    cleared: z.number().int().min(0),
    /** Null when nothing was read (nothing to undo). */
    undoToken: UNDO_TOKEN.nullable(),
    unread: z.number().int().min(0),
  })
  .strict();
export const NoticeRestoreDto = z.object({ undoToken: UNDO_TOKEN }).strict();
export const NoticeRestoreResultDto = z
  .object({ restored: z.number().int().min(0), unread: z.number().int().min(0) })
  .strict();

export const PushDeviceCreateDto = z
  .object({
    token: z.string().min(PUSH_TOKEN_MIN).max(PUSH_TOKEN_MAX),
    locale: z.enum(['en', 'hi']),
    platform: z.literal('web').default('web'),
  })
  .strict();
export const PushDeviceDto = z
  .object({ id: z.uuid(), platform: z.enum(['web', 'android', 'ios']), registered: z.literal(true) })
  .strict();

export const PushDeviceRemovedDto = z.object({ removed: z.literal(true) }).strict();

export const NoticePreferencesDto = z
  .object({
    /** Push for order, booking and support updates (in-app is always on). */
    pushTransactional: z.boolean(),
    /** Offers and promotions: needs the marketing consent, which this switch grants or withdraws. */
    promotions: z.boolean(),
  })
  .strict();
export type NoticePreferences = z.infer<typeof NoticePreferencesDto>;
export const NoticePreferencesPatchDto = NoticePreferencesDto.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

/** What the preferences screen needs: the choices plus how long "Not now" hides the push card. */
export const NoticePreferencesViewDto = NoticePreferencesDto.extend({
  promptSnoozeDays: z.number().int().min(1).max(90),
}).strict();
export type NoticePreferencesView = z.infer<typeof NoticePreferencesViewDto>;

// ── Admin → Notifications → Messages (bell and push text) ─────────────────────────────────────────────────────

export const NOTICE_TEMPLATE_CHANNELS = ['inapp', 'push'] as const;
const Lang = z.enum(['en', 'hi']);
const ChannelEnum = z.enum(NOTICE_TEMPLATE_CHANNELS);

export const NoticeTemplateRowDto = z
  .object({
    key: z.string(),
    channel: ChannelEnum,
    locale: Lang,
    title: z.string().nullable(),
    body: z.string(),
    enabled: z.boolean(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .strict();
export type NoticeTemplateRow = z.infer<typeof NoticeTemplateRowDto>;
const CopyDto = z.object({ title: z.string(), body: z.string() }).strict();
/** One message the editor can change: who gets it, its placeholders and the shipped text in both languages. */
export const NoticeCatalogueEntryDto = z
  .object({
    key: z.string(),
    audience: z.enum(['customer', 'partner', 'staff', 'member']),
    category: z.enum(NOTICE_CATEGORIES),
    placeholders: z.array(z.string()),
    defaults: z.object({ en: CopyDto, hi: CopyDto }).strict(),
  })
  .strict();
export type NoticeCatalogueEntry = z.infer<typeof NoticeCatalogueEntryDto>;
export const NoticeTemplateListDto = z
  .object({ templates: z.array(NoticeTemplateRowDto), catalogue: z.array(NoticeCatalogueEntryDto) })
  .strict();

/** Save one message in one language and channel (compare-and-set: `version` null creates). Blank = the default. */
export const NoticeTemplateSaveDto = z
  .object({
    key: z.string().min(1).max(64),
    channel: ChannelEnum,
    locale: Lang,
    title: z.string().max(200).nullable(),
    body: z.string().max(1000).nullable(),
    enabled: z.boolean(),
    version: z.number().int().min(1).nullable(),
  })
  .strict();
export const NoticeTemplateResetDto = z
  .object({
    key: z.string().min(1).max(64),
    channel: ChannelEnum,
    locale: Lang,
    version: z.number().int().min(1),
  })
  .strict();

/** Version of the marketing notice the promotions switch records (bump when the wording changes: DPDP). */
export const MARKETING_NOTICE_VERSION = '2026-11-15';
