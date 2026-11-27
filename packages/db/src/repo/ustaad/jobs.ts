/**
 * Jobs (Naukri) and applications (spec 23 § 4 flow 11, § 6.6, § 7.7; SR-2, SR-36; plan task E3). The only writer of
 * `ustaad_jobs` and `ustaad_job_applications`. Every move: `machine.assert` + conditional UPDATE on
 * (id, status, version) + `ustaad_events` row, in one transaction.
 *
 * - Posting needs a verified employer: a workshop grant on the named workshop, or a verified trade account
 *   (`USTAAD_EMPLOYER_REQUIRED`); the "I hire only people aged 18 or older" attestation (`USTAAD_ADULT_ATTESTATION`);
 *   a pay range. A fee phrase, UPI id or pay-app ask (or F's screen saying hold) keeps the job in `pending_review`
 *   for staff; the poster hears only "Our team will check it first".
 * - Restricted members and members whose perks are frozen (SR-2) can neither post nor apply.
 * - The phone number is never part of any view here (SR-34); `sharePhone` is a flag the employer UI reads.
 */
import { ustaadPublicCode } from '@mechdost/shared/ustaad/public-code';
import { and, desc, eq, inArray, isNotNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  ustaadApplicationMachine,
  ustaadJobMachine,
  type UstaadApplicationStatus,
  type UstaadJobStatus,
} from '@mechdost/shared/state';
import type { JOB_ROLES, UstaadSegmentCode } from '@mechdost/shared/ustaad/codes';
import { jobScamSignals, settingBool, settingInt } from '@mechdost/shared/ustaad/local';
import {
  cities,
  tradeAccounts,
  userRoles,
  ustaadJobApplications,
  ustaadJobs,
  ustaadMembers,
  ustaadWordLists,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { recordUstaadEvent } from './events';
import { ustaadBlockedEitherWay, ustaadMemberCard, ustaadNotBlockedSql } from './graph-common';
import { notifyUstaad } from './notify';
import { openUstaadAutoHoldReport, screenUstaadContent } from './moderation';
import { readUstaadSettingValues } from './settings';

type JobRole = (typeof JOB_ROLES)[number];
type JobRow = typeof ustaadJobs.$inferSelect;

export interface UstaadJobActor {
  memberId: string;
  userId: string;
}

export interface PostUstaadJobInput {
  /** Omitted: the server picks the member's employer account (SIM-P17). */
  employer?: { kind: 'workshop'; workshopId: string } | { kind: 'trade' } | undefined;
  roleCode: JobRole;
  title: string;
  description: string;
  areaLabel: string;
  areaLabelHi: string | null;
  payMinPaiseMonth: number;
  payMaxPaiseMonth: number;
  timing: string;
  experienceMinYears: number;
  segmentCodes: UstaadSegmentCode[];
  adultAttested: boolean;
  idemKey: string | null;
}

/** A job as members see it (no employer phone, no internal hold reason). */
export interface UstaadJobView {
  id: string;
  code: string;
  roleCode: JobRole;
  title: string;
  description: string;
  areaLabel: string;
  areaLabelHi: string | null;
  cityCode: string;
  payMinPaiseMonth: number;
  payMaxPaiseMonth: number;
  timing: string;
  experienceMinYears: number;
  segmentCodes: string[];
  status: string;
  /** True for the employer's own job (they see `pending_review` and applicants). */
  mine: boolean;
  /** Only for the poster: the job waits for staff. Never the reason. */
  underReview: boolean;
  expiresAt: string;
  createdAt: string;
}

const CODE_RETRIES = 3;
/** `UJ-{CITY}-{YYYY}-{6 base32}`: the shared Ustaad code helper (RFC 4648, matches `ustaad_jobs_code_format`). */
function jobCode(cityCode: string, at: Date): string {
  return ustaadPublicCode('UJ', cityCode, at);
}

async function memberGate(
  tx: Tx,
  memberId: string,
  now: Date,
): Promise<{ cityId: string; cityCode: string; workshopId: string | null }> {
  const [m] = await tx
    .select({
      cityId: ustaadMembers.cityId,
      workshopId: ustaadMembers.workshopId,
      cityCode: cities.code,
      restricted: ustaadMembers.restrictedMode,
      frozen: ustaadMembers.perksFrozenUntil,
      status: ustaadMembers.status,
    })
    .from(ustaadMembers)
    .innerJoin(cities, eq(cities.id, ustaadMembers.cityId))
    .where(eq(ustaadMembers.id, memberId))
    .limit(1);
  if (m?.status !== 'active') throw new NotFoundError();
  if (m.restricted !== 'none')
    throw new ForbiddenError('This is not available on your account right now', 'USTAAD_RESTRICTED');
  if (m.frozen && m.frozen > now)
    throw new ForbiddenError('Jobs are paused on your account for a short while', 'USTAAD_PERKS_FROZEN');
  return { cityId: m.cityId, cityCode: m.cityCode, workshopId: m.workshopId };
}

/**
 * Who this user may post jobs as (SIM-P17): every workshop they hold a grant on (the member's own linked workshop
 * first), then their verified trade account. One query each; the server decides from this list, never the client.
 */
export async function ustaadJobEmployerOptions(
  tx: Tx,
  userId: string,
  memberWorkshopId: string | null = null,
): Promise<({ kind: 'workshop'; workshopId: string } | { kind: 'trade'; tradeAccountId: string })[]> {
  const grants = await tx
    .selectDistinct({ workshopId: userRoles.workshopId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), isNotNull(userRoles.workshopId)));
  const workshops = grants
    .map((g) => g.workshopId)
    .filter((id): id is string => id !== null)
    .sort((x, y) => Number(y === memberWorkshopId) - Number(x === memberWorkshopId));
  const [t] = await tx
    .select({ id: tradeAccounts.id })
    .from(tradeAccounts)
    .where(and(eq(tradeAccounts.userId, userId), eq(tradeAccounts.status, 'verified')))
    .limit(1);
  return [
    ...workshops.map((workshopId) => ({ kind: 'workshop' as const, workshopId })),
    ...(t ? [{ kind: 'trade' as const, tradeAccountId: t.id }] : []),
  ];
}

/**
 * The employer behind a job. Named by the client: honoured only when it is one of the user's options. Not named (the
 * web form, SIM-P17): the first option — the member's own workshop, another workshop they hold a grant on, then the
 * verified trade account. No option: 403 `USTAAD_EMPLOYER_REQUIRED`.
 */
async function employerOf(
  tx: Tx,
  userId: string,
  employer: PostUstaadJobInput['employer'],
  memberWorkshopId: string | null = null,
): Promise<{ workshopId: string | null; tradeAccountId: string | null }> {
  const options = await ustaadJobEmployerOptions(tx, userId, memberWorkshopId);
  const pick = employer
    ? options.find((o) =>
        employer.kind === 'workshop'
          ? o.kind === 'workshop' && o.workshopId === employer.workshopId
          : o.kind === 'trade',
      )
    : options[0];
  if (pick?.kind === 'workshop') return { workshopId: pick.workshopId, tradeAccountId: null };
  if (pick?.kind === 'trade') return { workshopId: null, tradeAccountId: pick.tradeAccountId };
  throw new ForbiddenError(
    'Only a verified workshop or trade account can post a job',
    'USTAAD_EMPLOYER_REQUIRED',
  );
}

/** The job's employer still holds the workshop grant or a verified trade account (checked again on resume). */
async function employerStillValid(
  tx: Tx,
  userId: string,
  job: { workshopId: string | null; tradeAccountId: string | null },
): Promise<void> {
  await employerOf(
    tx,
    userId,
    job.workshopId ? { kind: 'workshop', workshopId: job.workshopId } : { kind: 'trade' },
  );
}

/** The `ustaad.jobs.enabled` kill switch: off → 404 for every job surface (withdraw excepted). */
export async function assertUstaadJobsEnabled(tx: Tx): Promise<void> {
  const s = await readUstaadSettingValues(tx, ['ustaad.jobs.enabled']);
  if (!settingBool(s['ustaad.jobs.enabled'], true)) throw new NotFoundError();
}

async function extraScamPhrases(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ phrase: ustaadWordLists.phrase })
    .from(ustaadWordLists)
    .where(and(eq(ustaadWordLists.list, 'scam_phrase'), eq(ustaadWordLists.active, true)));
  return rows.map((r) => r.phrase);
}

function viewOf(j: JobRow, cityCode: string, viewerMemberId: string): UstaadJobView {
  const mine = j.employerMemberId === viewerMemberId;
  return {
    id: j.id,
    code: j.code,
    roleCode: j.roleCode as JobRole,
    title: j.title,
    description: j.description,
    areaLabel: j.areaLabel,
    areaLabelHi: j.areaLabelHi,
    cityCode,
    payMinPaiseMonth: j.payMinPaiseMonth,
    payMaxPaiseMonth: j.payMaxPaiseMonth,
    timing: j.timing,
    experienceMinYears: j.experienceMinYears,
    segmentCodes: j.segmentCodes,
    status: j.status,
    mine,
    underReview: mine && j.status === 'pending_review',
    expiresAt: j.expiresAt.toISOString(),
    createdAt: j.createdAt.toISOString(),
  };
}

export async function postUstaadJob(
  db: Tx,
  actor: UstaadJobActor,
  input: PostUstaadJobInput,
  now = new Date(),
): Promise<UstaadJobView> {
  if (!input.adultAttested)
    throw new ValidationError('Confirm you hire only people aged 18 or older', 'USTAAD_ADULT_ATTESTATION');
  if (input.payMinPaiseMonth <= 0 || input.payMaxPaiseMonth < input.payMinPaiseMonth)
    throw new ValidationError('State the monthly pay range', 'USTAAD_PAY_REQUIRED');
  return db.transaction(async (tx) => {
    const s = await readUstaadSettingValues(tx, ['ustaad.jobs.enabled', 'ustaad.jobs.expiry_days']);
    if (!settingBool(s['ustaad.jobs.enabled'], true)) throw new NotFoundError();
    const place = await memberGate(tx, actor.memberId, now);
    if (input.idemKey) {
      const [dup] = await tx
        .select()
        .from(ustaadJobs)
        .where(and(eq(ustaadJobs.employerMemberId, actor.memberId), eq(ustaadJobs.idemKey, input.idemKey)))
        .limit(1);
      if (dup) return viewOf(dup, place.cityCode, actor.memberId);
    }
    const employer = await employerOf(tx, actor.userId, input.employer, place.workshopId);
    // Every member-visible free-text field goes through the filters (title, description, timing, area labels).
    const text = [input.title, input.description, input.timing, input.areaLabel, input.areaLabelHi ?? '']
      .filter(Boolean)
      .join('\n');
    const signals = jobScamSignals(text, await extraScamPhrases(tx));
    const screen = await screenUstaadContent(tx, {
      kind: 'job',
      text,
      mediaIds: [],
      authorId: actor.memberId,
    });
    if (screen === 'block') throw new ValidationError('This job cannot be posted', 'USTAAD_CONTENT_BLOCKED');
    const held = signals.length > 0 || screen === 'hold';
    ustaadJobMachine.assert('draft', 'pending_review', 'member');
    if (!held) ustaadJobMachine.assert('pending_review', 'open', 'system');
    const expiresAt = new Date(now.getTime() + settingInt(s['ustaad.jobs.expiry_days'], 30) * 86_400_000);

    for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
      const code = jobCode(place.cityCode, now);
      await tx.execute(sql`savepoint ustaad_job_create`);
      try {
        const [row] = await tx
          .insert(ustaadJobs)
          .values({
            code,
            employerMemberId: actor.memberId,
            workshopId: employer.workshopId,
            tradeAccountId: employer.tradeAccountId,
            cityId: place.cityId,
            areaLabel: input.areaLabel,
            areaLabelHi: input.areaLabelHi,
            roleCode: input.roleCode,
            title: input.title,
            description: input.description,
            payMinPaiseMonth: input.payMinPaiseMonth,
            payMaxPaiseMonth: input.payMaxPaiseMonth,
            timing: input.timing,
            experienceMinYears: input.experienceMinYears,
            segmentCodes: input.segmentCodes,
            adultAttestedAt: now,
            status: held ? 'pending_review' : 'open',
            heldReasonCode: held ? 'scam_phrase' : null,
            expiresAt,
            idemKey: input.idemKey,
          })
          .returning();
        await tx.execute(sql`release savepoint ustaad_job_create`);
        if (!row) throw new Error('job insert returned nothing');
        await recordUstaadEvent(
          tx,
          {
            entityType: 'job',
            entityId: row.id,
            kind: 'job_posted',
            fromStatus: 'draft',
            toStatus: row.status,
            reasonCode: held ? 'scam_phrase' : null,
            actorId: actor.userId,
            actorRole: 'member',
            cityId: place.cityId,
            props: { role: input.roleCode, signals },
          },
          {
            name: 'ustaad_job_posted',
            memberId: actor.memberId,
            userId: actor.userId,
            props: { jobCode: row.code, role: input.roleCode },
          },
        );
        // F2: a held job reaches the moderation queue with a clock (auto report, no reporter).
        if (held)
          await openUstaadAutoHoldReport(tx, {
            targetType: 'job',
            targetId: row.id,
            authorId: actor.memberId,
            kind: 'job',
          });
        return viewOf(row, place.cityCode, actor.memberId);
      } catch (err) {
        await tx.execute(sql`rollback to savepoint ustaad_job_create`);
        if (attempt === CODE_RETRIES - 1) throw err;
      }
    }
    throw new ConflictError('Please try again', 'CODE_COLLISION');
  });
}

/** Open jobs in the member's city, newest first, keyset cursor on (created_at, id). */
export async function listUstaadJobs(
  db: Tx,
  viewerMemberId: string,
  opts: { role?: JobRole; cursor?: { createdAt: Date; id: string } | null; limit?: number },
): Promise<{ items: UstaadJobView[]; next: { createdAt: string; id: string } | null }> {
  const [m] = await db
    .select({ cityId: ustaadMembers.cityId, cityCode: cities.code })
    .from(ustaadMembers)
    .innerJoin(cities, eq(cities.id, ustaadMembers.cityId))
    .where(eq(ustaadMembers.id, viewerMemberId))
    .limit(1);
  if (!m) throw new NotFoundError();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const c = opts.cursor;
  const rows = await db
    .select()
    .from(ustaadJobs)
    .where(
      and(
        eq(ustaadJobs.cityId, m.cityId),
        eq(ustaadJobs.status, 'open'),
        opts.role ? eq(ustaadJobs.roleCode, opts.role) : undefined,
        c
          ? or(
              lt(ustaadJobs.createdAt, c.createdAt),
              and(eq(ustaadJobs.createdAt, c.createdAt), lt(ustaadJobs.id, c.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ustaadJobs.createdAt), desc(ustaadJobs.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((j) => viewOf(j, m.cityCode, viewerMemberId)),
    next: rows.length > limit && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
  };
}

/**
 * One job by code. Others see only `open`/`paused`/`filled`/`closed`/`expired` jobs of their own city; held and
 * removed jobs are the employer's alone (404 for everyone else, no oracle).
 */
export async function getUstaadJob(db: Tx, viewerMemberId: string, code: string): Promise<UstaadJobView> {
  const [row] = await db
    .select({ job: ustaadJobs, cityCode: cities.code, viewerCity: ustaadMembers.cityId })
    .from(ustaadJobs)
    .innerJoin(cities, eq(cities.id, ustaadJobs.cityId))
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, viewerMemberId))
    .where(eq(ustaadJobs.code, code))
    .limit(1);
  if (!row) throw new NotFoundError();
  const mine = row.job.employerMemberId === viewerMemberId;
  if (
    !mine &&
    (row.job.status === 'pending_review' || row.job.status === 'removed' || row.job.status === 'draft')
  )
    throw new NotFoundError();
  if (!mine && row.job.cityId !== row.viewerCity) throw new NotFoundError();
  return viewOf(row.job, row.cityCode, viewerMemberId);
}

/** A job the member may see, by id (Saved, spec 23 § 5): the same rule as `getUstaadJob`; `NotFoundError` otherwise. */
export async function assertUstaadJobVisible(db: Tx, viewerMemberId: string, id: string): Promise<void> {
  const [row] = await db
    .select({ code: ustaadJobs.code })
    .from(ustaadJobs)
    .where(eq(ustaadJobs.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  await getUstaadJob(db, viewerMemberId, row.code);
}

export async function applyToUstaadJob(
  db: Tx,
  actor: UstaadJobActor,
  code: string,
  input: { sharePhone: boolean; voiceIntroMediaId: string | null },
  now = new Date(),
): Promise<{ applicationId: string; status: UstaadApplicationStatus }> {
  return db.transaction(async (tx) => {
    await assertUstaadJobsEnabled(tx);
    const place = await memberGate(tx, actor.memberId, now);
    const [job] = await tx.select().from(ustaadJobs).where(eq(ustaadJobs.code, code)).limit(1);
    if (job?.cityId !== place.cityId) throw new NotFoundError();
    if (job.employerMemberId === actor.memberId)
      throw new ValidationError('You cannot apply to your own job', 'USTAAD_OWN_JOB');
    // SR-35: blocked either way with the employer = the job does not exist for this member (and nobody is told).
    if (await ustaadBlockedEitherWay(tx, job.employerMemberId, actor.memberId)) throw new NotFoundError();
    if (job.status !== 'open') {
      if (job.status === 'pending_review' || job.status === 'removed' || job.status === 'draft')
        throw new NotFoundError();
      throw new ConflictError('This job is not taking applications', 'USTAAD_JOB_CLOSED');
    }
    if (input.voiceIntroMediaId) {
      const [ok] = rowsOf<{ ok: number }>(
        await tx.execute(sql`select 1 as ok from ustaad_media where id = ${input.voiceIntroMediaId}::uuid
        and owner_member_id = ${actor.memberId}::uuid and kind = 'audio' and status = 'verified'`),
      );
      if (!ok) throw new NotFoundError();
    }
    const inserted = await tx
      .insert(ustaadJobApplications)
      .values({
        jobId: job.id,
        memberId: actor.memberId,
        sharePhone: input.sharePhone,
        voiceIntroMediaId: input.voiceIntroMediaId,
      })
      .onConflictDoNothing()
      .returning({ id: ustaadJobApplications.id, status: ustaadJobApplications.status });
    const row = inserted[0];
    if (!row) {
      // Idempotent: a repeat tap returns the existing application.
      const [existing] = await tx
        .select({ id: ustaadJobApplications.id, status: ustaadJobApplications.status })
        .from(ustaadJobApplications)
        .where(
          and(eq(ustaadJobApplications.jobId, job.id), eq(ustaadJobApplications.memberId, actor.memberId)),
        )
        .limit(1);
      if (!existing) throw new NotFoundError();
      return { applicationId: existing.id, status: existing.status as UstaadApplicationStatus };
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'application',
        entityId: row.id,
        kind: 'application_created',
        toStatus: 'applied',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: job.cityId,
        props: { job_id: job.id, share_phone: input.sharePhone, voice: input.voiceIntroMediaId !== null },
      },
      {
        name: 'ustaad_job_applied',
        memberId: actor.memberId,
        userId: actor.userId,
        props: { jobCode: job.code, applicationId: row.id },
      },
    );
    // The employer hears about each new application once (SIM-P18; spec 23 § 12): keyed on the application, so a
    // second applicant rings again and a repeat tap (the branch above) does not.
    const [employer] = await tx
      .select({ userId: ustaadMembers.userId })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, job.employerMemberId))
      .limit(1);
    if (employer)
      await notifyUstaad(tx, 'ustaad.job_application', {
        userId: employer.userId,
        entityId: row.id,
        version: 1,
        params: { jobCode: job.code },
      });
    return { applicationId: row.id, status: 'applied' };
  });
}

/** One applicant as the employer sees them: name, level and the verified tick; never a phone number (SR-34). */
export interface UstaadApplicantView {
  applicationId: string;
  status: UstaadApplicationStatus;
  /** The applicant ticked "share my number"; the number itself is never in a response. */
  sharePhone: boolean;
  voiceIntro: boolean;
  appliedAt: string;
  version: number;
  member: {
    id: string;
    handle: string;
    displayName: string;
    displayNameHi: string | null;
    level: string;
    verified: boolean;
  };
}

/** Jobs only their employer may see as such; their applicants list answers 404 like an unknown code. */
const HIDDEN_JOB_STATUSES = new Set(['draft', 'pending_review', 'removed']);

/**
 * The applicants of one job, for its employer only (SIM-P18): anyone else, and an unknown code, get the same 404.
 * Newest first, keyset cursor on (created_at, id); the filter uses the (job_id, status) index.
 */
export async function listUstaadJobApplicants(
  db: Tx,
  actor: UstaadJobActor,
  code: string,
  opts: { cursor?: { createdAt: string; id: string } | null; limit?: number },
  now = new Date(),
): Promise<{ items: UstaadApplicantView[]; next: { createdAt: string; id: string } | null }> {
  // Same gate as the employer's moves (restricted, frozen, banned or left employers are refused).
  await memberGate(db, actor.memberId, now);
  const [job] = await db
    .select({ id: ustaadJobs.id, employer: ustaadJobs.employerMemberId, status: ustaadJobs.status })
    .from(ustaadJobs)
    .where(eq(ustaadJobs.code, code))
    .limit(1);
  if (job?.employer !== actor.memberId || HIDDEN_JOB_STATUSES.has(job.status)) throw new NotFoundError();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const c = opts.cursor;
  // The cursor carries milliseconds (ISO); order and compare on the same precision so no row is skipped.
  const at = sql`date_trunc('milliseconds', ${ustaadJobApplications.createdAt})`;
  const rows = await db
    .select({ app: ustaadJobApplications, m: ustaadMembers })
    .from(ustaadJobApplications)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadJobApplications.memberId))
    .where(
      and(
        eq(ustaadJobApplications.jobId, job.id),
        // Withdrawn applications are the applicant's to take back: the employer no longer sees them. Banned or
        // departed members and anyone blocked either way with the employer are left out (SR-35).
        ne(ustaadJobApplications.status, 'withdrawn'),
        notInArray(ustaadMembers.status, ['banned', 'left']),
        ustaadNotBlockedSql(actor.memberId, sql`${ustaadJobApplications.memberId}`),
        c
          ? sql`(${at}, ${ustaadJobApplications.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(at), desc(ustaadJobApplications.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const card = ustaadMemberCard(r.m);
      return {
        applicationId: r.app.id,
        status: r.app.status as UstaadApplicationStatus,
        sharePhone: r.app.sharePhone,
        voiceIntro: r.app.voiceIntroMediaId !== null,
        appliedAt: r.app.createdAt.toISOString(),
        version: r.app.version,
        member: {
          id: card.id,
          handle: card.handle,
          displayName: card.displayName,
          displayNameHi: card.displayNameHi,
          level: card.level,
          // The trust signal every other screen shows (pre-verified levels never carry the tick).
          verified: card.verified,
        },
      };
    }),
    next:
      rows.length > limit && last ? { createdAt: last.app.createdAt.toISOString(), id: last.app.id } : null,
  };
}

type EmployerMove = 'seen' | 'shortlisted' | 'rejected' | 'hired';

/**
 * Move an application. The employer of that job moves it to seen / shortlisted / rejected / hired; the applicant
 * withdraws. Anyone else gets 404 (actor-scoped). Conditional UPDATE on (id, status, version).
 */
export async function moveUstaadApplication(
  db: Tx,
  actor: UstaadJobActor,
  applicationId: string,
  to: EmployerMove | 'withdrawn',
  now = new Date(),
): Promise<{ status: UstaadApplicationStatus }> {
  return db.transaction(async (tx) => {
    // Withdrawing stays possible for everyone; every employer move needs jobs on and an unrestricted employer.
    if (to !== 'withdrawn') {
      await assertUstaadJobsEnabled(tx);
      await memberGate(tx, actor.memberId, now);
    }
    const [row] = await tx
      .select({
        app: ustaadJobApplications,
        employer: ustaadJobs.employerMemberId,
        cityId: ustaadJobs.cityId,
      })
      .from(ustaadJobApplications)
      .innerJoin(ustaadJobs, eq(ustaadJobs.id, ustaadJobApplications.jobId))
      .where(eq(ustaadJobApplications.id, applicationId))
      .limit(1);
    if (!row) throw new NotFoundError();
    const allowed =
      to === 'withdrawn' ? row.app.memberId === actor.memberId : row.employer === actor.memberId;
    if (!allowed) throw new NotFoundError();
    const from = row.app.status as UstaadApplicationStatus;
    if (from === to) return { status: from };
    if (!ustaadApplicationMachine.can(from, to))
      throw new ConflictError('This application cannot move that way', 'INVALID_TRANSITION');
    ustaadApplicationMachine.assert(from, to, 'member');
    const done = await tx
      .update(ustaadJobApplications)
      .set({ status: to, version: sql`${ustaadJobApplications.version} + 1` })
      .where(
        and(
          eq(ustaadJobApplications.id, applicationId),
          eq(ustaadJobApplications.status, from),
          eq(ustaadJobApplications.version, row.app.version),
        ),
      )
      .returning({ id: ustaadJobApplications.id });
    if (done.length === 0) throw new ConflictError('Changed meanwhile, please refresh', 'STALE');
    await recordUstaadEvent(
      tx,
      {
        entityType: 'application',
        entityId: applicationId,
        kind: 'application_moved',
        fromStatus: from,
        toStatus: to,
        actorId: actor.userId,
        actorRole: 'member',
        cityId: row.cityId,
      },
      {
        name: 'ustaad_application_moved',
        memberId: actor.memberId,
        userId: actor.userId,
        props: { applicationId, to },
      },
    );
    return { status: to };
  });
}

/**
 * Employer moves a job (pause / resume / close / fill). A job leaving `open`/`paused` for good closes its live
 * applications with reason `job_closed` in the same transaction.
 */
export async function moveUstaadJob(
  db: Tx,
  actor: UstaadJobActor,
  code: string,
  to: 'paused' | 'open' | 'closed' | 'filled',
  now = new Date(),
): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    // Closing or filling stays possible (it only takes the job down); opening needs jobs on, an unrestricted
    // employer and a still-valid employer account.
    if (to === 'open' || to === 'paused') {
      await assertUstaadJobsEnabled(tx);
      await memberGate(tx, actor.memberId, now);
    }
    const [job] = await tx.select().from(ustaadJobs).where(eq(ustaadJobs.code, code)).limit(1);
    if (job?.employerMemberId !== actor.memberId) throw new NotFoundError();
    const from = job.status as UstaadJobStatus;
    if (!ustaadJobMachine.can(from, to))
      throw new ConflictError('This job cannot move that way', 'INVALID_TRANSITION');
    if (to === 'open') await employerStillValid(tx, actor.userId, job);
    ustaadJobMachine.assert(from, to, 'member');
    const done = await tx
      .update(ustaadJobs)
      .set({ status: to, version: sql`${ustaadJobs.version} + 1` })
      .where(and(eq(ustaadJobs.id, job.id), eq(ustaadJobs.status, from), eq(ustaadJobs.version, job.version)))
      .returning({ id: ustaadJobs.id });
    if (done.length === 0) throw new ConflictError('Changed meanwhile, please refresh', 'STALE');
    await recordUstaadEvent(tx, {
      entityType: 'job',
      entityId: job.id,
      kind: 'job_moved',
      fromStatus: from,
      toStatus: to,
      actorId: actor.userId,
      actorRole: 'member',
      cityId: job.cityId,
    });
    if (to === 'closed' || to === 'filled') await closeApplicationsOf(tx, job.id, job.cityId);
    return { status: to };
  });
}

async function closeApplicationsOf(tx: Tx, jobId: string, cityId: string): Promise<void> {
  const live = ['applied', 'seen', 'shortlisted'] as const;
  const closed = await tx
    .update(ustaadJobApplications)
    .set({
      status: 'closed',
      closedReasonCode: 'job_closed',
      version: sql`${ustaadJobApplications.version} + 1`,
    })
    .where(and(eq(ustaadJobApplications.jobId, jobId), inArray(ustaadJobApplications.status, [...live])))
    .returning({ id: ustaadJobApplications.id });
  for (const a of closed)
    await recordUstaadEvent(tx, {
      entityType: 'application',
      entityId: a.id,
      kind: 'application_moved',
      toStatus: 'closed',
      reasonCode: 'job_closed',
      actorId: null,
      actorRole: 'system',
      cityId,
    });
}

/** Worker `ustaad_jobs_expire`: open/paused jobs past `expires_at` → expired; their applications close. */
export async function expireUstaadJobs(db: Tx, now = new Date(), batch = 100): Promise<number> {
  const due = await db
    .select({
      id: ustaadJobs.id,
      status: ustaadJobs.status,
      version: ustaadJobs.version,
      cityId: ustaadJobs.cityId,
    })
    .from(ustaadJobs)
    .where(and(inArray(ustaadJobs.status, ['open', 'paused']), lt(ustaadJobs.expiresAt, now)))
    .limit(batch);
  let n = 0;
  for (const j of due) {
    await db.transaction(async (tx) => {
      const done = await tx
        .update(ustaadJobs)
        .set({ status: 'expired', version: sql`${ustaadJobs.version} + 1` })
        .where(
          and(eq(ustaadJobs.id, j.id), eq(ustaadJobs.status, j.status), eq(ustaadJobs.version, j.version)),
        )
        .returning({ id: ustaadJobs.id });
      if (done.length === 0) return;
      n += 1;
      await recordUstaadEvent(tx, {
        entityType: 'job',
        entityId: j.id,
        kind: 'job_moved',
        fromStatus: j.status,
        toStatus: 'expired',
        actorId: null,
        actorRole: 'system',
        cityId: j.cityId,
      });
      await closeApplicationsOf(tx, j.id, j.cityId);
    });
  }
  return n;
}
