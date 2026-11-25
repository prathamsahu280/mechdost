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
    turnstileToken: z.string().min(10).max(4096),
    /** Which entry point the join came from (analytics only): `/ustaad/join` or `/partners/apply/mechanic`. */
    via: z.enum(['ustaad', 'partners_apply']).optional(),
  })
  .strict();
export type Join = z.infer<typeof JoinDto>;

/** `PATCH /ustaad/me`: profile fields only (workstream B adds the reserved-name check). */
export const PatchMeDto = z
  .object({
    displayName: name.optional(),
    displayNameHi: z.string().trim().min(2).max(80).nullable().optional(),
    garageName: z.string().trim().min(2).max(80).nullable().optional(),
    showGarage: z.boolean().optional(),
    areaLabel: label.optional(),
    yearsClaimed: z.number().int().min(0).max(60).optional(),
    workPlace: z.enum(USTAAD_WORK_PLACES).optional(),
    lang: z.enum(USTAAD_LANGS).optional(),
  })
  .strict();

export const ChoicesDto = z
  .object({
    dmMode: z.enum(USTAAD_DM_MODES).optional(),
    suggestMe: z.boolean().optional(),
    correctionMode: z.enum(USTAAD_CORRECTION_MODES).nullable().optional(),
    dataSaver: z.boolean().optional(),
  })
  .strict();

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

export const MeResponseDto = z.object({
  member: MemberViewDto.nullable(),
  staffPreview: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseDto>;
