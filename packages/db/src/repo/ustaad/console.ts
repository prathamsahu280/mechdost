/**
 * Community manager console reads (spec 23 § 3, § 13; SR-18, SR-38; plan task G2): the audited media view of a
 * reported or held item, members for staff (search by handle, status, strikes, sanctions history), takedowns and
 * legal holds, and the staff member's own audit trail. City scoped like the queue (a city-A grant gets 404 on city B);
 * no phone number, email or location in any view. Restrict, ban and unban live in `moderation.ts` (same decision
 * path as the queue).
 */
import { and, asc, count, desc, eq, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { UstaadReportTarget } from '@mechdost/shared/ustaad/codes';
import type {
  LegalCases,
  OwnActions,
  StaffMemberDetail,
  StaffMemberRow,
} from '@mechdost/shared/ustaad/dto/console';
import {
  auditLog,
  cities,
  ustaadMedia,
  ustaadMembers,
  ustaadModerationActions,
  ustaadRemovedArchive,
  ustaadReports,
  ustaadStrikes,
} from '../../schema';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import type { UstaadStaff } from './moderation';
import { loadUstaadTarget } from './targets';

const iso = (d: Date) => d.toISOString();

const reportInScope = (staff: UstaadStaff): SQL =>
  staff.scope.all
    ? sql`true`
    : staff.scope.cityIds.length === 0
      ? sql`false`
      : inArray(ustaadReports.cityId, staff.scope.cityIds);

const memberInScope = (staff: UstaadStaff): SQL =>
  staff.scope.all
    ? sql`true`
    : staff.scope.cityIds.length === 0
      ? sql`false`
      : inArray(ustaadMembers.cityId, staff.scope.cityIds);

/** Ids of everything a member wrote, as a SQL subquery (reports and actions about their content). */
const contentOf = (memberId: string) => sql`(
  select id from ustaad_posts where author_id = ${memberId}
  union all select id from ustaad_comments where author_id = ${memberId}
  union all select id from ustaad_questions where asker_id = ${memberId}
  union all select id from ustaad_answers where author_id = ${memberId}
  union all select id from ustaad_jobs where employer_member_id = ${memberId}
  union all select id from ustaad_messages where sender_id = ${memberId})`;

/** City codes of a scope for the console header (null = every city). */
export async function ustaadScopeCityCodes(
  tx: Tx,
  scope: { all: true } | { all: false; cityIds: string[] },
): Promise<string[] | null> {
  if (scope.all) return null;
  if (scope.cityIds.length === 0) return [];
  const rows = await tx
    .select({ code: cities.code })
    .from(cities)
    .where(inArray(cities.id, scope.cityIds))
    .orderBy(asc(cities.code));
  return rows.map((r) => r.code);
}

// ── Media (blurred by default in the console; every view audited)─────────────────────────────────────────────

export type StaffMediaReadReason = 'report_review' | 'legal_request' | 'child_safety';

/**
 * A file of a reported or held item for a community manager: only a file of that report's item (404 otherwise, and
 * for another city), never a message's file (DM content only through the audited thread read), never a file in
 * quarantine or the evidence vault, on legal hold or rejected (403 `USTAAD_MEDIA_RESTRICTED`; evidence reads are the
 * two-person ops step). Every call writes `audit_log` (`ustaad.media_view`, reason code) before a URL is signed.
 */
export async function staffUstaadMediaView(
  db: Tx,
  staff: UstaadStaff,
  input: { code: string; mediaId: string; reason: StaffMediaReadReason },
): Promise<{ id: string; bucket: string; objectKey: string; kind: string; mime: string }> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(ustaadReports)
      .where(and(eq(ustaadReports.code, input.code), reportInScope(staff)))
      .limit(1);
    if (!r) throw new NotFoundError('Not found');
    const target = await loadUstaadTarget(tx, r.targetType as UstaadReportTarget, r.targetId);
    if (!target || target.type === 'message' || !target.mediaIds.includes(input.mediaId))
      throw new NotFoundError('Not found');
    const [m] = await tx.select().from(ustaadMedia).where(eq(ustaadMedia.id, input.mediaId)).limit(1);
    if (!m) throw new NotFoundError('Not found');
    if (
      m.bucket === 'quarantine' ||
      m.bucket === 'evidence' ||
      m.legalHold !== null ||
      !['verified', 'removed_archived'].includes(m.status)
    )
      throw new ForbiddenError('This file is kept out of the console', 'USTAAD_MEDIA_RESTRICTED');
    await tx.insert(auditLog).values({
      actorUserId: staff.userId,
      actorRole: 'staff',
      action: 'ustaad.media_view',
      entity: 'ustaad_media',
      entityId: m.id,
      after: { report: r.code, kind: m.kind },
      reason: input.reason,
    });
    return { id: m.id, bucket: m.bucket, objectKey: m.objectKey, kind: m.kind, mime: m.declaredMime };
  });
}

// ── Members for staff ─────────────────────────────────────────────────────────────────────────────────────────

const activeStrikesOf = sql<number>`(select count(*)::int from ustaad_strikes st
  where st.member_id = ${ustaadMembers.id} and st.status = 'active')`;

const memberRowColumns = {
  memberId: ustaadMembers.id,
  handle: ustaadMembers.handle,
  displayName: ustaadMembers.displayName,
  level: ustaadMembers.level,
  status: ustaadMembers.status,
  verificationState: ustaadMembers.verificationState,
  restrictedMode: ustaadMembers.restrictedMode,
  cityCode: cities.code,
  activeStrikes: activeStrikesOf,
};

/** Members whose handle starts with `q` (case does not matter), in the caller's cities; 20 at most. */
export async function searchUstaadMembersForStaff(
  tx: Tx,
  staff: UstaadStaff,
  input: { q: string },
): Promise<{ items: StaffMemberRow[] }> {
  const q = input.q.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{2,24}$/.test(q))
    throw new ValidationError('Type at least two letters of a handle', 'VALIDATION');
  const pattern = `${q.replaceAll('_', '\\_')}%`;
  const rows = await tx
    .select(memberRowColumns)
    .from(ustaadMembers)
    .leftJoin(cities, eq(cities.id, ustaadMembers.cityId))
    .where(
      and(
        sql`${ustaadMembers.handle} like ${pattern}`,
        ne(ustaadMembers.status, 'left'),
        memberInScope(staff),
      ),
    )
    .orderBy(asc(ustaadMembers.handle))
    .limit(20);
  return {
    items: rows,
  };
}

/** One member for staff: status, sanctions, strikes and the moderation history (newest 50); 404 in another city. */
export async function ustaadMemberForStaff(
  tx: Tx,
  staff: UstaadStaff,
  memberId: string,
): Promise<StaffMemberDetail> {
  const [m] = await tx
    .select({
      ...memberRowColumns,
      bannedUntil: ustaadMembers.bannedUntil,
      restrictedUntil: ustaadMembers.restrictedUntil,
      joinedAt: ustaadMembers.joinedAt,
      version: ustaadMembers.version,
    })
    .from(ustaadMembers)
    .leftJoin(cities, eq(cities.id, ustaadMembers.cityId))
    .where(and(eq(ustaadMembers.id, memberId), ne(ustaadMembers.status, 'left'), memberInScope(staff)))
    .limit(1);
  if (!m) throw new NotFoundError('Member not found');
  const about = or(
    and(eq(ustaadModerationActions.targetType, 'member'), eq(ustaadModerationActions.targetId, memberId)),
    sql`${ustaadModerationActions.targetId} in ${contentOf(memberId)}`,
  );
  const history = await tx
    .select({ a: ustaadModerationActions, reportCode: ustaadReports.code })
    .from(ustaadModerationActions)
    .leftJoin(ustaadReports, eq(ustaadReports.id, ustaadModerationActions.reportId))
    .where(about)
    .orderBy(desc(ustaadModerationActions.createdAt))
    .limit(50);
  const strikes = await tx
    .select()
    .from(ustaadStrikes)
    .where(eq(ustaadStrikes.memberId, memberId))
    .orderBy(desc(ustaadStrikes.createdAt))
    .limit(50);
  const [open] = await tx
    .select({ n: count() })
    .from(ustaadReports)
    .where(
      and(
        inArray(ustaadReports.status, ['open', 'in_review']),
        or(
          and(eq(ustaadReports.targetType, 'member'), eq(ustaadReports.targetId, memberId)),
          sql`${ustaadReports.targetId} in ${contentOf(memberId)}`,
        ),
      ),
    );
  return {
    memberId: m.memberId,
    handle: m.handle,
    displayName: m.displayName,
    level: m.level,
    status: m.status,
    verificationState: m.verificationState,
    restrictedMode: m.restrictedMode,
    cityCode: m.cityCode,
    activeStrikes: m.activeStrikes,
    bannedUntil: m.bannedUntil ? iso(m.bannedUntil) : null,
    restrictedUntil: m.restrictedUntil ? iso(m.restrictedUntil) : null,
    joinedAt: iso(m.joinedAt),
    version: m.version,
    openReports: open?.n ?? 0,
    strikes: strikes.map((s) => ({ reasonCode: s.reasonCode, status: s.status, at: iso(s.createdAt) })),
    history: history.map(({ a, reportCode }) => ({
      action: a.action,
      reasonCode: a.reasonCode,
      days: a.days,
      targetType: a.targetType,
      reportCode,
      at: iso(a.createdAt),
    })),
  };
}

// ── Takedowns and legal holds ─────────────────────────────────────────────────────────────────────────────────

/**
 * Legal work for the console: takedowns and grievances (source `legal_order` / `grievance`, newest 100) with their
 * basis, and items on legal hold in the removed-content archive with how many of their files sit in the evidence
 * vault. City scoped through the report on the item.
 */
export async function listUstaadLegalCases(tx: Tx, staff: UstaadStaff): Promise<LegalCases> {
  const takedowns = await tx
    .select({ r: ustaadReports, cityCode: cities.code, basis: ustaadModerationActions.reasonCode })
    .from(ustaadReports)
    .leftJoin(cities, eq(cities.id, ustaadReports.cityId))
    .leftJoin(
      ustaadModerationActions,
      and(
        eq(ustaadModerationActions.reportId, ustaadReports.id),
        eq(ustaadModerationActions.action, 'takedown'),
      ),
    )
    .where(and(inArray(ustaadReports.source, ['legal_order', 'grievance']), reportInScope(staff)))
    .orderBy(desc(ustaadReports.createdAt))
    .limit(100);
  const scoped = staff.scope.all
    ? sql`true`
    : sql`exists (select 1 from ustaad_reports r2 where r2.target_type = ${ustaadRemovedArchive.targetType}
        and r2.target_id = ${ustaadRemovedArchive.targetId}
        and r2.city_id in (${
          staff.scope.cityIds.length
            ? sql.join(
                staff.scope.cityIds.map((c) => sql`${c}::uuid`),
                sql`, `,
              )
            : sql`null`
        }))`;
  const holds = await tx
    .select()
    .from(ustaadRemovedArchive)
    .where(and(sql`${ustaadRemovedArchive.legalHold} is not null`, scoped))
    .orderBy(desc(ustaadRemovedArchive.removedAt))
    .limit(100);
  const mediaIds = [
    ...new Set(
      holds.flatMap((h) => {
        const ids = (h.snapshot as { mediaIds?: unknown }).mediaIds;
        return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
      }),
    ),
  ];
  const buckets = mediaIds.length
    ? await tx
        .select({ id: ustaadMedia.id, bucket: ustaadMedia.bucket })
        .from(ustaadMedia)
        .where(inArray(ustaadMedia.id, mediaIds))
    : [];
  const bucketOf = new Map(buckets.map((b) => [b.id, b.bucket]));
  return {
    takedowns: takedowns.map(({ r, cityCode, basis }) => ({
      code: r.code,
      targetType: r.targetType,
      source: r.source,
      reasonCode: r.reasonCode,
      clock: r.clock,
      status: r.status,
      dueAt: iso(r.dueAt),
      createdAt: iso(r.createdAt),
      cityCode,
      basis,
    })),
    holds: holds.map((h) => {
      const raw = (h.snapshot as { mediaIds?: unknown }).mediaIds;
      const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
      return {
        id: h.id,
        targetType: h.targetType,
        targetId: h.targetId,
        legalHold: h.legalHold ?? '',
        removedAt: iso(h.removedAt),
        files: ids.length,
        inVault: ids.filter((id) => bucketOf.get(id) === 'evidence').length,
      };
    }),
  };
}

// ── The staff member's own audit trail ────────────────────────────────────────────────────────────────────────

/** The caller's own `ustaad.*` audit rows, newest first, 30 a page (keyset on the audit id). */
export async function listUstaadStaffOwnActions(
  tx: Tx,
  staffUserId: string,
  input: { cursor?: string | undefined },
): Promise<OwnActions> {
  let before: number | null = null;
  if (input.cursor) {
    if (!/^[0-9]{1,18}$/.test(input.cursor)) throw new ValidationError('Bad cursor', 'BAD_CURSOR');
    before = Number(input.cursor);
  }
  const rows = await tx
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorUserId, staffUserId),
        sql`${auditLog.action} like 'ustaad.%'`,
        before === null ? sql`true` : lt(auditLog.id, before),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(31);
  const page = rows.slice(0, 30);
  const last = page.at(-1);
  return {
    items: page.map((a) => {
      const report = (a.after as { report?: unknown } | null)?.report;
      return {
        id: String(a.id),
        action: a.action,
        entity: a.entity,
        reason: a.reason,
        reportCode: typeof report === 'string' ? report : null,
        at: iso(a.createdAt),
      };
    }),
    nextCursor: rows.length > 30 && last ? String(last.id) : null,
  };
}
