/**
 * Level recompute and ring detection (spec 23 § 9.2, § 14, SR-8–SR-10; plan task B5). Workstream A shipped the
 * signature of `recomputeUstaadLevel`; workstream B made it real. The engine is pure (`@mechdost/shared/ustaad/levels`):
 * this file reads the facts, then moves the level one step at a time through the level machine with a conditional
 * UPDATE on (id, level, version). Bada and Master are never promoted here: a level review (an `ustaad_verifications`
 * row with `requested_level` bada/master, status `in_review`) is queued for staff (locked, SR-8). A Chhotu who meets
 * Naya without a verification gets a verification request instead (§ 9.2). Levels never drop here.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { ustaadLevelMachine } from '@mechdost/shared/state';
import type { UstaadLevel, UstaadMemberStatus } from '@mechdost/shared/ustaad/codes';
import {
  DEFAULT_LEVEL_RULES,
  EARNED_LEVELS,
  levelFor,
  qualifiedFollowers,
  type EarnedLevel,
  type LevelRule,
} from '@mechdost/shared/ustaad/levels';
import { detectRings, RING_DEFAULTS } from '@mechdost/shared/ustaad/rings';
import {
  users,
  ustaadFollows,
  ustaadLevelRules,
  ustaadMemberCounters,
  ustaadMembers,
  ustaadVerifications,
} from '../../schema';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import { notifyUstaad } from './notify';
import { readUstaadSettingValues } from './settings';

export interface LevelRecomputeResult {
  /** The level after the recompute (null when the member does not exist or cannot move). */
  level: UstaadLevel | null;
  /** True when a staff review is open for this member's next level (queued now or earlier). */
  reviewQueued: boolean;
}

/** The admin table's rules, or the founder's demo rules when the table is empty. */
async function levelRules(tx: Tx): Promise<readonly LevelRule[]> {
  const rows = await tx.select().from(ustaadLevelRules);
  const earned = rows.filter((r): r is typeof r & { level: EarnedLevel } =>
    (EARNED_LEVELS as readonly string[]).includes(r.level),
  );
  if (earned.length === 0) return DEFAULT_LEVEL_RULES;
  return earned.map((r) => ({
    level: r.level,
    ruleGroup: r.ruleGroup,
    minFollowers: r.minFollowers,
    minBestAnswers: r.minBestAnswers,
    minHelpfulPct: r.minHelpfulPct,
    minVerifiedYears: r.minVerifiedYears,
    minVideos: r.minVideos,
    minRecommendations: r.minRecommendations,
    needsStaffReview: r.needsStaffReview,
    coinMultiplierBp: r.coinMultiplierBp,
  }));
}

/** Followers as facts for `qualifiedFollowers()` (one indexed query on `followee_id`). */
async function followerFacts(tx: Tx, memberId: string) {
  const rows = await tx
    .select({
      followerId: ustaadFollows.followerId,
      counted: ustaadFollows.counted,
      verificationState: ustaadMembers.verificationState,
      status: ustaadMembers.status,
      workshopId: ustaadMembers.workshopId,
      accountCreatedAt: users.createdAt,
    })
    .from(ustaadFollows)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadFollows.followerId))
    .innerJoin(users, eq(users.id, ustaadMembers.userId))
    .where(eq(ustaadFollows.followeeId, memberId));
  return rows.map((r) => ({
    followerId: r.followerId,
    counted: r.counted,
    verified: r.verificationState === 'verified',
    status: r.status as UstaadMemberStatus,
    workshopId: r.workshopId,
    accountCreatedAt: r.accountCreatedAt,
  }));
}

async function hasOpenRequest(tx: Tx, memberId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: ustaadVerifications.id })
    .from(ustaadVerifications)
    .where(
      and(
        eq(ustaadVerifications.memberId, memberId),
        inArray(ustaadVerifications.status, ['requested', 'in_review']),
      ),
    )
    .limit(1);
  return row !== undefined;
}

const MAX_STEPS = 4;

/**
 * Recompute one member's level (nightly job and on the triggering event: best answer, follow, video completed,
 * verification approved). Safe to call any number of times.
 */
export async function recomputeUstaadLevel(tx: Tx, memberId: string): Promise<LevelRecomputeResult> {
  const s = await readUstaadSettingValues(tx, [
    'ustaad.levels.follower_min_age_days',
    'ustaad.levels.follower_exclude_same_garage',
  ]);
  const rules = await levelRules(tx);
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const [m] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, memberId)).limit(1);
    if (!m || m.status === 'banned' || m.status === 'left')
      return { level: m ? (m.level as UstaadLevel) : null, reviewQueued: false };
    const [c] = await tx
      .select()
      .from(ustaadMemberCounters)
      .where(eq(ustaadMemberCounters.memberId, memberId))
      .limit(1);
    const followers = await followerFacts(tx, memberId);
    const now = new Date();
    const level = m.level as UstaadLevel;
    const outcome = levelFor(
      {
        level,
        verified: m.verificationState === 'verified',
        qualifiedFollowers: qualifiedFollowers(followers, now, {
          minAgeDays: Number(s['ustaad.levels.follower_min_age_days']),
          excludeSameGarage: s['ustaad.levels.follower_exclude_same_garage'] === true,
          followeeWorkshopId: m.workshopId,
        }),
        bestAnswers: c?.bestAnswers ?? 0,
        // Helpful % = answers with a helpful vote ÷ answers (counters; the 12-month window is the nightly job's).
        helpfulPct: c && c.answers > 0 ? Math.floor((c.helpfulAnswers * 100) / c.answers) : 0,
        verifiedYears: m.verifiedYears ?? 0,
        videos: c?.videosWatched ?? 0,
        recommendations: c?.recommendations ?? 0,
      },
      rules,
    );
    if (outcome.needsVerification) {
      await tx
        .insert(ustaadVerifications)
        .values({ memberId, requestedLevel: 'naya', proofKinds: [] })
        .onConflictDoNothing();
      return { level, reviewQueued: false };
    }
    if (outcome.needsReview && outcome.reviewLevel) {
      const [queued] = await tx
        .insert(ustaadVerifications)
        .values({ memberId, requestedLevel: outcome.reviewLevel, status: 'in_review', proofKinds: [] })
        .onConflictDoNothing()
        .returning({ id: ustaadVerifications.id });
      if (queued)
        await recordUstaadEvent(tx, {
          entityType: 'verification',
          entityId: queued.id,
          kind: 'level_review_queued',
          toStatus: 'in_review',
          actorId: null,
          actorRole: 'system',
          cityId: m.cityId,
          props: { level: outcome.reviewLevel },
        });
      return { level, reviewQueued: queued !== undefined || (await hasOpenRequest(tx, memberId)) };
    }
    if (outcome.level === level) return { level, reviewQueued: false };
    ustaadLevelMachine.assert(level, outcome.level, 'system');
    const [moved] = await tx
      .update(ustaadMembers)
      .set({ level: outcome.level, levelSince: now })
      .where(
        and(
          eq(ustaadMembers.id, memberId),
          eq(ustaadMembers.level, level),
          eq(ustaadMembers.version, m.version),
        ),
      )
      .returning({ version: ustaadMembers.version });
    if (!moved) return { level, reviewQueued: false }; // a concurrent change won; the next run picks it up
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: memberId,
        kind: 'level_changed',
        fromStatus: level,
        toStatus: outcome.level,
        actorId: null,
        actorRole: 'system',
        cityId: m.cityId,
      },
      { name: 'ustaad_level_reached', memberId, userId: m.userId, props: { memberId, level: outcome.level } },
    );
    await notifyUstaad(tx, 'ustaad.level_up', {
      userId: m.userId,
      entityId: memberId,
      version: `level:${outcome.level}`,
      params: {},
    });
  }
  const [last] = await tx
    .select({ level: ustaadMembers.level })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, memberId));
  return { level: (last?.level as UstaadLevel | undefined) ?? null, reviewQueued: false };
}

export interface RingRunResult {
  /** Members newly flagged in this run. */
  flagged: number;
  /** Follow rows switched to `counted = false`. */
  uncounted: number;
}

/**
 * Nightly `ustaad_ring_detect` (§ 14 (a), SR-10). Reads only follows still counted inside the window, flags rings,
 * marks their follows not counted (reversible by staff) and writes one `ring_flagged` event per member for the
 * community manager's review card. Idempotent: flagged follows no longer count, so a rerun finds nothing new.
 */
export async function runUstaadRingDetect(tx: Tx, now: Date = new Date()): Promise<RingRunResult> {
  const from = new Date(now.getTime() - RING_DEFAULTS.windowDays * 86_400_000);
  const edges = await tx
    .select({
      followerId: ustaadFollows.followerId,
      followeeId: ustaadFollows.followeeId,
      createdAt: ustaadFollows.createdAt,
    })
    .from(ustaadFollows)
    .where(and(eq(ustaadFollows.counted, true), gte(ustaadFollows.createdAt, from)));
  const r = detectRings(edges, { now, ...RING_DEFAULTS });
  let uncounted = 0;
  for (const e of r.uncountedEdges) {
    const rows = await tx
      .update(ustaadFollows)
      .set({ counted: false })
      .where(
        and(
          eq(ustaadFollows.followerId, e.followerId),
          eq(ustaadFollows.followeeId, e.followeeId),
          eq(ustaadFollows.counted, true),
        ),
      )
      .returning({ f: ustaadFollows.followerId });
    uncounted += rows.length;
  }
  if (r.flaggedMembers.length > 0) {
    const members = await tx
      .select({ id: ustaadMembers.id, cityId: ustaadMembers.cityId })
      .from(ustaadMembers)
      .where(inArray(ustaadMembers.id, r.flaggedMembers));
    for (const m of members)
      await recordUstaadEvent(tx, {
        entityType: 'member',
        entityId: m.id,
        kind: 'ring_flagged',
        reasonCode: 'reciprocal_follows',
        actorId: null,
        actorRole: 'system',
        cityId: m.cityId,
        props: { window_days: RING_DEFAULTS.windowDays },
      });
  }
  return { flagged: r.flaggedMembers.length, uncounted };
}

/** Members to recompute in the nightly job: active members, oldest check first (bounded batch). */
export async function ustaadMembersForLevelJob(tx: Tx, limit = 500): Promise<string[]> {
  const rows = await tx
    .select({ id: ustaadMembers.id })
    .from(ustaadMembers)
    .where(inArray(ustaadMembers.status, ['active', 'restricted']))
    .orderBy(sql`${ustaadMembers.lastActiveAt} desc nulls last`)
    .limit(limit);
  return rows.map((r) => r.id);
}
