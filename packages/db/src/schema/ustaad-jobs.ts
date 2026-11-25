/**
 * Jobs (Naukri) and applications (spec 23 § 6.6, § 7.7; SR-36; migration `ustaad_local`). Workstream E owns the
 * repositories. Pay is mandatory and stated per month in integer paise; the "I hire only people aged 18 or older"
 * attestation is required on every job (locked); exactly one employer kind (workshop or trade account).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { JOB_ROLES, USTAAD_SEGMENT_CODES } from '@mechdost/shared/ustaad/codes';
import { USTAAD_APPLICATION_STATUSES, USTAAD_JOB_STATUSES } from '@mechdost/shared/state';
import { createdAt, id, paise, ts, updatedAt, version } from './_common';
import { tradeAccounts } from './business';
import { cities } from './geography';
import { workshops } from './services';
import { allOf, oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';
import { ustaadMembers } from './ustaad-members';

export const ustaadJobs = pgTable(
  'ustaad_jobs',
  {
    id: id(),
    code: text().notNull(),
    employerMemberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'restrict' }),
    workshopId: uuid().references(() => workshops.id, { onDelete: 'restrict' }),
    tradeAccountId: uuid().references(() => tradeAccounts.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    areaLabel: text().notNull(),
    areaLabelHi: text(),
    roleCode: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    payMinPaiseMonth: paise().notNull(),
    payMaxPaiseMonth: paise().notNull(),
    timing: text().notNull(),
    experienceMinYears: smallint().notNull().default(0),
    segmentCodes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    adultAttestedAt: ts().notNull(),
    status: text().notNull().default('draft'),
    heldReasonCode: text(),
    expiresAt: ts().notNull(),
    idemKey: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_jobs_code_uq').on(t.code),
    uniqueIndex('ustaad_jobs_idem_uq')
      .on(t.employerMemberId, t.idemKey)
      .where(sql`${t.idemKey} is not null`),
    index().on(t.cityId, t.status, t.createdAt.desc()),
    index().on(t.employerMemberId, t.createdAt),
    index().on(t.workshopId),
    index().on(t.tradeAccountId),
    index('ustaad_jobs_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} in ('open','paused')`),
    check('ustaad_jobs_code_format', sql`${t.code} ~ '^UJ-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$'`),
    check('ustaad_jobs_role_valid', oneOf(t.roleCode, JOB_ROLES)),
    check('ustaad_jobs_status_valid', oneOf(t.status, USTAAD_JOB_STATUSES)),
    check('ustaad_jobs_segments_valid', allOf(t.segmentCodes, USTAAD_SEGMENT_CODES)),
    check(
      'ustaad_jobs_pay',
      sql`${t.payMinPaiseMonth} > 0 and ${t.payMaxPaiseMonth} > 0 and ${t.payMinPaiseMonth} <= ${t.payMaxPaiseMonth}`,
    ),
    check('ustaad_jobs_one_employer', sql`num_nonnulls(${t.workshopId}, ${t.tradeAccountId}) = 1`),
    check('ustaad_jobs_experience', sql`${t.experienceMinYears} between 0 and 40`),
    check(
      'ustaad_jobs_len',
      sql`char_length(${t.title}) between 3 and 120 and char_length(${t.description}) between 10 and 2000 and char_length(${t.timing}) between 2 and 80`,
    ),
  ],
);

export const ustaadJobApplications = pgTable(
  'ustaad_job_applications',
  {
    id: id(),
    jobId: uuid()
      .notNull()
      .references(() => ustaadJobs.id, { onDelete: 'restrict' }),
    memberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'restrict' }),
    status: text().notNull().default('applied'),
    sharePhone: boolean().notNull().default(false),
    voiceIntroMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    closedReasonCode: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_job_applications_uq').on(t.jobId, t.memberId),
    index().on(t.memberId, t.createdAt),
    index().on(t.jobId, t.status),
    index().on(t.voiceIntroMediaId),
    check('ustaad_job_applications_status_valid', oneOf(t.status, USTAAD_APPLICATION_STATUSES)),
    check(
      'ustaad_job_applications_closed_reason',
      sql`${t.status} <> 'closed' or ${t.closedReasonCode} is not null`,
    ),
  ],
);
