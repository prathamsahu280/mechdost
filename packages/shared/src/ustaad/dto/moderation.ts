/**
 * Reports and moderation DTOs (spec 23 § 8 "Reports" and "Admin", § 13; plan task F2). Strict bodies (no mass
 * assignment). Staff views carry names, handles, codes and text, never a phone number or an exact location (SR-38).
 */
import { z } from 'zod';
import { TICKET_CODE_RE } from '../../support-guest';
import { REPORT_REASONS, REPORT_TARGETS } from '../codes';

export const USTAAD_REPORT_CODE_RE = /^UR-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$/;
const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const note = z.string().trim().min(1).max(500);

/** A member's report (`POST /ustaad/reports`, 20 a day). Messages are reportable only by someone in the thread. */
export const CreateReportDto = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    reasonCode: z.enum(REPORT_REASONS),
    note: note.optional(),
  })
  .strict();
export type CreateReportBody = z.infer<typeof CreateReportDto>;

export const ReportCreatedDto = z.object({ code: z.string(), status: z.string() });

/** `held` (G2): open reports from the automatic first pass only (the console's Holds section). */
export const MODERATION_QUEUES = ['open', 'held', 'appealed', 'decided'] as const;
export const ModerationQueueQueryDto = z
  .object({
    queue: z.enum(MODERATION_QUEUES).default('open'),
    /** A city code (`RPR`); omitted = every city the grant covers. */
    city: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    cursor: z.string().max(200).optional(),
    /** G2 filters: one reason code, one surface (target type). */
    reason: z.enum(REPORT_REASONS).optional(),
    target: z.enum(REPORT_TARGETS).optional(),
  })
  .strict();
export type ModerationQueueQuery = z.infer<typeof ModerationQueueQueryDto>;

/** Report decisions a community manager takes on one report (`POST …/moderation/reports/{code}/act`). */
export const MODERATION_DECISIONS = ['keep', 'remove', 'warn', 'restrict', 'ban'] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

export const ModerationActDto = z
  .object({
    action: z.enum(MODERATION_DECISIONS),
    reasonCode,
    /** Ban length in days; null = permanent. Ignored for other actions. */
    days: z.number().int().min(1).max(36_500).nullable().optional(),
    note: note.optional(),
    version: z.number().int().min(1),
  })
  .strict();
export type ModerationActBody = z.infer<typeof ModerationActDto>;

/** The second staff member confirms a proposed ban (four-eyes). */
export const ConfirmBanDto = z.object({ proposalId: z.uuid(), version: z.number().int().min(1) }).strict();

/** The author's appeal arrives as a support ticket `REQ-…`; staff link it to the report. */
export const OpenAppealDto = z
  .object({ ticketCode: z.string().regex(TICKET_CODE_RE), version: z.number().int().min(1) })
  .strict();

/** `upheld` = the decision stands; `overturned` = the decision is reversed (content restored, strikes overturned). */
export const DecideAppealDto = z
  .object({
    outcome: z.enum(['upheld', 'overturned']),
    note: note.optional(),
    version: z.number().int().min(1),
  })
  .strict();

/** Staff intake: a legal order (3 h), an intimate-image complaint (2 h) or a grievance (36 h removal / 7 days). */
export const TAKEDOWN_BASES = [
  'court_order',
  'gov_intimation',
  'ncii_complaint',
  'grievance_removal',
] as const;
export const TakedownDto = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    basis: z.enum(TAKEDOWN_BASES),
    /** Order number, notice reference or ticket code: kept in the audit row, never shown to members. */
    reference: z.string().trim().min(3).max(120),
  })
  .strict();
export type TakedownBody = z.infer<typeof TakedownDto>;

/** Reading a reported thread needs a reason (audited, `ustaad.dm_read`). */
export const DM_READ_REASONS = ['report_review', 'legal_request', 'child_safety'] as const;
export const DmReadQueryDto = z.object({ reason: z.enum(DM_READ_REASONS) }).strict();

export const ReportQueueItemDto = z.object({
  code: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reasonCode: z.string(),
  source: z.string(),
  clock: z.string(),
  dueAt: z.string(),
  createdAt: z.string(),
  status: z.string(),
  overdue: z.boolean(),
  minor: z.boolean(),
  version: z.number().int(),
  cityCode: z.string().nullable(),
  /** G2 four-eyes in the UI: a ban waits for a second staff member; whether the caller proposed it or decided. */
  banWaiting: z.boolean(),
  proposedByMe: z.boolean(),
  decidedByMe: z.boolean(),
});
export type ReportQueueItem = z.infer<typeof ReportQueueItemDto>;

export const ReportDetailDto = ReportQueueItemDto.extend({
  note: z.string().nullable(),
  /** Text of the reported item (masked: no phone numbers); null for a message (read it through the DM route). */
  text: z.string().nullable(),
  contentStatus: z.string().nullable(),
  author: z
    .object({
      memberId: z.string(),
      handle: z.string(),
      displayName: z.string(),
      status: z.string(),
      restrictedMode: z.string(),
      activeStrikes: z.number().int(),
    })
    .nullable(),
  /** Moderator protection: media previews are blurred by default; ids only (signed through the staff path). */
  mediaIds: z.array(z.string()),
  pendingBan: z
    .object({ proposalId: z.string(), days: z.number().int().nullable(), proposedByMe: z.boolean() })
    .nullable(),
  actions: z.array(
    z.object({
      action: z.string(),
      reasonCode: z.string(),
      days: z.number().int().nullable(),
      at: z.string(),
    }),
  ),
});
export type ReportDetail = z.infer<typeof ReportDetailDto>;

// ── The member's own standing and appeal (QA 2026-11-27: SIM-P19, SIM-P24, SIM-P27) ──────────────────────────

export const STANDING_ACTIONS = ['remove', 'takedown', 'warn', 'restrict', 'ban'] as const;
export const APPEAL_STATES = ['can', 'pending', 'upheld', 'overturned'] as const;

/** `GET /ustaad/me/standing`: readable by banned and restricted members; never the reporter or a staff note. */
export const StandingDto = z.object({
  status: z.enum(['active', 'restricted', 'banned']),
  restrictedUntil: z.string().nullable(),
  bannedUntil: z.string().nullable(),
  restrictedMode: z.string(),
  items: z.array(
    z.object({
      reportCode: z.string(),
      action: z.enum(STANDING_ACTIONS),
      reasonCode: z.string(),
      days: z.number().int().nullable(),
      at: z.string(),
      endsAt: z.string().nullable(),
      appeal: z.enum(APPEAL_STATES),
    }),
  ),
});
export type StandingView = z.infer<typeof StandingDto>;

/** `POST /ustaad/me/appeals`: the member's own appeal (a support ticket of kind `ustaad_appeal`). */
export const FileAppealDto = z
  .object({
    reportCode: z.string().regex(USTAAD_REPORT_CODE_RE),
    note: z.string().trim().min(10).max(1000),
  })
  .strict();
export const AppealFiledDto = z.object({ ticketCode: z.string(), reportCode: z.string() });
