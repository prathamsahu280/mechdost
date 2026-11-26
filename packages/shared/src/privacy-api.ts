/**
 * Account -> Privacy (DPDP; design 2026-11-15 item 6): consents per purpose with dates and withdraw buttons, the
 * deletion request (a support ticket, never a second system) and the data download request (a worker builds a bounded
 * export; the person downloads it while signed in, before it expires).
 */
import { z } from 'zod';

/**
 * Purposes a person can switch in Privacy: only the ones that change what MechDost does today. `marketing` = offers
 * and promotions in the bell and push; `analytics` = page and click events from this browser. The others in the
 * database list (`location`, `share_with_partner`, `whatsapp`) appear here when a feature uses them.
 * `personalisation` (2026-11-26, shopping personalisation phase 2) = keep the products this person views in their
 * account so the list follows them across devices; without it the list stays in this browser only. Never asked =
 * not granted (DPDP: opt-in).
 */
export const PRIVACY_PURPOSES = ['marketing', 'analytics', 'personalisation'] as const;

/** The notice the personalisation consent is given under (Account -> Privacy wording of 2026-11-26). */
export const PERSONALISATION_NOTICE_VERSION = '2026-11-26';
export type PrivacyPurpose = (typeof PRIVACY_PURPOSES)[number];

export const EXPORT_STATES = ['requested', 'ready', 'expired', 'failed'] as const;
export type ExportState = (typeof EXPORT_STATES)[number];
/** The download works this long after the export is built. */
export const EXPORT_TTL_HOURS = 24;
/** A person may ask for a new export this long after the last one. */
export const EXPORT_COOLDOWN_HOURS = 24;
/** Hard size limit of an export (bytes of JSON). */
export const EXPORT_MAX_BYTES = 2_000_000;
/** Rows of one kind (orders, tickets, ...) put into the export; the file says when it was cut. */
export const EXPORT_ROWS_PER_KIND = 500;
export const EXPORT_FORMAT_VERSION = 1;

export const ConsentViewDto = z.object({
  purpose: z.enum(PRIVACY_PURPOSES),
  /** null = never asked. */
  granted: z.boolean().nullable(),
  at: z.string().nullable(),
  noticeVersion: z.string().nullable(),
});
export type ConsentView = z.infer<typeof ConsentViewDto>;
export const ConsentListDto = z.object({ consents: z.array(ConsentViewDto) });

export const ExportStatusDto = z.object({
  id: z.uuid(),
  status: z.enum(EXPORT_STATES),
  requestedAt: z.string(),
  readyAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  bytes: z.number().int().nullable(),
});
export type ExportStatus = z.infer<typeof ExportStatusDto>;

export const PrivacyViewDto = z.object({
  consents: z.array(ConsentViewDto),
  /** The latest export request (any state), or null. */
  export: ExportStatusDto.nullable(),
  /** The customer can ask for a new export now (no active one, cooldown over). */
  canRequestExport: z.boolean(),
});
export type PrivacyView = z.infer<typeof PrivacyViewDto>;

export const ConsentChangeBodySchema = z.object({ granted: z.boolean() }).strict();
export const ConsentParamSchema = z.object({ purpose: z.enum(PRIVACY_PURPOSES) });
