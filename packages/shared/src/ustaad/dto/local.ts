/**
 * Local DTOs: garage pin, zones, jobs and applications (spec 23 § 8 "Location" and "Jobs", § 9.6; plan workstream E).
 * Strict bodies (no mass assignment). Distances leave the server only as band codes; zone counts only as bands; no
 * phone number anywhere (SR-34).
 */
import { z } from 'zod';
import { USTAAD_APPLICATION_STATUSES } from '../../state/ustaad-job';
import { JOB_ROLES, LOCATION_SOURCES, USTAAD_SEGMENT_CODES } from '../codes';

export const LocationDto = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100_000),
    source: z.enum(LOCATION_SOURCES),
    landmark: z.string().trim().min(2).max(120).nullable().default(null),
    mockSuspected: z.boolean().default(false),
    useForVerify: z.boolean(),
    countInZone: z.boolean(),
    shareExact: z.boolean(),
    exactAudience: z.enum(['connections', 'all_verified']).default('connections'),
    hidden: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    // A hand-placed pin needs a landmark (weak GPS path).
    if (v.source === 'manual' && !v.landmark)
      ctx.addIssue({ code: 'custom', path: ['landmark'], message: 'USTAAD_LANDMARK_REQUIRED' });
  });
export type LocationBody = z.infer<typeof LocationDto>;

export const MyLocationDto = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().int(),
  source: z.enum(LOCATION_SOURCES),
  landmark: z.string().nullable(),
  zoneCell: z.string(),
  useForVerify: z.boolean(),
  countInZone: z.boolean(),
  shareExact: z.boolean(),
  exactAudience: z.enum(['connections', 'all_verified']),
  hidden: z.boolean(),
  verified: z.boolean(),
  confirmedAt: z.string(),
  version: z.number().int(),
});

export const SignboardDto = z.object({ mediaId: z.uuid() }).strict();

const Banded = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('few') }),
  z.object({ kind: z.literal('band'), value: z.number().int() }),
  z.object({ kind: z.literal('exact'), value: z.number().int() }),
]);

export const ZonesQueryDto = z
  .object({
    city: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

export const ZoneDto = z.object({
  zoneCell: z.string(),
  center: z.object({ lat: z.number(), lng: z.number() }),
  total: Banded,
  segments: z.record(z.string(), Banded),
});

export const PostJobDto = z
  .object({
    employer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('workshop'), workshopId: z.uuid() }).strict(),
      z.object({ kind: z.literal('trade') }).strict(),
    ]),
    roleCode: z.enum(JOB_ROLES),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(2000),
    areaLabel: z.string().trim().min(2).max(80),
    areaLabelHi: z.string().trim().min(2).max(80).nullable().default(null),
    payMinPaiseMonth: z.number().int().positive().max(100_000_000),
    payMaxPaiseMonth: z.number().int().positive().max(100_000_000),
    timing: z.string().trim().min(2).max(80),
    experienceMinYears: z.number().int().min(0).max(40).default(0),
    segmentCodes: z.array(z.enum(USTAAD_SEGMENT_CODES)).max(8).default([]),
    /** "I hire only people aged 18 or older" (locked on; 422 USTAAD_ADULT_ATTESTATION when false). */
    adultAttested: z.boolean(),
    idemKey: z.string().min(8).max(64).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.payMinPaiseMonth > v.payMaxPaiseMonth)
      ctx.addIssue({ code: 'custom', path: ['payMaxPaiseMonth'], message: 'USTAAD_PAY_REQUIRED' });
  });
export type PostJobBody = z.infer<typeof PostJobDto>;

export const JobDto = z.object({
  code: z.string(),
  roleCode: z.enum(JOB_ROLES),
  title: z.string(),
  description: z.string(),
  areaLabel: z.string(),
  areaLabelHi: z.string().nullable(),
  cityCode: z.string(),
  payMinPaiseMonth: z.number().int(),
  payMaxPaiseMonth: z.number().int(),
  timing: z.string(),
  experienceMinYears: z.number().int(),
  segmentCodes: z.array(z.string()),
  status: z.string(),
  mine: z.boolean(),
  underReview: z.boolean(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const JobsQueryDto = z
  .object({
    role: z.enum(JOB_ROLES).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export const ApplyDto = z
  .object({ sharePhone: z.boolean().default(false), voiceIntroMediaId: z.uuid().nullable().default(null) })
  .strict();

/** `GET /ustaad/jobs/{code}/applications` (SIM-P18): the employer's applicants list, cursor-paged. */
export const ApplicantsQueryDto = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

/** One applicant as their would-be employer sees them: never a phone number, only the "share my number" flag. */
export const ApplicantDto = z.object({
  applicationId: z.string(),
  status: z.enum(USTAAD_APPLICATION_STATUSES),
  sharePhone: z.boolean(),
  voiceIntro: z.boolean(),
  appliedAt: z.string(),
  version: z.number().int(),
  member: z.object({
    id: z.string(),
    handle: z.string(),
    displayName: z.string(),
    displayNameHi: z.string().nullable(),
    level: z.string(),
    verified: z.boolean(),
  }),
});
export type ApplicantView = z.infer<typeof ApplicantDto>;
export const ApplicantsResponseDto = z.object({ items: z.array(ApplicantDto), next: z.string().nullable() });

export const JobCodeParam = z.object({ code: z.string().regex(/^UJ-[A-Z]{3}-\d{4}-[A-Z2-7]{6}$/) });
export const ApplicationParam = z.object({
  id: z.uuid(),
  action: z.enum(['seen', 'shortlist', 'reject', 'hire', 'withdraw']),
});
export const JobActionParam = z.object({
  code: z.string().regex(/^UJ-[A-Z]{3}-\d{4}-[A-Z2-7]{6}$/),
  action: z.enum(['pause', 'resume', 'close', 'fill']),
});
