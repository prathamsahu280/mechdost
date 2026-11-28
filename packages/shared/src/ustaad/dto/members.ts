/**
 * Membership DTOs (spec 23 § 8 "Membership"). Strict at the boundary (SR-5, no mass assignment): `official`, `level`,
 * `status`, phone numbers and anything else unknown are refused. No age field anywhere (ruling 2026-11-26).
 */
import { z } from 'zod';
import { PINCODE_RE } from '../../geo';
import {
  USTAAD_DM_MODES,
  USTAAD_LANGS,
  USTAAD_LEVELS,
  USTAAD_SPECIALITY_CODES,
  USTAAD_TRACKS,
  USTAAD_VERIFICATION_STATES,
  USTAAD_VERIFY_METHODS,
  USTAAD_WORK_PLACES,
  USTAAD_CORRECTION_MODES,
  USTAAD_MEMBER_STATUSES,
  USTAAD_RESTRICTED_MODES,
} from '../codes';

const name = z.string().trim().min(2).max(60);
const label = z.string().trim().min(2).max(80);

/** Step 5 consents: the profile consent is required (literal true); the three others start unticked. */
export const JoinConsentsDto = z
  .object({
    ustaad_profile: z.literal(true),
    ustaad_directory: z.boolean(),
    ustaad_training: z.boolean(),
    ustaad_offers: z.boolean(),
  })
  .strict();

export const JoinDto = z
  .object({
    track: z.enum(USTAAD_TRACKS),
    specialities: z.array(z.enum(USTAAD_SPECIALITY_CODES)).min(1).max(12),
    displayName: name,
    garageName: z.string().trim().min(2).max(80).nullable().optional(),
    showGarage: z.boolean(),
    pincode: z.string().regex(PINCODE_RE),
    areaLabel: label,
    yearsClaimed: z.number().int().min(0).max(60),
    workPlace: z.enum(USTAAD_WORK_PLACES),
    /** Empty = "Do it later" (verification_state `unverified`). `certificate` is refused while it is off. */
    verifyMethods: z.array(z.enum(USTAAD_VERIFY_METHODS)).max(2),
    consents: JoinConsentsDto,
    /** Old mechanic application code (§ 4a), pre-fills steps 3–4; workstream B maps it. */
    fromApplication: z
      .string()
      .regex(/^[A-Z0-9-]{6,40}$/)
      .optional(),
    // Optional on the wire: a missing token fails the check (400 TURNSTILE_FAILED) unless the temporary QA bypass
    // (decision 2026-11-27) recognises the signed-in account.
    turnstileToken: z.string().min(10).max(4096).optional(),
    /** Which entry point the join came from (analytics only): `/ustaad/join` or `/partners/apply/mechanic`. */
    via: z.enum(['ustaad', 'partners_apply']).optional(),
  })
  .strict();
export type Join = z.infer<typeof JoinDto>;

const expectedVersion = z.number().int().min(1);

/**
 * `PATCH /ustaad/me`: profile fields only, with the version last read (409 `STALE_MEMBER` otherwise). Names pass the
 * reserved/confusable check (SR-4) in the repository. A new `areaLabel` without `areaLabelHi` clears the old Hindi
 * label (it would describe the old area).
 */
export const PatchMeDto = z
  .object({
    expectedVersion,
    displayName: name.optional(),
    displayNameHi: z.string().trim().min(2).max(80).nullable().optional(),
    garageName: z.string().trim().min(2).max(80).nullable().optional(),
    showGarage: z.boolean().optional(),
    areaLabel: label.optional(),
    areaLabelHi: z.string().trim().min(2).max(80).nullable().optional(),
    yearsClaimed: z.number().int().min(0).max(60).optional(),
    workPlace: z.enum(USTAAD_WORK_PLACES).optional(),
    lang: z.enum(USTAAD_LANGS).optional(),
  })
  .strict();
export type PatchMe = z.infer<typeof PatchMeDto>;

/** `PUT /ustaad/me/specialities`: the full list (codes from the shared list; earned steps are kept). */
export const SpecialitiesDto = z
  .object({ codes: z.array(z.enum(USTAAD_SPECIALITY_CODES)).min(1).max(12) })
  .strict();
export type Specialities = z.infer<typeof SpecialitiesDto>;

/**
 * `PUT /ustaad/me/choices`: message mode, suggest-me, smart correction (only when `correction.member_can_change`),
 * data saver and the three optional join consents (one tap to withdraw). The required profile consent is withdrawn
 * only by leaving the network (`POST /ustaad/me/leave`).
 */
export const ChoicesDto = z
  .object({
    expectedVersion,
    dmMode: z.enum(USTAAD_DM_MODES).optional(),
    suggestMe: z.boolean().optional(),
    correctionMode: z.enum(USTAAD_CORRECTION_MODES).nullable().optional(),
    dataSaver: z.boolean().optional(),
    consents: z
      .object({
        ustaad_directory: z.boolean().optional(),
        ustaad_training: z.boolean().optional(),
        ustaad_offers: z.boolean().optional(),
        /** SIM-P10: store and play my voice notes (asked before the first recording). */
        ustaad_voice: z.boolean().optional(),
        /** G17: send my typed text, masked, to the smart-correction processor. */
        ustaad_correction: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Choices = z.infer<typeof ChoicesDto>;

export const ChoicesViewDto = z.object({
  dmMode: z.enum(USTAAD_DM_MODES),
  suggestMe: z.boolean(),
  correctionMode: z.enum(USTAAD_CORRECTION_MODES).nullable(),
  canChangeCorrection: z.boolean(),
  dataSaver: z.boolean(),
  consents: z.object({
    ustaad_profile: z.boolean(),
    ustaad_directory: z.boolean(),
    ustaad_training: z.boolean(),
    ustaad_offers: z.boolean(),
    ustaad_voice: z.boolean().default(false),
    ustaad_correction: z.boolean().default(false),
  }),
  version: z.number().int(),
});
export type ChoicesView = z.infer<typeof ChoicesViewDto>;

/**
 * What `GET /ustaad/me` returns: never a phone number (SR-34), never ids of other people. `staffPreview` is true when a
 * staff member without a membership looks at the network during the preview.
 */
export const MemberViewDto = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  displayNameHi: z.string().nullable(),
  track: z.enum(USTAAD_TRACKS),
  level: z.enum(USTAAD_LEVELS),
  status: z.enum(USTAAD_MEMBER_STATUSES),
  /** SIM-P23/P27: limited while staff check (no end date); the gate shows the one limited banner. */
  restrictedMode: z.enum(USTAAD_RESTRICTED_MODES).default('none'),
  verificationState: z.enum(USTAAD_VERIFICATION_STATES),
  cityCode: z.string(),
  areaLabel: z.string(),
  areaLabelHi: z.string().nullable(),
  workPlace: z.enum(USTAAD_WORK_PLACES),
  garageName: z.string().nullable(),
  showGarage: z.boolean(),
  yearsClaimed: z.number().int(),
  specialities: z.array(z.enum(USTAAD_SPECIALITY_CODES)),
  dmMode: z.enum(USTAAD_DM_MODES),
  suggestMe: z.boolean(),
  lang: z.enum(USTAAD_LANGS),
  official: z.boolean(),
  founding: z.boolean(),
  joinedAt: z.string(),
  version: z.number().int(),
});
export type MemberView = z.infer<typeof MemberViewDto>;

/** The one rule for who may answer: an Ustaad always; a Chhotu only while `ustaad.qa.apprentice_can_answer` is on. */
export function canAnswerQuestions(
  track: (typeof USTAAD_TRACKS)[number],
  apprenticeCanAnswer: boolean,
): boolean {
  return track === 'ustaad' || apprenticeCanAnswer;
}

export const MeResponseDto = z.object({
  member: MemberViewDto.nullable(),
  staffPreview: z.boolean(),
  /** SIM-P7: from the admin setting, so the Home "questions waiting" block follows it. Absent = unknown (shown). */
  canAnswer: z.boolean().optional(),
});
export type MeResponse = z.infer<typeof MeResponseDto>;
