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
] as const;
export type NoticeEntityType = (typeof NOTICE_ENTITY_TYPES)[number];

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
    audience: z.enum(['customer', 'partner', 'staff']),
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
