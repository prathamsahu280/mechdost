/**
 * Moderation (spec 23 § 3, § 7.6, § 13; SR-18, SR-36, SR-38, SR-39; plan task F2). The automatic first pass on new
 * content, the community-manager decisions, four-eyes bans, appeals, the legal takedown fast path, audited DM reads,
 * the classifier's evidence vault, and the clock / sanction / reminder jobs.
 *
 * Rules every staff path follows:
 *  - city scope (a grant for city A gets 404 on city B's reports), no phone numbers in any view (masked text);
 *  - a staff member never moderates their own content (403 `SELF_MODERATION`);
 *  - a ban of `mod.four_eyes_from_ban_days` or more (or permanent) is proposed by one staff member and confirmed by
 *    another (403 `FOUR_EYES`); an appeal is decided by someone other than the original decider;
 *  - every decision: conditional UPDATE of the report on (id, status, version) + append-only moderation action +
 *    `ustaad_events` + `audit_log`, one transaction;
 *  - removal archives the item (180 days) and moves its media to `removed_archived` at once, so new signed URLs are
 *    refused immediately; the API then moves the objects out of the live bucket (`MediaRelocation`).
 *
 * Appeal outcome names (spec 23 § 7.6, ruled 2026-11-26 F2): `upheld` = the decision stands; `overturned` = it is
 * reversed (content restored, strikes overturned, sanctions lifted).
 */
import { and, asc, count, desc, eq, gt, inArray, isNotNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { ustaadMediaMachine, ustaadReportMachine, type UstaadReportStatus } from '@mechdost/shared/state';
import type {
  MODERATION_ACTIONS,
  UstaadMediaBucket,
  UstaadReportClock,
  UstaadReportTarget,
} from '@mechdost/shared/ustaad/codes';
import type {
  ModerationActBody,
  ModerationQueueQuery,
  ReportDetail,
  ReportQueueItem,
  TakedownBody,
} from '@mechdost/shared/ustaad/dto/moderation';
import {
  autoReportReason,
  autoReportSource,
  banNeedsFourEyes,
  clockFor,
  maskContactsInText,
  screenDecision,
  screenTextSignals,
  type ScreenKind,
  type ScreenOutcome,
  type ScreenVerdict,
} from '@mechdost/shared/ustaad/moderation';
import {
  auditLog,
  cities,
  supportTickets,
  ustaadEvents,
  ustaadMedia,
  ustaadMediaVariants,
  ustaadMembers,
  ustaadMessages,
  ustaadModerationActions,
  ustaadPostMedia,
  ustaadPosts,
  ustaadRemovedArchive,
  ustaadReports,
  ustaadStrikes,
  ustaadWordLists,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { resolveNotices, staffRecipients } from '../notices';
import type { Tx } from '../orders';
import type { CityScope } from '../routing';
import { recordUstaadEvent, type UstaadEventInput } from './events';
import { notifyUstaad } from './notify';
import { archiveUstaadContent } from './removed-archive';
import { insertUstaadReport, notifyUstaadModerators } from './reports';
import { readUstaadSettingValues } from './settings';
import {
  activeUstaadStrikes,
  addUstaadStrike,
  maybeFalseReportStrike,
  overturnUstaadStrikes,
} from './strikes';
import { keptStatusOf, loadUstaadTarget, moveUstaadTarget, type UstaadTarget } from './targets';

export type { ScreenKind, ScreenOutcome } from '@mechdost/shared/ustaad/moderation';

// ── Automatic first pass ──────────────────────────────────────────────────────────────────────────────────────

export interface ScreenInput {
  kind: ScreenKind;
  text: string | null;
  mediaIds: readonly string[];
  authorId: string;
}

async function activeWords(tx: Tx, list: 'banned' | 'scam_phrase' | 'link_domain'): Promise<string[]> {
  const rows = await tx
    .select({ phrase: ustaadWordLists.phrase })
    .from(ustaadWordLists)
    .where(and(eq(ustaadWordLists.list, list), eq(ustaadWordLists.active, true)));
  return rows.map((r) => r.phrase);
}

/**
 * The verdict with its signals (for the auto report and the staff queue). Banned words, scam phrases, UPI ids, pay-app
 * and OTP asks, phone numbers, plates, links (new accounts, denied domains), illegal-modification phrases, media
 * flagged by the image-safety classifier, and pre-moderation of new accounts' media posts (spec 23 § 10 step 4).
 */
export async function explainUstaadScreen(
  tx: Tx,
  input: ScreenInput,
  now = new Date(),
): Promise<ScreenVerdict> {
  const [banned, scamPhrases, linkDomains] = await Promise.all([
    activeWords(tx, 'banned'),
    activeWords(tx, 'scam_phrase'),
    activeWords(tx, 'link_domain'),
  ]);
  const signals = input.text ? screenTextSignals(input.text, { banned, scamPhrases, linkDomains }) : [];
  const [me] = await tx
    .select({ joinedAt: ustaadMembers.joinedAt })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, input.authorId))
    .limit(1);
  const s = await readUstaadSettingValues(tx, [
    'ustaad.mod.premod_first_posts',
    'ustaad.mod.premod_account_days',
    'ustaad.mod.links_min_account_days',
  ]);
  const hasMedia = input.mediaIds.length > 0;
  let priorMediaPosts = Number.MAX_SAFE_INTEGER;
  if (hasMedia && ['post', 'story', 'comment'].includes(input.kind)) {
    const [row] = await tx
      .select({ n: sql<number>`count(distinct ${ustaadPostMedia.postId})::int` })
      .from(ustaadPostMedia)
      .innerJoin(ustaadPosts, eq(ustaadPosts.id, ustaadPostMedia.postId))
      .where(and(eq(ustaadPosts.authorId, input.authorId), eq(ustaadPosts.status, 'visible')));
    priorMediaPosts = row?.n ?? 0;
  }
  const verdict = screenDecision(input.kind, signals, {
    accountAgeDays: me ? (now.getTime() - me.joinedAt.getTime()) / 86_400_000 : 0,
    priorMediaPosts,
    hasMedia,
    premodFirstPosts: Number(s['ustaad.mod.premod_first_posts']),
    premodAccountDays: Number(s['ustaad.mod.premod_account_days']),
    linksMinAccountDays: Number(s['ustaad.mod.links_min_account_days']),
  });
  if (verdict.outcome === 'ok' && hasMedia) {
    // A file the classifier scored above `mod.nsfw_hold_score_pct` holds the item (event `safety_flagged`).
    const [flag] = await tx
      .select({ id: ustaadEvents.id })
      .from(ustaadEvents)
      .where(
        and(
          eq(ustaadEvents.entityType, 'media'),
          inArray(ustaadEvents.entityId, [...input.mediaIds]),
          eq(ustaadEvents.kind, 'safety_flagged'),
        ),
      )
      .limit(1);
    if (flag) return { outcome: 'hold', signals: [...verdict.signals, 'new_account_media'] };
  }
  return verdict;
}

/**
 * Automatic first pass on new content (final signature from workstream A). Callers store `held` on `hold` and
 * refuse on `block`, then call `openUstaadAutoHoldReport` with the new row's id so the hold reaches the queue.
 */
export async function screenUstaadContent(tx: Tx, input: ScreenInput): Promise<ScreenOutcome> {
  return (await explainUstaadScreen(tx, input)).outcome;
}

/**
 * Puts a held item in the moderation queue with a clock (source `auto_scam` / `auto_word`, no reporter). Recomputes
 * the signals from the stored text, so callers pass only the target. Idempotent per target (an open auto report is
 * reused).
 */
export async function openUstaadAutoHoldReport(
  tx: Tx,
  input: { targetType: UstaadReportTarget; targetId: string; authorId: string; kind: ScreenKind },
): Promise<string | null> {
  const target = await loadUstaadTarget(tx, input.targetType, input.targetId);
  if (!target) return null;
  const [open] = await tx
    .select({ code: ustaadReports.code })
    .from(ustaadReports)
    .where(
      and(
        eq(ustaadReports.targetType, target.type),
        eq(ustaadReports.targetId, target.id),
        sql`${ustaadReports.reporterId} is null`,
        inArray(ustaadReports.status, ['open', 'in_review']),
      ),
    )
    .limit(1);
  if (open) return open.code;
  const verdict = await explainUstaadScreen(tx, {
    kind: input.kind,
    text: target.text,
    mediaIds: target.mediaIds,
    authorId: input.authorId,
  });
  const source = autoReportSource(verdict.signals);
  const reason = autoReportReason(verdict.signals);
  const row = await insertUstaadReport(tx, {
    target,
    reporterId: null,
    source,
    reasonCode: reason,
    clock: 'standard_24h',
    note: verdict.signals.join(','),
  });
  if (!row) return null;
  await recordUstaadEvent(tx, {
    entityType: 'report',
    entityId: row.id,
    kind: 'auto_held',
    toStatus: 'open',
    reasonCode: reason,
    actorId: null,
    actorRole: 'system',
    cityId: row.cityId,
    props: { target: target.type, signals: verdict.signals },
  });
  await notifyUstaadModerators(tx, 'staff.ustaad_report', row, 'new');
  return row.code;
}

// ── Staff context and views ───────────────────────────────────────────────────────────────────────────────────

export interface UstaadStaff {
  userId: string;
  /** City scope of the caller's `ustaad:moderate` (or `ustaad:read` for reads) grants. */
  scope: CityScope;
  /** Holds `ustaad:takedown` (may reverse a legal removal that is not on legal hold). */
  canTakedown?: boolean;
}

export interface MediaRelocation {
  mediaId: string;
  ownerMemberId: string;
  bucket: UstaadMediaBucket;
  objectKey: string;
  mime: string;
}

export interface ModerationResult {
  code: string;
  status: string;
  /** Media the API must move out of (removal) or back into (restore) the live bucket. */
  media: MediaRelocation[];
  /** Four-eyes: the ban is proposed and waits for a second staff member. */
  pendingBan?: { proposalId: string };
}

const inScope = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : inArray(ustaadReports.cityId, scope.cityIds);

type ReportRow = typeof ustaadReports.$inferSelect;

async function scopedReport(tx: Tx, staff: UstaadStaff, code: string): Promise<ReportRow> {
  const [row] = await tx
    .select()
    .from(ustaadReports)
    .where(and(eq(ustaadReports.code, code), inScope(staff.scope)))
    .limit(1);
  if (!row) throw new NotFoundError('Report not found');
  return row;
}

const isoOf = (d: Date) => d.toISOString();
const MINOR_FIRST = sql<number>`case when ${ustaadReports.reasonCode} = 'minor' or ${ustaadReports.source} = 'auto_safety' then 0 else 1 end`;

function encodeCursor(p: { rank: number; due: Date; id: string }): string {
  return Buffer.from(`${String(p.rank)}|${p.due.toISOString()}|${p.id}`).toString('base64url');
}
function decodeCursor(c: string | undefined): { rank: number; due: Date; id: string } | null {
  if (!c) return null;
  const [rank, due, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const d = new Date(due ?? '');
  if ((rank !== '0' && rank !== '1') || Number.isNaN(d.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id))
    throw new ValidationError('Bad cursor', 'BAD_CURSOR');
  return { rank: Number(rank), due: d, id };
}

const QUEUE_STATUSES: Record<ModerationQueueQuery['queue'], UstaadReportStatus[]> = {
  open: ['open', 'in_review'],
  appealed: ['appealed'],
  decided: ['actioned', 'dismissed', 'upheld', 'overturned'],
};

/**
 * The queue sorted by clock: child-safety items first (a minor report or a classifier hit), then the earliest due
 * time. 20 a page, keyset cursor. `cityId` narrows to one city (the API resolves it within the caller's scope).
 */
export async function listUstaadModerationQueue(
  tx: Tx,
  staff: UstaadStaff,
  query: { queue: ModerationQueueQuery['queue']; cityId: string | null; cursor?: string | undefined },
  now = new Date(),
): Promise<{ items: ReportQueueItem[]; nextCursor: string | null }> {
  const after = decodeCursor(query.cursor);
  const rank = MINOR_FIRST;
  const rows = await tx
    .select({ r: ustaadReports, rank, cityCode: cities.code })
    .from(ustaadReports)
    .leftJoin(cities, eq(cities.id, ustaadReports.cityId))
    .where(
      and(
        inArray(ustaadReports.status, QUEUE_STATUSES[query.queue]),
        inScope(staff.scope),
        query.cityId ? eq(ustaadReports.cityId, query.cityId) : sql`true`,
        after
          ? sql`(${rank}, ${ustaadReports.dueAt}, ${ustaadReports.id}) > (${after.rank}, ${after.due}, ${after.id}::uuid)`
          : sql`true`,
      ),
    )
    .orderBy(asc(rank), asc(ustaadReports.dueAt), asc(ustaadReports.id))
    .limit(21);
  const page = rows.slice(0, 20);
  const last = page.at(-1);
  return {
    items: page.map(({ r, cityCode }) => ({
      code: r.code,
      targetType: r.targetType,
      targetId: r.targetId,
      reasonCode: r.reasonCode,
      source: r.source,
      clock: r.clock,
      dueAt: isoOf(r.dueAt),
      createdAt: isoOf(r.createdAt),
      status: r.status,
      overdue: r.dueAt.getTime() <= now.getTime(),
      minor: r.reasonCode === 'minor' || r.source === 'auto_safety',
      version: r.version,
      cityCode,
    })),
    nextCursor:
      rows.length > 20 && last ? encodeCursor({ rank: last.rank, due: last.r.dueAt, id: last.r.id }) : null,
  };
}

async function pendingBanOf(tx: Tx, report: ReportRow) {
  const [p] = await tx
    .select()
    .from(ustaadEvents)
    .where(
      and(
        eq(ustaadEvents.entityType, 'report'),
        eq(ustaadEvents.entityId, report.id),
        inArray(ustaadEvents.kind, ['ban_proposed', 'ban_confirmed', 'ban_withdrawn']),
      ),
    )
    .orderBy(desc(ustaadEvents.occurredAt), desc(ustaadEvents.id))
    .limit(1);
  return p?.kind === 'ban_proposed' ? p : null;
}

/** One report for the console: masked text (no phone numbers), the author without contact details, history. */
export async function ustaadReportDetail(
  tx: Tx,
  staff: UstaadStaff,
  code: string,
  now = new Date(),
): Promise<ReportDetail> {
  const r = await scopedReport(tx, staff, code);
  const target = await loadUstaadTarget(tx, r.targetType as UstaadReportTarget, r.targetId);
  const [author] = target
    ? await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, target.authorMemberId)).limit(1)
    : [];
  const [city] = r.cityId
    ? await tx.select({ code: cities.code }).from(cities).where(eq(cities.id, r.cityId)).limit(1)
    : [];
  const actions = await tx
    .select()
    .from(ustaadModerationActions)
    .where(eq(ustaadModerationActions.reportId, r.id))
    .orderBy(asc(ustaadModerationActions.createdAt));
  const pending = await pendingBanOf(tx, r);
  const pendingDays = (pending?.props as { days?: number | null } | undefined)?.days;
  return {
    code: r.code,
    targetType: r.targetType,
    targetId: r.targetId,
    reasonCode: r.reasonCode,
    source: r.source,
    clock: r.clock,
    dueAt: isoOf(r.dueAt),
    createdAt: isoOf(r.createdAt),
    status: r.status,
    overdue: r.dueAt.getTime() <= now.getTime(),
    minor: r.reasonCode === 'minor' || r.source === 'auto_safety',
    version: r.version,
    cityCode: city?.code ?? null,
    note: r.note,
    // DM content only through the audited thread route (SR-38); everything else masked (no phone numbers).
    text: target && target.type !== 'message' && target.text ? maskContactsInText(target.text) : null,
    contentStatus: target?.status ?? null,
    author: author
      ? {
          memberId: author.id,
          handle: author.handle,
          displayName: author.displayName,
          status: author.status,
          restrictedMode: author.restrictedMode,
          activeStrikes: await activeUstaadStrikes(tx, author.id),
        }
      : null,
    mediaIds: target && target.type !== 'message' ? target.mediaIds : [],
    pendingBan: pending ? { proposalId: pending.id, days: pendingDays ?? null } : null,
    actions: actions.map((a) => ({
      action: a.action,
      reasonCode: a.reasonCode,
      days: a.days,
      at: isoOf(a.createdAt),
    })),
  };
}

// ── Decisions ─────────────────────────────────────────────────────────────────────────────────────────────────

async function targetOrGone(tx: Tx, r: ReportRow): Promise<UstaadTarget> {
  const t = await loadUstaadTarget(tx, r.targetType as UstaadReportTarget, r.targetId);
  if (!t) throw new NotFoundError('The reported item no longer exists');
  return t;
}

/** 403 `SELF_MODERATION` when the staff member is the author (or the reported member). */
async function assertNotSelf(tx: Tx, staff: UstaadStaff, t: UstaadTarget): Promise<void> {
  const [m] = await tx
    .select({ userId: ustaadMembers.userId })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, t.authorMemberId))
    .limit(1);
  if (m?.userId === staff.userId)
    throw new ForbiddenError('Another staff member must decide on your own content', 'SELF_MODERATION');
}

async function moveReport(
  tx: Tx,
  r: ReportRow,
  to: UstaadReportStatus,
  expectedVersion: number,
  set: Partial<typeof ustaadReports.$inferInsert> = {},
  actor: 'admin' | 'member' = 'admin',
): Promise<ReportRow> {
  ustaadReportMachine.assert(r.status as UstaadReportStatus, to, actor);
  const [next] = await tx
    .update(ustaadReports)
    .set({ ...set, status: to })
    .where(
      and(
        eq(ustaadReports.id, r.id),
        eq(ustaadReports.status, r.status),
        eq(ustaadReports.version, expectedVersion),
      ),
    )
    .returning();
  if (!next) throw new ConflictError('This report changed meanwhile', 'STALE_REPORT');
  return next;
}

async function writeAction(
  tx: Tx,
  input: {
    report: ReportRow | null;
    target: UstaadTarget;
    action: (typeof MODERATION_ACTIONS)[number];
    reasonCode: string;
    days?: number | null;
    actorId: string;
    secondActorId?: string | null;
    note?: string | null;
    now: Date;
  },
): Promise<string> {
  const [a] = await tx
    .insert(ustaadModerationActions)
    .values({
      reportId: input.report?.id ?? null,
      targetType: input.target.type,
      targetId: input.target.id,
      action: input.action,
      reasonCode: input.reasonCode,
      days: input.days ?? null,
      actorId: input.actorId,
      secondActorId: input.secondActorId ?? null,
      note: input.note ?? null,
    })
    .returning({ id: ustaadModerationActions.id });
  if (!a) throw new Error('action insert returned nothing');
  await tx.insert(auditLog).values({
    actorUserId: input.actorId,
    actorRole: 'staff',
    action: `ustaad.${input.action}`,
    entity: `ustaad_${input.target.type}`,
    entityId: input.target.id,
    before: { status: input.target.status },
    after: {
      report: input.report?.code ?? null,
      days: input.days ?? null,
      second: input.secondActorId ?? null,
    },
    reason: input.reasonCode,
  });
  const onTime = input.report ? input.now.getTime() <= input.report.dueAt.getTime() : null;
  await recordServerEventFor(tx, input, onTime);
  return a.id;
}

async function recordServerEventFor(
  tx: Tx,
  input: {
    report: ReportRow | null;
    target: UstaadTarget;
    action: (typeof MODERATION_ACTIONS)[number];
    reasonCode: string;
    actorId: string;
  },
  onTime: boolean | null,
): Promise<void> {
  await recordUstaadEvent(
    tx,
    {
      entityType: 'report',
      entityId: input.report?.id ?? input.target.id,
      kind: `action_${input.action}`,
      reasonCode: input.reasonCode,
      actorId: input.actorId,
      actorRole: 'staff',
      cityId: input.report?.cityId ?? input.target.cityId,
      props: { target: input.target.type },
    },
    {
      name: 'ustaad_moderation_action',
      memberId: null,
      userId: input.actorId,
      props: {
        action: input.action,
        reason: input.reasonCode,
        clock: (input.report?.clock as UstaadReportClock | undefined) ?? null,
        onTime,
      },
    },
  );
}

/**
 * Removes the item: status → removed, archive snapshot (retention days, optional legal hold), media → removed_archived
 * (new signed URLs refused at once). Returns the media to move out of the live bucket.
 */
async function removeTarget(
  tx: Tx,
  t: UstaadTarget,
  reasonCode: string,
  now: Date,
  legalHold: string | null = null,
): Promise<MediaRelocation[]> {
  if (t.status !== 'removed') await moveUstaadTarget(tx, t, 'removed');
  const s = await readUstaadSettingValues(tx, ['ustaad.mod.retention_days']);
  const retention = Number(s['ustaad.mod.retention_days']);
  await archiveUstaadContent(tx, {
    targetType: t.type,
    targetId: t.id,
    snapshot: {
      text: t.text,
      mediaIds: t.mediaIds,
      authorMemberId: t.authorMemberId,
      status: t.status,
      reasonCode,
    },
    retentionDays: retention,
    legalHold,
    now,
  });
  const entity = eventEntityOf(t);
  if (entity)
    await recordUstaadEvent(tx, {
      entityType: entity,
      entityId: t.id,
      kind: 'removed',
      fromStatus: t.status,
      toStatus: 'removed',
      reasonCode,
      actorId: null,
      actorRole: 'staff',
      cityId: t.cityId,
    });
  return archiveMedia(tx, t.mediaIds, new Date(now.getTime() + retention * 86_400_000), legalHold);
}

function eventEntityOf(t: UstaadTarget): UstaadEventInput['entityType'] | null {
  switch (t.type) {
    case 'post':
    case 'story':
      return 'post';
    case 'comment':
    case 'question':
    case 'answer':
    case 'job':
    case 'member':
      return t.type;
    case 'message':
      return 'message_thread';
  }
}

async function archiveMedia(
  tx: Tx,
  mediaIds: readonly string[],
  retainUntil: Date,
  legalHold: string | null,
): Promise<MediaRelocation[]> {
  if (mediaIds.length === 0) return [];
  // Security review fix 4: a legal hold also covers files an earlier removal already archived (no purge date).
  if (legalHold)
    await tx
      .update(ustaadMedia)
      .set({ legalHold, purgeAfter: null })
      .where(and(inArray(ustaadMedia.id, [...mediaIds]), eq(ustaadMedia.status, 'removed_archived')));
  const rows = await tx
    .select()
    .from(ustaadMedia)
    .where(and(inArray(ustaadMedia.id, [...mediaIds]), eq(ustaadMedia.status, 'verified')));
  const out: MediaRelocation[] = [];
  for (const m of rows) {
    ustaadMediaMachine.assert('verified', 'removed_archived', 'admin');
    const [moved] = await tx
      .update(ustaadMedia)
      .set({ status: 'removed_archived', removedRetainUntil: retainUntil, legalHold })
      .where(
        and(eq(ustaadMedia.id, m.id), eq(ustaadMedia.status, 'verified'), eq(ustaadMedia.version, m.version)),
      )
      .returning();
    if (moved)
      out.push({
        mediaId: moved.id,
        ownerMemberId: moved.ownerMemberId,
        bucket: moved.bucket as UstaadMediaBucket,
        objectKey: moved.objectKey,
        mime: moved.declaredMime,
      });
  }
  return out;
}

/** After the API moved an object to another bucket: record its new place (archive or back to live). */
export async function relocateUstaadMedia(
  db: Tx,
  input: {
    mediaId: string;
    bucket: MediaRelocation['bucket'];
    /** Every object of the file (the main key and its image variants), old key → new key. */
    moves: readonly { from: string; to: string }[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(ustaadMedia).where(eq(ustaadMedia.id, input.mediaId)).limit(1);
    if (!m) return;
    const main = input.moves.find((x) => x.from === m.objectKey);
    await tx
      .update(ustaadMedia)
      .set({ bucket: input.bucket, ...(main ? { objectKey: main.to } : {}) })
      .where(eq(ustaadMedia.id, m.id));
    for (const mv of input.moves)
      await tx
        .update(ustaadMediaVariants)
        .set({ objectKey: mv.to })
        .where(and(eq(ustaadMediaVariants.mediaId, m.id), eq(ustaadMediaVariants.objectKey, mv.from)));
  });
}

/** The objects of one file: its main key and its image variants (distinct). */
export async function ustaadMediaObjectKeys(tx: Tx, mediaId: string): Promise<string[]> {
  const [m] = await tx
    .select({ key: ustaadMedia.objectKey })
    .from(ustaadMedia)
    .where(eq(ustaadMedia.id, mediaId))
    .limit(1);
  const variants = await tx
    .select({ key: ustaadMediaVariants.objectKey })
    .from(ustaadMediaVariants)
    .where(eq(ustaadMediaVariants.mediaId, mediaId));
  return [...new Set([...(m ? [m.key] : []), ...variants.map((v) => v.key)])];
}

async function notifyAuthor(
  tx: Tx,
  t: UstaadTarget,
  kind: 'ustaad.content_removed' | 'ustaad.strike' | 'ustaad.report_outcome',
  entityId: string,
  params: Record<string, string> = {},
): Promise<void> {
  const [m] = await tx
    .select({ userId: ustaadMembers.userId })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, t.authorMemberId))
    .limit(1);
  if (m) await notifyUstaad(tx, kind, { userId: m.userId, entityId, version: kind, params });
}

/** Lifts the minor-report restricted mode once a community manager has decided (§ 13 "until review"). */
async function liftMinorRestriction(tx: Tx, memberId: string, cityId: string | null): Promise<void> {
  const [stillOpen] = await tx
    .select({ n: count() })
    .from(ustaadReports)
    .where(
      and(
        eq(ustaadReports.reasonCode, 'minor'),
        inArray(ustaadReports.status, ['open', 'in_review']),
        or(
          and(eq(ustaadReports.targetType, 'member'), eq(ustaadReports.targetId, memberId)),
          sql`${ustaadReports.targetId} in (select id from ustaad_posts where author_id = ${memberId})`,
        ),
      ),
    );
  if ((stillOpen?.n ?? 0) > 0) return;
  const rows = await tx
    .update(ustaadMembers)
    .set({ restrictedMode: 'none' })
    .where(and(eq(ustaadMembers.id, memberId), eq(ustaadMembers.restrictedMode, 'minor_report')))
    .returning({ id: ustaadMembers.id });
  if (rows.length > 0)
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: memberId,
        kind: 'restricted_mode',
        fromStatus: 'minor_report',
        toStatus: 'none',
        actorId: null,
        actorRole: 'staff',
        cityId,
      },
      {
        name: 'ustaad_restricted_mode',
        memberId: null,
        userId: null,
        props: { memberId, reason: 'cleared' },
      },
    );
}

async function applySanction(
  tx: Tx,
  t: UstaadTarget,
  kind: 'restrict' | 'ban',
  days: number | null,
  now: Date,
): Promise<void> {
  const until = days === null ? null : new Date(now.getTime() + days * 86_400_000);
  const [m] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, t.authorMemberId)).limit(1);
  if (!m || m.status === 'left') throw new NotFoundError('Member not found');
  const set =
    kind === 'ban'
      ? { status: 'banned', bannedUntil: until, restrictedUntil: null }
      : { status: 'restricted', restrictedUntil: until, bannedUntil: null };
  // Security review 2026-11-26 fix 1: a sanction never shortens or dates a stronger one.
  //  - a ban never replaces a permanent ban or one that ends later (changing a permanent ban is a new four-eyes ban);
  //  - a restriction never replaces a ban, never puts an end date on a frozen (`review`, POCSO) or minor-report
  //    account, and never shortens an open-ended or longer restriction.
  const outlasts = (current: Date | null) =>
    current === null || (until !== null && current.getTime() >= until.getTime());
  if (kind === 'ban' && m.status === 'banned' && outlasts(m.bannedUntil)) return;
  if (kind === 'restrict') {
    if (m.status === 'banned' || m.restrictedMode !== 'none') return;
    if (m.status === 'restricted' && outlasts(m.restrictedUntil)) return;
  }
  const rows = await tx
    .update(ustaadMembers)
    .set(set)
    .where(and(eq(ustaadMembers.id, m.id), eq(ustaadMembers.version, m.version)))
    .returning({ id: ustaadMembers.id });
  if (rows.length === 0) throw new ConflictError('This member changed meanwhile', 'STALE_REPORT');
  await recordUstaadEvent(tx, {
    entityType: 'member',
    entityId: m.id,
    kind: kind === 'ban' ? 'banned' : 'restricted',
    fromStatus: m.status,
    toStatus: set.status,
    actorId: null,
    actorRole: 'staff',
    cityId: m.cityId,
    props: { days },
  });
}

/**
 * A community manager's decision on one report: keep (dismiss; a held item becomes visible), remove, warn (strike,
 * no Izzat change), restrict (`mod.restrict_days`), ban N days / permanent (four-eyes from
 * `mod.four_eyes_from_ban_days`: the first call proposes, `confirmUstaadBan` by another staff member applies).
 */
export async function actOnUstaadReport(
  db: Tx,
  staff: UstaadStaff,
  code: string,
  body: ModerationActBody,
  now = new Date(),
): Promise<ModerationResult> {
  return db.transaction(async (tx) => {
    const r = await scopedReport(tx, staff, code);
    if (!['open', 'in_review'].includes(r.status))
      throw new ConflictError('This report is already decided', 'STALE_REPORT');
    if (r.version !== body.version) throw new ConflictError('This report changed meanwhile', 'STALE_REPORT');
    const t = await targetOrGone(tx, r);
    await assertNotSelf(tx, staff, t);
    const s = await readUstaadSettingValues(tx, [
      'ustaad.mod.restrict_days',
      'ustaad.mod.four_eyes_from_ban_days',
      'ustaad.mod.false_report_strike_after',
    ]);
    const base = { report: r, target: t, reasonCode: body.reasonCode, actorId: staff.userId, now };

    if (body.action === 'ban') {
      const days = body.days === undefined ? null : body.days;
      if (banNeedsFourEyes(days, Number(s['ustaad.mod.four_eyes_from_ban_days']))) {
        if (await pendingBanOf(tx, r))
          throw new ConflictError('A ban is already waiting', 'USTAAD_BAN_PENDING');
        const moved = r.status === 'open' ? await moveReport(tx, r, 'in_review', body.version) : r;
        const [ev] = await tx
          .insert(ustaadEvents)
          .values({
            entityType: 'report',
            entityId: r.id,
            kind: 'ban_proposed',
            reasonCode: body.reasonCode,
            actorId: staff.userId,
            actorRole: 'staff',
            cityId: r.cityId,
            props: { schema_version: 1, days, note: body.note ?? null, memberId: t.authorMemberId },
          })
          .returning({ id: ustaadEvents.id });
        if (!ev) throw new Error('proposal insert returned nothing');
        await tx.insert(auditLog).values({
          actorUserId: staff.userId,
          actorRole: 'staff',
          action: 'ustaad.ban_proposed',
          entity: 'ustaad_report',
          entityId: r.code,
          after: { days },
          reason: body.reasonCode,
        });
        return { code: r.code, status: moved.status, media: [], pendingBan: { proposalId: ev.id } };
      }
      return finishBan(
        tx,
        r,
        t,
        { days, reasonCode: body.reasonCode, note: body.note ?? null },
        staff.userId,
        null,
        now,
      );
    }

    let media: MediaRelocation[] = [];
    let to: UstaadReportStatus = 'actioned';
    if (body.action === 'keep') {
      to = 'dismissed';
      const kept = keptStatusOf(t);
      if (kept) await moveUstaadTarget(tx, t, kept);
      await writeAction(tx, { ...base, action: 'keep' });
    } else if (body.action === 'remove') {
      media = await removeTarget(tx, t, body.reasonCode, now);
      await writeAction(tx, { ...base, action: 'remove', note: body.note ?? null });
      await notifyAuthor(tx, t, 'ustaad.content_removed', r.id);
    } else if (body.action === 'warn') {
      const actionId = await writeAction(tx, { ...base, action: 'warn', note: body.note ?? null });
      await addUstaadStrike(tx, {
        memberId: t.authorMemberId,
        reasonCode: body.reasonCode,
        izzatDelta: 0,
        actionId,
        staffUserId: staff.userId,
      });
      await notifyAuthor(tx, t, 'ustaad.strike', r.id);
    } else {
      const days = Number(s['ustaad.mod.restrict_days']);
      await applySanction(tx, t, 'restrict', days, now);
      const actionId = await writeAction(tx, { ...base, action: 'restrict', days, note: body.note ?? null });
      await addUstaadStrike(tx, {
        memberId: t.authorMemberId,
        reasonCode: body.reasonCode,
        izzatDelta: 0,
        actionId,
        staffUserId: staff.userId,
      });
      await notifyAuthor(tx, t, 'ustaad.strike', r.id);
    }
    const next = await moveReport(tx, r, to, body.version, { decidedBy: staff.userId, decidedAt: now });
    await afterDecision(tx, r, t, staff.userId, to, Number(s['ustaad.mod.false_report_strike_after']));
    return { code: next.code, status: next.status, media };
  });
}

async function afterDecision(
  tx: Tx,
  r: ReportRow,
  t: UstaadTarget,
  staffUserId: string,
  to: UstaadReportStatus,
  falseReportAfter: number,
): Promise<void> {
  await recordUstaadEvent(tx, {
    entityType: 'report',
    entityId: r.id,
    kind: 'decided',
    fromStatus: r.status,
    toStatus: to,
    actorId: staffUserId,
    actorRole: 'staff',
    cityId: r.cityId,
  });
  await resolveNotices(tx, {
    kinds: ['staff.ustaad_report', 'staff.ustaad_report_overdue'],
    entityIds: [r.id],
  });
  if (r.reasonCode === 'minor' || r.reasonCode === 'ncii_impersonation') {
    if (r.reasonCode === 'minor') await liftMinorRestriction(tx, t.authorMemberId, r.cityId);
    // Dismissed minor and NCII reports both count toward the false-report strike (security review fix 5).
    if (to === 'dismissed' && r.reporterId)
      await maybeFalseReportStrike(tx, {
        reporterId: r.reporterId,
        threshold: falseReportAfter,
        staffUserId,
      });
  }
  if (r.reporterId) {
    const [reporter] = await tx
      .select({ userId: ustaadMembers.userId })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, r.reporterId))
      .limit(1);
    if (reporter)
      await notifyUstaad(tx, 'ustaad.report_outcome', {
        userId: reporter.userId,
        entityId: r.id,
        version: to,
        params: { reportCode: r.code },
      });
  }
}

async function finishBan(
  tx: Tx,
  r: ReportRow,
  t: UstaadTarget,
  p: { days: number | null; reasonCode: string; note: string | null },
  actorId: string,
  secondActorId: string | null,
  now: Date,
): Promise<ModerationResult> {
  await applySanction(tx, t, 'ban', p.days, now);
  const actionId = await writeAction(tx, {
    report: r,
    target: t,
    action: 'ban',
    reasonCode: p.reasonCode,
    days: p.days,
    actorId,
    secondActorId,
    note: p.note,
    now,
  });
  await addUstaadStrike(tx, {
    memberId: t.authorMemberId,
    reasonCode: p.reasonCode,
    izzatDelta: 0,
    actionId,
    staffUserId: secondActorId ?? actorId,
  });
  await notifyAuthor(tx, t, 'ustaad.strike', r.id);
  const [fresh] = await tx.select().from(ustaadReports).where(eq(ustaadReports.id, r.id)).limit(1);
  if (!fresh) throw new NotFoundError('Report not found');
  const next = await moveReport(tx, fresh, 'actioned', fresh.version, {
    decidedBy: secondActorId ?? actorId,
    decidedAt: now,
  });
  const s = await readUstaadSettingValues(tx, ['ustaad.mod.false_report_strike_after']);
  await afterDecision(
    tx,
    r,
    t,
    secondActorId ?? actorId,
    'actioned',
    Number(s['ustaad.mod.false_report_strike_after']),
  );
  return { code: next.code, status: next.status, media: [] };
}

/** Four-eyes: a different staff member confirms the proposed ban (403 `FOUR_EYES` for the proposer). */
export async function confirmUstaadBan(
  db: Tx,
  staff: UstaadStaff,
  code: string,
  body: { proposalId: string; version: number },
  now = new Date(),
): Promise<ModerationResult> {
  return db.transaction(async (tx) => {
    const r = await scopedReport(tx, staff, code);
    if (r.version !== body.version) throw new ConflictError('This report changed meanwhile', 'STALE_REPORT');
    const pending = await pendingBanOf(tx, r);
    if (pending?.id !== body.proposalId)
      throw new ConflictError('No ban is waiting on this report', 'USTAAD_BAN_NOT_PENDING');
    if (pending.actorId === staff.userId)
      throw new ForbiddenError('Another staff member must confirm this ban', 'FOUR_EYES');
    const t = await targetOrGone(tx, r);
    await assertNotSelf(tx, staff, t);
    const p = pending.props as { days?: number | null; note?: string | null };
    await tx.insert(ustaadEvents).values({
      entityType: 'report',
      entityId: r.id,
      kind: 'ban_confirmed',
      reasonCode: pending.reasonCode,
      actorId: staff.userId,
      actorRole: 'staff',
      cityId: r.cityId,
      props: { schema_version: 1, proposalId: pending.id },
    });
    if (!pending.actorId) throw new ConflictError('The proposal has no author', 'USTAAD_BAN_NOT_PENDING');
    return finishBan(
      tx,
      r,
      t,
      { days: p.days ?? null, reasonCode: pending.reasonCode ?? 'abuse', note: p.note ?? null },
      pending.actorId,
      staff.userId,
      now,
    );
  });
}

/** The author's appeal (a support ticket `REQ-…` of theirs) is linked to an actioned report. */
export async function openUstaadAppeal(
  db: Tx,
  staff: UstaadStaff,
  code: string,
  body: { ticketCode: string; version: number },
): Promise<{ code: string; status: string }> {
  return db.transaction(async (tx) => {
    const r = await scopedReport(tx, staff, code);
    const t = await targetOrGone(tx, r);
    const [author] = await tx
      .select({ userId: ustaadMembers.userId })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, t.authorMemberId))
      .limit(1);
    const [ticket] = await tx
      .select({ id: supportTickets.id, userId: supportTickets.userId })
      .from(supportTickets)
      .where(eq(supportTickets.code, body.ticketCode))
      .limit(1);
    if (!author || ticket?.userId !== author.userId)
      throw new ValidationError("The ticket is not the author's", 'USTAAD_APPEAL_TICKET');
    const next = await moveReport(tx, r, 'appealed', body.version, { appealTicketId: ticket.id }, 'member');
    await recordUstaadEvent(tx, {
      entityType: 'report',
      entityId: r.id,
      kind: 'appealed',
      fromStatus: r.status,
      toStatus: 'appealed',
      actorId: staff.userId,
      actorRole: 'staff',
      cityId: r.cityId,
    });
    return { code: next.code, status: next.status };
  });
}

/**
 * An appeal is decided by a staff member who took no part in the decision (403 `FOUR_EYES`). `overturned` restores
 * the item (and its media), overturns the strikes and lifts a ban or restriction from this report.
 */
export async function decideUstaadAppeal(
  db: Tx,
  staff: UstaadStaff,
  code: string,
  body: { outcome: 'upheld' | 'overturned'; note?: string | undefined; version: number },
  now = new Date(),
): Promise<ModerationResult> {
  return db.transaction(async (tx) => {
    const r = await scopedReport(tx, staff, code);
    const actions = await tx
      .select()
      .from(ustaadModerationActions)
      .where(eq(ustaadModerationActions.reportId, r.id));
    const involved = new Set<string>(
      [r.decidedBy, ...actions.flatMap((a) => [a.actorId, a.secondActorId])].filter((x): x is string =>
        Boolean(x),
      ),
    );
    if (involved.has(staff.userId))
      throw new ForbiddenError('Another staff member must decide this appeal', 'FOUR_EYES');
    const t = await targetOrGone(tx, r);
    await assertNotSelf(tx, staff, t);
    let media: MediaRelocation[] = [];
    if (body.outcome === 'overturned') {
      // Security review fix 3: a legal removal is reversed only by someone holding `ustaad:takedown`, and nothing is
      // restored while any archive row of the item is on legal hold.
      const legal = r.source === 'legal_order' || actions.some((a) => a.action === 'takedown');
      const [held] = await tx
        .select({ id: ustaadRemovedArchive.id })
        .from(ustaadRemovedArchive)
        .where(
          and(
            eq(ustaadRemovedArchive.targetType, t.type),
            eq(ustaadRemovedArchive.targetId, t.id),
            isNotNull(ustaadRemovedArchive.legalHold),
          ),
        )
        .limit(1);
      if ((legal && !staff.canTakedown) || held)
        throw new ForbiddenError('This removal is under a legal order or hold', 'USTAAD_LEGAL_HOLD');
      if (actions.some((a) => a.action === 'remove' || a.action === 'takedown'))
        media = await restoreTarget(tx, t);
      await overturnUstaadStrikes(tx, {
        actionIds: actions.map((a) => a.id),
        staffUserId: staff.userId,
        appealTicketId: r.appealTicketId,
      });
      // Fix 2: only this report's sanction is lifted; the status is recomputed from the sanctions that remain.
      if (actions.some((a) => a.action === 'ban' || a.action === 'restrict'))
        await recomputeUstaadSanction(tx, t.authorMemberId, now);
      await writeAction(tx, {
        report: r,
        target: t,
        action: 'restore',
        reasonCode: 'appeal_overturned',
        actorId: staff.userId,
        note: body.note ?? null,
        now,
      });
    }
    const next = await moveReport(tx, r, body.outcome, body.version, { decidedAt: now });
    await recordUstaadEvent(tx, {
      entityType: 'report',
      entityId: r.id,
      kind: 'appeal_decided',
      fromStatus: 'appealed',
      toStatus: body.outcome,
      actorId: staff.userId,
      actorRole: 'staff',
      cityId: r.cityId,
    });
    await notifyAuthor(tx, t, 'ustaad.report_outcome', r.id, { reportCode: r.code });
    return { code: next.code, status: next.status, media };
  });
}

async function restoreTarget(tx: Tx, t: UstaadTarget): Promise<MediaRelocation[]> {
  if (t.status === 'removed') {
    let to = 'visible';
    if (t.type === 'question') {
      const [ev] = await tx
        .select({ from: ustaadEvents.fromStatus })
        .from(ustaadEvents)
        .where(
          and(
            eq(ustaadEvents.entityType, 'question'),
            eq(ustaadEvents.entityId, t.id),
            eq(ustaadEvents.toStatus, 'removed'),
          ),
        )
        .orderBy(desc(ustaadEvents.occurredAt))
        .limit(1);
      to = ev?.from && ev.from !== 'removed' ? ev.from : 'open';
    }
    // Jobs are terminal once removed (§ 7.7): the appeal restores nothing but the strikes and sanctions.
    if (t.type !== 'job' && t.type !== 'member') await moveUstaadTarget(tx, t, to);
  }
  const rows = await tx
    .select()
    .from(ustaadMedia)
    .where(and(inArray(ustaadMedia.id, t.mediaIds), eq(ustaadMedia.status, 'removed_archived')));
  const out: MediaRelocation[] = [];
  for (const m of rows) {
    if (m.legalHold) continue;
    ustaadMediaMachine.assert('removed_archived', 'verified', 'admin');
    const [moved] = await tx
      .update(ustaadMedia)
      .set({ status: 'verified', removedRetainUntil: null, purgeAfter: null })
      .where(and(eq(ustaadMedia.id, m.id), eq(ustaadMedia.version, m.version)))
      .returning();
    if (moved)
      out.push({
        mediaId: moved.id,
        ownerMemberId: moved.ownerMemberId,
        bucket: moved.bucket as UstaadMediaBucket,
        objectKey: moved.objectKey,
        mime: moved.declaredMime,
      });
  }
  return out;
}

/**
 * The member's status from the ban and restrict actions that still stand (their strike is active), after an appeal
 * overturned one of them: the longest remaining ban, else the longest remaining restriction, else active. A frozen
 * account (`restricted_mode = review`, POCSO) is never touched here; a minor-report mode stays as it is.
 */
async function recomputeUstaadSanction(tx: Tx, memberId: string, now: Date): Promise<void> {
  const [m] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, memberId)).limit(1);
  if (!m || m.status === 'left' || m.restrictedMode === 'review') return;
  const standing = await tx
    .select({
      action: ustaadModerationActions.action,
      days: ustaadModerationActions.days,
      at: ustaadModerationActions.createdAt,
    })
    .from(ustaadStrikes)
    .innerJoin(ustaadModerationActions, eq(ustaadModerationActions.id, ustaadStrikes.actionId))
    .where(
      and(
        eq(ustaadStrikes.memberId, memberId),
        eq(ustaadStrikes.status, 'active'),
        inArray(ustaadModerationActions.action, ['ban', 'restrict']),
      ),
    );
  const longest = (kind: 'ban' | 'restrict'): { live: boolean; until: Date | null } => {
    let live = false;
    let until: Date | null = new Date(0);
    for (const a of standing.filter((x) => x.action === kind)) {
      const end = a.days === null ? null : new Date(a.at.getTime() + a.days * 86_400_000);
      if (end !== null && end.getTime() <= now.getTime()) continue;
      live = true;
      if (end === null || until === null) until = null;
      else if (end.getTime() > until.getTime()) until = end;
    }
    return { live, until };
  };
  const ban = longest('ban');
  const restrict = longest('restrict');
  const set = ban.live
    ? { status: 'banned', bannedUntil: ban.until, restrictedUntil: null }
    : restrict.live && m.restrictedMode === 'none'
      ? { status: 'restricted', restrictedUntil: restrict.until, bannedUntil: null }
      : { status: 'active', bannedUntil: null, restrictedUntil: null };
  const rows = await tx
    .update(ustaadMembers)
    .set(set)
    .where(and(eq(ustaadMembers.id, m.id), eq(ustaadMembers.version, m.version)))
    .returning({ id: ustaadMembers.id });
  if (rows.length === 0) throw new ConflictError('This member changed meanwhile', 'STALE_REPORT');
  if (set.status !== m.status)
    await recordUstaadEvent(tx, {
      entityType: 'member',
      entityId: m.id,
      kind: 'sanction_recomputed',
      fromStatus: m.status,
      toStatus: set.status,
      actorId: null,
      actorRole: 'staff',
      cityId: m.cityId,
    });
}

// ── Legal takedown fast path ──────────────────────────────────────────────────────────────────────────────────

/**
 * `POST /admin/ustaad/moderation/takedowns` (`ustaad:takedown`): a court order or government intimation (3 h), an
 * intimate-image complaint (2 h) or a removal grievance (36 h). One call opens the report, removes the item across
 * every surface (status, archive, media refused at once) and records the legal basis in the audit row.
 */
export async function executeUstaadTakedown(
  db: Tx,
  staff: UstaadStaff,
  body: TakedownBody,
  now = new Date(),
): Promise<ModerationResult & { seconds: number }> {
  return db.transaction(async (tx) => {
    const t = await loadUstaadTarget(tx, body.targetType, body.targetId);
    if (!t) throw new NotFoundError('Not found');
    if (!staff.scope.all && (!t.cityId || !staff.scope.cityIds.includes(t.cityId)))
      throw new NotFoundError('Not found');
    await assertNotSelf(tx, staff, t);
    if (t.type === 'member')
      throw new ValidationError('A takedown removes content; ban a member instead', 'USTAAD_ACTION_INVALID');
    const legal = body.basis === 'court_order' || body.basis === 'gov_intimation';
    const reason = body.basis === 'ncii_complaint' ? 'ncii_impersonation' : 'other';
    const source = legal ? 'legal_order' : 'grievance';
    const clock = clockFor({
      source,
      reason,
      reasonDefault: 'standard_24h',
      grievanceClock: body.basis === 'grievance_removal' ? 'removal_36h' : 'grievance_7d',
    });
    const report = await insertUstaadReport(tx, {
      target: t,
      reporterId: null,
      source,
      reasonCode: reason,
      clock: body.basis === 'ncii_complaint' ? 'intimate_2h' : clock,
      now,
    });
    if (!report) throw new Error('takedown report not created');
    const media = await removeTarget(tx, t, body.basis, now, legal ? 'legal_order' : null);
    await tx.insert(auditLog).values({
      actorUserId: staff.userId,
      actorRole: 'staff',
      action: 'ustaad.takedown',
      entity: `ustaad_${t.type}`,
      entityId: t.id,
      before: { status: t.status },
      after: { report: report.code, basis: body.basis },
      reason: body.reference,
    });
    await tx.insert(ustaadModerationActions).values({
      reportId: report.id,
      targetType: t.type,
      targetId: t.id,
      action: 'takedown',
      reasonCode: body.basis,
      actorId: staff.userId,
    });
    const next = await moveReport(tx, report, 'actioned', report.version, {
      decidedBy: staff.userId,
      decidedAt: now,
    });
    const seconds = Math.max(0, Math.round((Date.now() - now.getTime()) / 1000));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'report',
        entityId: report.id,
        kind: 'takedown',
        toStatus: 'actioned',
        reasonCode: body.basis,
        actorId: staff.userId,
        actorRole: 'staff',
        cityId: report.cityId,
      },
      {
        name: 'ustaad_takedown_executed',
        memberId: null,
        userId: staff.userId,
        props: { clock: report.clock as UstaadReportClock, seconds },
      },
    );
    await notifyAuthor(tx, t, 'ustaad.content_removed', report.id);
    return { code: next.code, status: next.status, media, seconds };
  });
}

// ── DM read through a report (SR-38) ──────────────────────────────────────────────────────────────────────────

/**
 * The reported message and its thread (last 50 messages), only through an open or appealed report whose target is a
 * message, and every read is audited (`ustaad.dm_read`, reason code). No other staff path reads messages.
 */
export async function readUstaadReportedThread(
  db: Tx,
  staff: UstaadStaff,
  code: string,
  reason: 'report_review' | 'legal_request' | 'child_safety',
): Promise<{
  reportCode: string;
  messages: { id: string; sender: string; body: string | null; at: string; reported: boolean }[];
}> {
  return db.transaction(async (tx) => {
    const r = await scopedReport(tx, staff, code);
    if (r.targetType !== 'message' || !['open', 'in_review', 'appealed'].includes(r.status))
      throw new NotFoundError('Not found');
    const [msg] = await tx.select().from(ustaadMessages).where(eq(ustaadMessages.id, r.targetId)).limit(1);
    if (!msg) throw new NotFoundError('Not found');
    const rows = await tx
      .select({ m: ustaadMessages, handle: ustaadMembers.handle })
      .from(ustaadMessages)
      .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadMessages.senderId))
      .where(eq(ustaadMessages.threadId, msg.threadId))
      .orderBy(desc(ustaadMessages.createdAt))
      .limit(50);
    await tx.insert(auditLog).values({
      actorUserId: staff.userId,
      actorRole: 'staff',
      action: 'ustaad.dm_read',
      entity: 'ustaad_message_thread',
      entityId: msg.threadId,
      after: { report: r.code, messages: rows.length },
      reason,
    });
    return {
      reportCode: r.code,
      messages: rows.reverse().map(({ m, handle }) => ({
        id: m.id,
        sender: handle,
        body: m.body ? maskContactsInText(m.body) : null,
        at: m.createdAt.toISOString(),
        reported: m.id === msg.id,
      })),
    };
  });
}

// ── Child safety (SR-18) ──────────────────────────────────────────────────────────────────────────────────────

/** The classifier scored a verified file above the hold score: posts using it are held (screen reads this). */
export async function flagUstaadMediaUnsafe(
  tx: Tx,
  input: { mediaId: string; scorePct: number },
): Promise<void> {
  await recordUstaadEvent(tx, {
    entityType: 'media',
    entityId: input.mediaId,
    kind: 'safety_flagged',
    actorId: null,
    actorRole: 'system',
    props: { scorePct: input.scorePct },
  });
}

/**
 * A CSAM hash match: the file is already in the evidence vault (the API moved it); the media row is rejected with
 * `safety_block`, held for the law (`legal_hold = 'pocso'`, never purged by normal jobs), the account is frozen
 * (restricted, review mode, no end date), a 2 h `auto_safety` report opens and the POCSO task goes to everyone with
 * `ustaad:takedown` (the Grievance Officer's desk, runbook § POCSO).
 */
export async function sealUstaadMediaEvidence(
  db: Tx,
  input: { mediaId: string; evidenceKey: string; now?: Date },
): Promise<{ reportCode: string }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(ustaadMedia).where(eq(ustaadMedia.id, input.mediaId)).limit(1);
    if (!m) throw new NotFoundError('Media not found');
    const from = m.status === 'pending_upload' ? 'uploaded' : m.status;
    if (m.status === 'pending_upload') ustaadMediaMachine.assert('pending_upload', 'uploaded', 'member');
    ustaadMediaMachine.assert(from as 'uploaded', 'rejected', 'system');
    const [sealed] = await tx
      .update(ustaadMedia)
      .set({
        status: 'rejected',
        rejectReasonCode: 'safety_block',
        bucket: 'evidence',
        objectKey: input.evidenceKey,
        legalHold: 'pocso',
        purgeAfter: null,
      })
      .where(and(eq(ustaadMedia.id, m.id), eq(ustaadMedia.version, m.version)))
      .returning();
    if (!sealed) throw new ConflictError('This file changed meanwhile', 'STALE_MEDIA');
    const [member] = await tx
      .select()
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, m.ownerMemberId))
      .limit(1);
    if (!member) throw new NotFoundError('Member not found');
    if (member.status === 'active' || member.status === 'restricted')
      await tx
        .update(ustaadMembers)
        .set({ status: 'restricted', restrictedUntil: null, restrictedMode: 'review' })
        .where(eq(ustaadMembers.id, member.id));
    const target: UstaadTarget = {
      type: 'member',
      id: member.id,
      authorMemberId: member.id,
      cityId: member.cityId,
      status: member.status,
      version: member.version,
      text: null,
      mediaIds: [m.id],
    };
    const report = await insertUstaadReport(tx, {
      target,
      reporterId: null,
      source: 'auto_safety',
      reasonCode: 'minor',
      clock: 'intimate_2h',
      note: `media:${m.id}`,
      now,
    });
    if (!report) throw new Error('safety report not created');
    await recordUstaadEvent(tx, {
      entityType: 'media',
      entityId: m.id,
      kind: 'evidence_sealed',
      fromStatus: m.status,
      toStatus: 'rejected',
      reasonCode: 'safety_block',
      actorId: null,
      actorRole: 'system',
      cityId: member.cityId,
      props: { report: report.code },
    });
    await recordUstaadEvent(tx, {
      entityType: 'report',
      entityId: report.id,
      kind: 'pocso_task_opened',
      toStatus: 'open',
      reasonCode: 'minor',
      actorId: null,
      actorRole: 'system',
      cityId: member.cityId,
    });
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'ustaad.evidence_sealed',
      entity: 'ustaad_media',
      entityId: m.id,
      after: { report: report.code, member: member.id },
      reason: 'csam_hash_match',
    });
    for (const userId of await staffRecipients(tx, 'ustaad:takedown', member.cityId))
      await notifyUstaad(tx, 'staff.ustaad_report', {
        userId,
        entityId: report.id,
        version: 'pocso',
        params: { reportCode: report.code },
      });
    return { reportCode: report.code };
  });
}

// ── Jobs: clocks, sanctions, reminders ────────────────────────────────────────────────────────────────────────

/**
 * `ustaad_report_clock` (every minute): open reports at 50 % and 100 % of their clock notify the city's moderators
 * once per stage (`staff.ustaad_report_overdue`, deduped by the notice version); expired bans and restrictions end.
 */
export async function runUstaadReportClock(
  db: Tx,
  now = new Date(),
): Promise<{ half: number; overdue: number; lifted: number }> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(ustaadReports)
      .where(
        and(
          inArray(ustaadReports.status, ['open', 'in_review']),
          sql`${ustaadReports.createdAt} + (${ustaadReports.dueAt} - ${ustaadReports.createdAt}) / 2 <= ${now}`,
        ),
      )
      .orderBy(asc(ustaadReports.dueAt))
      .limit(500);
    let half = 0;
    let overdue = 0;
    for (const r of due) {
      const stage = r.dueAt.getTime() <= now.getTime() ? 100 : 50;
      const sent = await notifyUstaadModerators(
        tx,
        'staff.ustaad_report_overdue',
        r,
        `stage${String(stage)}`,
      );
      if (sent > 0) {
        if (stage === 100) overdue += 1;
        else half += 1;
      }
    }
    const lifted = await liftExpiredUstaadSanctions(tx, now);
    return { half, overdue, lifted };
  });
}

/** Bans and restrictions past their end date return the member to `active` (conditional, idempotent). */
export async function liftExpiredUstaadSanctions(tx: Tx, now = new Date()): Promise<number> {
  const rows = await tx
    .update(ustaadMembers)
    .set({ status: 'active', bannedUntil: null, restrictedUntil: null })
    .where(
      or(
        and(
          eq(ustaadMembers.status, 'banned'),
          isNotNull(ustaadMembers.bannedUntil),
          lte(ustaadMembers.bannedUntil, now),
        ),
        and(
          eq(ustaadMembers.status, 'restricted'),
          isNotNull(ustaadMembers.restrictedUntil),
          lte(ustaadMembers.restrictedUntil, now),
        ),
      ),
    )
    .returning({ id: ustaadMembers.id, cityId: ustaadMembers.cityId });
  for (const m of rows)
    await recordUstaadEvent(tx, {
      entityType: 'member',
      entityId: m.id,
      kind: 'sanction_ended',
      toStatus: 'active',
      actorId: null,
      actorRole: 'system',
      cityId: m.cityId,
    });
  return rows.length;
}

/**
 * `ustaad_rules_reminder` (daily): every active member gets the Community Rules reminder once per
 * `mod.rules_reminder_days` period (IT Rules, every 3 months). The notice version is the period number, so a rerun or
 * an overlapping worker writes nothing twice. Members are walked by id with a cursor (`afterId`) in batches.
 */
export async function sendUstaadRulesReminders(
  db: Tx,
  input: { now?: Date; batch?: number; afterId?: string | null } = {},
): Promise<{ sent: number; lastId: string | null }> {
  const now = input.now ?? new Date();
  const s = await readUstaadSettingValues(db, ['ustaad.mod.rules_reminder_days']);
  const period = Math.floor(now.getTime() / (Number(s['ustaad.mod.rules_reminder_days']) * 86_400_000));
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: ustaadMembers.id, userId: ustaadMembers.userId, joinedAt: ustaadMembers.joinedAt })
      .from(ustaadMembers)
      .where(
        and(
          ne(ustaadMembers.status, 'left'),
          ne(ustaadMembers.status, 'banned'),
          input.afterId ? gt(ustaadMembers.id, input.afterId) : sql`true`,
        ),
      )
      .orderBy(asc(ustaadMembers.id))
      .limit(input.batch ?? 500);
    let sent = 0;
    for (const m of members)
      if (
        await notifyUstaad(tx, 'ustaad.rules_reminder', {
          userId: m.userId,
          entityId: m.id,
          version: `p${String(period)}`,
          params: {},
        })
      )
        sent += 1;
    if (sent > 0)
      await tx.insert(auditLog).values({
        actorUserId: null,
        actorRole: 'system',
        action: 'ustaad.rules_reminder',
        entity: 'ustaad_members',
        entityId: null,
        after: { sent, period },
        reason: 'it_rules_periodic_reminder',
      });
    return { sent, lastId: members.at(-1)?.id ?? null };
  });
}
