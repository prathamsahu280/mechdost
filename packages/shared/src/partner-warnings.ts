/**
 * Warnings staff give a partner (docs/specs/07, 08; design 2026-11-15). A warning is a record against a shop or
 * workshop: a reason code (hard rule 16) plus an optional note the partner reads. Append-only: staff can withdraw a
 * warning, never edit or delete it. The count in a rolling window only prompts staff to consider a pause — it
 * never pauses anything by itself. The web imports the code lists directly.
 */
import { z } from 'zod';

export const PARTNER_WARNING_REASONS = [
  'missed_offers',
  'gave_up_orders',
  'late_deliveries',
  'quality_complaints',
  'pricing_issue',
  'policy_violation',
  'other',
] as const;
export type PartnerWarningReason = (typeof PARTNER_WARNING_REASONS)[number];

export const WARNING_PARTNER_KINDS = ['shop', 'workshop'] as const;
export type WarningPartnerKind = (typeof WARNING_PARTNER_KINDS)[number];

/** Staff issue a warning: a code, and a note (5 to 300 characters) that is required for "other". */
export const IssueWarningSchema = z
  .object({
    reasonCode: z.enum(PARTNER_WARNING_REASONS),
    note: z.string().trim().min(5).max(300).nullable().optional(),
  })
  .strict()
  .refine((w) => w.reasonCode !== 'other' || Boolean(w.note), {
    message: 'Say what happened',
    path: ['note'],
  });

/** Staff withdraw a warning issued by mistake; the warning stays in the history, marked withdrawn. */
export const WithdrawWarningSchema = z.object({ note: z.string().trim().min(5).max(300) }).strict();

const WarningRow = z.object({
  id: z.uuid(),
  reasonCode: z.enum(PARTNER_WARNING_REASONS),
  note: z.string().nullable(),
  createdAt: z.string(),
  withdrawn: z.boolean(),
});

/** What the partner (and the admin page) sees: the warnings in the window and how many still count. */
export const PartnerWarningsView = z.object({
  windowDays: z.number().int(),
  counting: z.number().int(),
  warnings: z.array(WarningRow),
});
export type PartnerWarningsViewDto = z.infer<typeof PartnerWarningsView>;

/** The shop portal's answer: one view per shop in the caller's grants (no threshold, no pause prompt). */
export const ShopWarningsList = z.object({
  shops: z.array(PartnerWarningsView.extend({ shopId: z.uuid() })),
});

/** Admin: the same plus the pause prompt (staff-only; never shown to the partner). */
export const AdminPartnerWarnings = PartnerWarningsView.extend({
  threshold: z.number().int(),
  suggestPause: z.boolean(),
});
export type AdminPartnerWarningsDto = z.infer<typeof AdminPartnerWarnings>;

export const WarningIssued = z.object({ id: z.uuid(), warnings: AdminPartnerWarnings });
