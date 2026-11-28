/**
 * Community manager console DTOs (spec 23 § 3, § 13; SR-18, SR-38; plan task G2). Strict bodies (no mass assignment).
 * Staff views carry handles, names, codes and counts, never a phone number, an email or an exact location.
 */
import { z } from 'zod';
import { REPORT_REASONS, USTAAD_UNBAN_REASONS } from '../codes';
import { DM_READ_REASONS, ReportQueueItemDto } from './moderation';
import { OwnerLinkDto, VerificationQueueItemDto, VerificationViewDto } from './verification';

export { OwnerLinkDto, VerificationViewDto };

const version = z.number().int().min(1);
const note = z.string().trim().min(1).max(500);

/** What the caller may do in the console (the API still checks every call; the UI only hides). */
export const ConsoleCapsDto = z.object({
  read: z.boolean(),
  moderate: z.boolean(),
  verify: z.boolean(),
  takedown: z.boolean(),
  settings: z.boolean(),
  /** City codes the grant covers; null = every city. */
  cities: z.array(z.string()).nullable(),
});
export type ConsoleCaps = z.infer<typeof ConsoleCapsDto>;

/** Viewing reported or held media needs a reason (audited, `ustaad.media_view`). */
export const StaffMediaQueryDto = z.object({ reason: z.enum(DM_READ_REASONS) }).strict();
export const StaffMediaUrlDto = z.object({
  url: z.string(),
  expiresAt: z.string(),
  kind: z.string(),
  mime: z.string(),
});
export type StaffMediaUrl = z.infer<typeof StaffMediaUrlDto>;

export const MemberSearchQueryDto = z
  .object({
    /** A handle or its first letters (case does not matter). */
    q: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^@?[a-z0-9_]{2,24}$/),
  })
  .strict();

export const StaffMemberRowDto = z.object({
  memberId: z.string(),
  handle: z.string(),
  displayName: z.string(),
  level: z.string(),
  status: z.string(),
  verificationState: z.string(),
  restrictedMode: z.string(),
  cityCode: z.string().nullable(),
  activeStrikes: z.number().int(),
});
export type StaffMemberRow = z.infer<typeof StaffMemberRowDto>;

export const StaffMemberDetailDto = StaffMemberRowDto.extend({
  bannedUntil: z.string().nullable(),
  restrictedUntil: z.string().nullable(),
  joinedAt: z.string(),
  version: z.number().int(),
  openReports: z.number().int(),
  /** Four-eyes: lifting a long or permanent ban waits for a second staff member. */
  pendingUnban: z.object({ proposalId: z.string(), proposedByMe: z.boolean() }).nullable(),
  /** SIM-B11: a ban proposal waiting for a second staff member (null: none). */
  pendingBan: z.object({ proposedByMe: z.boolean() }).nullable(),
  strikes: z.array(z.object({ reasonCode: z.string(), status: z.string(), at: z.string() })),
  /** Moderation actions on the member or on anything they wrote, newest first (50). */
  history: z.array(
    z.object({
      action: z.string(),
      reasonCode: z.string(),
      days: z.number().int().nullable(),
      targetType: z.string(),
      reportCode: z.string().nullable(),
      at: z.string(),
    }),
  ),
});
export type StaffMemberDetail = z.infer<typeof StaffMemberDetailDto>;

export const SANCTION_ACTIONS = ['restrict', 'ban'] as const;
export const SanctionMemberDto = z
  .object({
    action: z.enum(SANCTION_ACTIONS),
    reasonCode: z.enum(REPORT_REASONS),
    /** Ban length in days; null or absent = permanent. Ignored for a restriction (`mod.restrict_days`). */
    days: z.number().int().min(1).max(36_500).nullable().optional(),
    note: note.optional(),
    version,
  })
  .strict();
export type SanctionMemberBody = z.infer<typeof SanctionMemberDto>;

export const UnbanMemberDto = z
  .object({ reasonCode: z.enum(USTAAD_UNBAN_REASONS), note: note.optional(), version })
  .strict()
  .refine((b) => b.reasonCode !== 'other' || b.note !== undefined, {
    message: 'A note is required for "other"',
    path: ['note'],
  });
export type UnbanMemberBody = z.infer<typeof UnbanMemberDto>;

export const LegalCasesDto = z.object({
  takedowns: z.array(
    z.object({
      code: z.string(),
      targetType: z.string(),
      source: z.string(),
      reasonCode: z.string(),
      clock: z.string(),
      status: z.string(),
      dueAt: z.string(),
      createdAt: z.string(),
      cityCode: z.string().nullable(),
      /** Takedown basis (court order, government intimation, NCII complaint, removal grievance). */
      basis: z.string().nullable(),
    }),
  ),
  holds: z.array(
    z.object({
      id: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      legalHold: z.string(),
      removedAt: z.string(),
      /** Files of the item: how many, and how many sit in the evidence vault. */
      files: z.number().int(),
      inVault: z.number().int(),
    }),
  ),
});
export type LegalCases = z.infer<typeof LegalCasesDto>;

export const OwnActionsQueryDto = z.object({ cursor: z.string().max(200).optional() }).strict();
export const OwnActionsDto = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      entity: z.string(),
      reason: z.string().nullable(),
      reportCode: z.string().nullable(),
      at: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type OwnActions = z.infer<typeof OwnActionsDto>;

/** Four-eyes: a second staff member confirms an unban proposal. */
export const ConfirmUnbanDto = z.object({ proposalId: z.uuid(), version }).strict();

// ── Response shapes the console reads (the browser checks every answer, hard rule 4) ──────────────────────────

export const ReportQueuePageDto = z.object({
  items: z.array(ReportQueueItemDto),
  nextCursor: z.string().nullable(),
});
export const ModerationResultDto = z.object({
  code: z.string(),
  status: z.string(),
  pendingBan: z.object({ proposalId: z.string() }).optional(),
});
export const ThreadReadDto = z.object({
  reportCode: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      sender: z.string(),
      body: z.string().nullable(),
      at: z.string(),
      reported: z.boolean(),
    }),
  ),
});
export const VerificationQueuePageDto = z.object({
  items: z.array(VerificationQueueItemDto),
  next: z.string().nullable(),
});
export const OwnerAttestationQueueDto = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      memberHandle: z.string(),
      memberName: z.string(),
      sinceYear: z.number().int().nullable(),
      linkIssuedAt: z.string().nullable(),
      expiresAt: z.string(),
    }),
  ),
});
export const ReservedNamesDto = z.object({
  names: z.array(
    z.object({ id: z.string(), name: z.string(), active: z.boolean(), version: z.number().int() }),
  ),
});
export const TakedownResultDto = ModerationResultDto.extend({ seconds: z.number().int() });
export const UnbanResultDto = z.object({
  memberId: z.string(),
  status: z.string(),
  pendingUnban: z.object({ proposalId: z.string() }).optional(),
});

export const StaffMemberSearchDto = z.object({ items: z.array(StaffMemberRowDto) });
