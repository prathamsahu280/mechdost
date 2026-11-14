/**
 * Response shapes of the admin notification, settings, content and customer-block routes
 * (`apps/api/src/routes/admin-notifications.ts`, `admin-settings.ts`, `content.ts`, `admin-customers.ts`; spec 08,
 * spec 10), for the web admin screens in real sign-in builds to validate what they receive (hard rule 4). Loaded
 * only by those screens (dynamic import), never by demo bundles.
 */
import { z } from 'zod';
import { CUSTOMER_BLOCK_LEVELS, CUSTOMER_BLOCK_REASONS } from './customers';

const Int = z.number().int();
const Version = z.object({ version: Int });
/** `{ version }` answers of the compare-and-set saves. */
export const SavedVersion = Version;
export const OkTrue = z.object({ ok: z.literal(true) });

// Notifications (spec 10) -----------------------------------------------------------------------------------

export const NOTIFY_CHANNELS = ['inapp', 'email', 'sms', 'whatsapp', 'push'] as const;
export const NotificationTemplate = z.object({
  key: z.string(),
  channel: z.enum(NOTIFY_CHANNELS),
  locale: z.enum(['en', 'hi']),
  subject: z.string().nullable(),
  body: z.string(),
  enabled: z.boolean(),
  version: Int,
  updatedAt: z.string(),
});
export type NotificationTemplateDto = z.infer<typeof NotificationTemplate>;

export const NotificationTemplateList = z.object({
  templates: z.array(NotificationTemplate),
  whatsappCatalogue: z.array(
    z.object({
      key: z.string(),
      metaName: z.string(),
      category: z.string(),
      params: z.array(z.string()),
      audience: z.string(),
    }),
  ),
});

/** One saved email override per template and language (no row = the code default, on). Spec 10, design 2026-11-15. */
export const EmailTemplateRow = z.object({
  key: z.string(),
  locale: z.enum(['en', 'hi']),
  subject: z.string().nullable(),
  heading: z.string().nullable(),
  body: z.string(),
  buttonLabel: z.string().nullable(),
  enabled: z.boolean(),
  version: Int,
  updatedAt: z.string(),
});
export type EmailTemplateRowDto = z.infer<typeof EmailTemplateRow>;
export const EmailTemplateList = z.object({ templates: z.array(EmailTemplateRow) });

/** Body of the email save (compare-and-set: `version` null creates). Text fields: null or '' = the code default. */
export const EmailTemplateSave = z
  .object({
    key: z.string().min(1).max(64),
    locale: z.enum(['en', 'hi']),
    subject: z.string().max(200).nullable(),
    heading: z.string().max(200).nullable(),
    body: z.string().max(4000).nullable(),
    buttonLabel: z.string().max(100).nullable(),
    enabled: z.boolean(),
    version: Int.min(1).nullable(),
  })
  .strict();
export type EmailTemplateSaveDto = z.infer<typeof EmailTemplateSave>;

export const WhatsAppUsage = z.object({
  budgetPaise: Int.nullable(),
  budgetVersion: Int.nullable(),
  monthStart: z.string(),
  sent: Int,
  delivered: Int,
  read: Int,
  failed: Int,
  costPaise: Int,
  overBudget: z.boolean(),
  byCategory: z.array(z.object({ category: z.string(), billable: Int, costPaise: Int })),
});
export type WhatsAppUsageDto = z.infer<typeof WhatsAppUsage>;

// Settings (spec 08 "Settings") ------------------------------------------------------------------------------

const SettingValue = z.union([Int, z.boolean(), z.null()]);
const SettingRef = z.object({ value: SettingValue, version: Int });
export const AdminSettingRow = z.object({
  key: z.string(),
  default: SettingValue,
  global: SettingRef.nullable(),
  city: SettingRef.nullable(),
  effective: SettingValue,
});
export type AdminSettingRowDto = z.infer<typeof AdminSettingRow>;
export const AdminSettingList = z.object({ settings: z.array(AdminSettingRow) });

// Content (spec 08 "Content") --------------------------------------------------------------------------------

export const PolicyDocument = z.object({
  title: z.string(),
  lead: z.string(),
  updatedOn: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string(), emoji: z.string().optional() })),
});
const ContentValue = z.union([z.string(), PolicyDocument]);
export const AdminContentEntry = z.object({
  key: z.string(),
  locale: z.enum(['en', 'hi']),
  draft: z.object({ value: ContentValue, version: Int }).nullable(),
  published: z.object({ value: ContentValue, version: Int, publishedAt: z.string().nullable() }).nullable(),
});
export type AdminContentEntryDto = z.infer<typeof AdminContentEntry>;
export const AdminContentList = z.object({ entries: z.array(AdminContentEntry) });
export const AdminContentSaved = z.object({ version: Int, value: ContentValue });

// Customer blocks (research/admin-console.md §5) --------------------------------------------------------------

export const CustomerBlock = z.object({
  id: z.string(),
  level: z.enum(CUSTOMER_BLOCK_LEVELS),
  /** A reason added later reads as "other" until the screens know it. */
  reasonCode: z.enum(CUSTOMER_BLOCK_REASONS).catch('other'),
  note: z.string().nullable(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  liftedAt: z.string().nullable(),
  liftedReason: z.string().nullable(),
  inForce: z.boolean(),
  version: Int,
});
export type CustomerBlockDto = z.infer<typeof CustomerBlock>;
export const CustomerBlockList = z.object({ blocks: z.array(CustomerBlock) });
export const CustomerBlockCreated = z.object({ id: z.string(), version: Int });
