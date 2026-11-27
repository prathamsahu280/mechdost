/**
 * Verification, vouch, attestation and onboarding DTOs (spec 23 § 8 "Verification", "Workshop", "Admin",
 * "Membership" onboarding; plan tasks B2, B4). Strict bodies (no mass assignment); never a phone number in a view
 * (SR-34). The certificate proof stays refused while `verify.certificate_enabled` is off (PENDING #28).
 */
import { z } from 'zod';
import {
  COACHMARK_TARGETS,
  USTAAD_ACCESS_MODES,
  USTAAD_LEVELS,
  USTAAD_VERIFY_METHODS,
  USTAAD_VERIFY_REJECT_REASONS,
  USTAAD_VOUCH_RELATIONS,
} from '../codes';
import {
  USTAAD_ATTESTATION_STATUSES,
  USTAAD_VERIFICATION_STATUSES,
  USTAAD_VOUCH_STATUSES,
} from '../../state/ustaad-verification';
import { MemberViewDto } from './members';

const REQUESTABLE = ['naya', 'pakka', 'bada', 'master'] as const;
const version = z.number().int().min(1);
const note = z.string().trim().max(500).nullable();

export const RequestVerificationDto = z
  .object({
    proofs: z.array(z.enum(USTAAD_VERIFY_METHODS)).min(1).max(2),
    requestedLevel: z.enum(REQUESTABLE).default('naya'),
  })
  .strict();
export type RequestVerification = z.infer<typeof RequestVerificationDto>;

export const VouchRequestDto = z
  .object({ voucherId: z.uuid(), relation: z.enum(USTAAD_VOUCH_RELATIONS) })
  .strict();
export const VersionDto = z.object({ expectedVersion: version }).strict();
export const VouchRevokeDto = z
  .object({ expectedVersion: version, reasonCode: z.enum(['mistake', 'no_longer_know', 'other']) })
  .strict();

export const AttestationRequestDto = z
  .object({ workshopId: z.uuid(), sinceYear: z.number().int().min(1950).max(2100).nullable() })
  .strict();
export const AttestationDecisionDto = z
  .object({ expectedVersion: version, decision: z.enum(['confirmed', 'declined']) })
  .strict();

// ── Garage owner not on MechDost (SR-6; one-time link issued by staff) ───────────────────────────────────────

/** Member: the owner's mobile (+91, 10 digits); stored encrypted, never shown back. */
export const OwnerAttestationRequestDto = z
  .object({
    ownerPhone: z.string().regex(/^\+91[6-9]\d{9}$/),
    sinceYear: z.number().int().min(1950).max(2100).nullable(),
  })
  .strict();
export const OwnerAttestationViewDto = z.object({
  id: z.uuid(),
  status: z.enum(USTAAD_ATTESTATION_STATUSES),
  sinceYear: z.number().int().nullable(),
  expiresAt: z.string(),
  version: z.number().int(),
});
/** Staff: the link (shown once) and the owner's number for the call (an audited read). */
export const OwnerLinkDto = z.object({ url: z.string(), expiresAt: z.string(), ownerPhone: z.string() });

/** Public attest page: the member's display name, area and claimed year only. */
export const AttestPageDto = z.object({
  memberName: z.string(),
  areaLabel: z.string(),
  areaLabelHi: z.string().nullable(),
  sinceYear: z.number().int().nullable(),
  expiresAt: z.string(),
});
export type AttestPage = z.infer<typeof AttestPageDto>;

/** Public attest submit: Turnstile always; a confirmation carries GSTIN/Udyam and the owner's position at the shop. */
export const AttestSubmitDto = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('declined'), turnstileToken: z.string().min(10).max(4096) }).strict(),
  z
    .object({
      decision: z.literal('confirmed'),
      turnstileToken: z.string().min(10).max(4096),
      businessId: z.string().trim().min(15).max(20),
      shop: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          accuracyM: z.number().int().min(0).max(5000),
        })
        .strict(),
    })
    .strict(),
]);
export type AttestSubmit = z.infer<typeof AttestSubmitDto>;

export const ApproveVerificationDto = z
  .object({ expectedVersion: version, grantedLevel: z.enum(REQUESTABLE) })
  .strict();
export const RejectVerificationDto = z
  .object({ expectedVersion: version, reasonCode: z.enum(USTAAD_VERIFY_REJECT_REASONS), note })
  .strict()
  .refine((b) => b.reasonCode !== 'other' || (b.note !== null && b.note.length >= 3), {
    message: 'A note is required for "other"',
    path: ['note'],
  });
export type RejectVerification = z.infer<typeof RejectVerificationDto>;

export const VerificationViewDto = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  requestedLevel: z.enum(REQUESTABLE),
  grantedLevel: z.enum(USTAAD_LEVELS).nullable(),
  status: z.enum(USTAAD_VERIFICATION_STATUSES),
  proofKinds: z.array(z.enum(USTAAD_VERIFY_METHODS)),
  reasonCode: z.enum(USTAAD_VERIFY_REJECT_REASONS).nullable(),
  /** Progress for `/partners/status` and Me › Get verified. */
  attestation: z.enum(USTAAD_ATTESTATION_STATUSES).nullable(),
  vouchesGiven: z.number().int(),
  vouchesNeeded: z.number().int(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  version: z.number().int(),
});
export type VerificationView = z.infer<typeof VerificationViewDto>;
/** `GET /ustaad/verification-status`. */
export const VerificationStatusDto = z.object({ verification: VerificationViewDto.nullable() });
/** `GET /ustaad/media/{id}/url` (A's route), as the browser reads it. */
export const SignedMediaUrlDto = z.object({ url: z.string(), expiresAt: z.string() });

/** Staff queue row: the member's public card facts only, phone never (SR-38 masks it everywhere). */
export const VerificationQueueItemDto = VerificationViewDto.extend({
  handle: z.string(),
  displayName: z.string(),
  level: z.enum(USTAAD_LEVELS),
  cityCode: z.string(),
  yearsClaimed: z.number().int(),
});
export type VerificationQueueItem = z.infer<typeof VerificationQueueItemDto>;

export const VouchViewDto = z.object({
  id: z.uuid(),
  voucherId: z.uuid(),
  voucheeId: z.uuid(),
  relation: z.enum(USTAAD_VOUCH_RELATIONS),
  status: z.enum(USTAAD_VOUCH_STATUSES),
  version: z.number().int(),
});
export type VouchView = z.infer<typeof VouchViewDto>;

export const AttestationViewDto = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  memberName: z.string(),
  memberHandle: z.string(),
  workshopId: z.uuid().nullable(),
  sinceYear: z.number().int().nullable(),
  status: z.enum(USTAAD_ATTESTATION_STATUSES),
  expiresAt: z.string(),
  version: z.number().int(),
});
export type AttestationView = z.infer<typeof AttestationViewDto>;

// ── Onboarding (flow 15) ──────────────────────────────────────────────────────────────────────────────────────

export const OnboardingEventDto = z.discriminatedUnion('event', [
  z.object({ event: z.literal('card'), card: z.number().int().min(1).max(12) }).strict(),
  z.object({ event: z.literal('skipped'), card: z.number().int().min(1).max(12) }).strict(),
  z.object({ event: z.literal('completed'), card: z.number().int().min(1).max(12) }).strict(),
  z.object({ event: z.literal('coachmark'), target: z.enum(COACHMARK_TARGETS) }).strict(),
]);
export type OnboardingEvent = z.infer<typeof OnboardingEventDto>;

export const OnboardingViewDto = z.object({
  lastCard: z.number().int().nullable(),
  completed: z.boolean(),
  skipped: z.boolean(),
  coachmarksSeen: z.array(z.enum(COACHMARK_TARGETS)),
});
export type OnboardingView = z.infer<typeof OnboardingViewDto>;

export const TutorialDto = z.object({
  cards: z.array(
    z.object({
      code: z.string(),
      position: z.number().int(),
      title: z.string(),
      body: z.string(),
      imageMediaId: z.uuid().nullable(),
      /** Recorded narration in the member's language; null → the browser's speechSynthesis reads `body`. */
      audioMediaId: z.uuid().nullable(),
    }),
  ),
  coachmarks: z.array(
    z.object({ target: z.enum(COACHMARK_TARGETS), text: z.string(), position: z.number().int() }),
  ),
});
export type Tutorial = z.infer<typeof TutorialDto>;

// ── My card and ladder (`GET /ustaad/me/card`) ─────────────────────────────────────────────────────────────────

export const MyCardDto = z.object({
  member: MemberViewDto,
  /** Plain follower count, rounded above 1,000 ("1.2k"). */
  followers: z.string(),
  /** Followers that count for levels (SR-9), shown next to the rule. */
  qualifiedFollowers: z.number().int(),
  izzat: z.number().int(),
  answers: z.number().int(),
  bestAnswers: z.number().int(),
  videos: z.number().int(),
  recommendations: z.number().int(),
  /**
   * "You helped N mechanics this week" (founder Q-UI-2, 2026-11-27): distinct other members whose questions I
   * answered (visible answers) in the last 7 days, rolling. A count only; no names.
   */
  helpedThisWeek: z.number().int().min(0),
  badges: z.array(
    z.object({ code: z.string(), name: z.string(), rule: z.string(), icon: z.string(), held: z.boolean() }),
  ),
  ladder: z.array(
    z.object({
      level: z.enum(['naya', 'pakka', 'bada', 'master']),
      name: z.string(),
      perk: z.string(),
      groups: z.array(
        z.object({
          minFollowers: z.number().int(),
          minBestAnswers: z.number().int(),
          minHelpfulPct: z.number().int(),
          minVerifiedYears: z.number().int(),
          minVideos: z.number().int(),
          minRecommendations: z.number().int(),
        }),
      ),
      staffReview: z.boolean(),
    }),
  ),
  current: z.enum(USTAAD_LEVELS),
});
export type MyCard = z.infer<typeof MyCardDto>;

/** `GET /admin/ustaad/verifications/open-count` (Partners › Applications notice, spec 23 § 4a): city scoped. */
export const VerificationOpenCountDto = z.object({
  open: z.number().int().min(0),
  access: z.enum(USTAAD_ACCESS_MODES),
});
export type VerificationOpenCount = z.infer<typeof VerificationOpenCountDto>;

/** Public attest submit answer. */
export const AttestOutcomeDto = z.object({ outcome: z.enum(['received', 'declined']) });
export type AttestOutcome = z.infer<typeof AttestOutcomeDto>;
