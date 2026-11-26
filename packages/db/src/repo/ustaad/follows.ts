/**
 * Follow (spec 23 § 4 flow 7, § 6.2, § 6.9; workstream D2). One tap, no approval, open to all members; counts are
 * visible (ruling). A follow inserts its row with `ON CONFLICT DO NOTHING RETURNING` and only an inserted row moves
 * the counters (never read-then-write); unfollow mirrors it from `DELETE … RETURNING` with a `> 0` guard. Level
 * counting (qualified followers, SR-9) is workstream B's job: this file only writes the `followed` / `unfollowed`
 * events and keeps `ustaad_follows.counted` untouched. Follower Izzat is keyed on the pair, so follow → unfollow →
 * follow cannot farm it. Blocked either way = 404 (SR-35).
 */
import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import type {
  FollowListQuery,
  FollowResult,
  MemberCard,
  Relationship,
} from '@mechdost/shared/ustaad/dto/social';
import {
  ustaadConnections,
  ustaadFollows,
  ustaadMemberCounters,
  ustaadMembers,
  ustaadMutes,
  ustaadThreads,
} from '../../schema';
import { DailyCapError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import {
  bumpUstaadDailyCounter,
  decodeUstaadCursor,
  encodeUstaadCursor,
  ustaadActingMember,
  ustaadMemberCard,
  ustaadNotBlockedSql,
  ustaadVisibleMember,
} from './graph-common';
import { recordIzzat } from './izzat';
import { notifyUstaad } from './notify';
import type { UstaadActor } from './qa';
import { readUstaadSettingValues } from './settings';
import { orderedPair } from '@mechdost/shared/ustaad/social-rules';

const PAGE = 20;

async function followerCount(tx: Tx, memberId: string): Promise<number | null> {
  const s = await readUstaadSettingValues(tx, ['ustaad.feed.show_follower_counts']);
  if (s['ustaad.feed.show_follower_counts'] !== true) return null;
  const [c] = await tx
    .select({ n: ustaadMemberCounters.followers })
    .from(ustaadMemberCounters)
    .where(eq(ustaadMemberCounters.memberId, memberId))
    .limit(1);
  return c?.n ?? 0;
}

/**
 * Follow a member (idempotent). Refuses `USTAAD_SELF_FOLLOW` (422), a member the caller may not see (404) and the
 * daily cap `limits.follows_per_day` (429 `USTAAD_DAILY_CAP`; the API rate limit sits in front of it too). A
 * restricted member may still follow (reading choices are not writes of content).
 */
export async function followUstaadMember(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
): Promise<FollowResult> {
  if (targetId === actor.memberId)
    throw new ValidationError('You cannot follow yourself', 'USTAAD_SELF_FOLLOW');
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const target = await ustaadVisibleMember(tx, me.id, targetId);
    const s = await readUstaadSettingValues(tx, ['ustaad.limits.follows_per_day']);
    const inserted = await tx
      .insert(ustaadFollows)
      .values({ followerId: me.id, followeeId: target.id })
      .onConflictDoNothing()
      .returning({ at: ustaadFollows.createdAt });
    if (inserted.length === 0) return { following: true, followers: await followerCount(tx, target.id) };
    // Atomic daily cap (security review 2026-11-26): one conditional upsert after a real insert; a refusal rolls the
    // follow back. Unfollow never gives the slot back, so follow/unfollow churn cannot pass the cap.
    if (!(await bumpUstaadDailyCounter(tx, me.id, 'follows', 1, Number(s['ustaad.limits.follows_per_day']))))
      throw new DailyCapError('You have followed enough people for today', 'USTAAD_DAILY_CAP');
    await tx
      .update(ustaadMemberCounters)
      .set({ followers: sql`${ustaadMemberCounters.followers} + 1` })
      .where(eq(ustaadMemberCounters.memberId, target.id));
    await tx
      .update(ustaadMemberCounters)
      .set({ following: sql`${ustaadMemberCounters.following} + 1` })
      .where(eq(ustaadMemberCounters.memberId, me.id));
    await recordIzzat(
      tx,
      { userId: actor.userId },
      {
        memberId: target.id,
        reason: 'follower_gained',
        source: { type: 'member', id: me.id },
        idemKey: `follow:${me.id}:${target.id}`,
      },
    );
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: target.id,
        kind: 'followed',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: target.cityId,
        props: { followerId: me.id },
      },
      {
        name: 'ustaad_followed',
        memberId: me.id,
        userId: actor.userId,
        props: { followerId: me.id, followeeId: target.id },
      },
    );
    // One notice per follower and member, ever (the dedupe key), so follow/unfollow loops cannot spam the bell.
    await notifyUstaad(tx, 'ustaad.follow', {
      userId: target.userId,
      entityId: target.id,
      version: `f-${me.id}`,
      params: { count: 1 },
    });
    return { following: true, followers: await followerCount(tx, target.id) };
  });
}

async function deleteFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const gone = await tx
    .delete(ustaadFollows)
    .where(and(eq(ustaadFollows.followerId, followerId), eq(ustaadFollows.followeeId, followeeId)))
    .returning({ at: ustaadFollows.createdAt });
  if (gone.length === 0) return false;
  await tx
    .update(ustaadMemberCounters)
    .set({ followers: sql`${ustaadMemberCounters.followers} - 1` })
    .where(and(eq(ustaadMemberCounters.memberId, followeeId), gt(ustaadMemberCounters.followers, 0)));
  await tx
    .update(ustaadMemberCounters)
    .set({ following: sql`${ustaadMemberCounters.following} - 1` })
    .where(and(eq(ustaadMemberCounters.memberId, followerId), gt(ustaadMemberCounters.following, 0)));
  return true;
}

/**
 * Remove a follow row inside the caller's transaction (unfollow, remove follower, block). Writes the `unfollowed`
 * event on the followee (B's level job reads it) and, for a member's own unfollow, the analytics event.
 */
export async function dropUstaadFollow(
  tx: Tx,
  followerId: string,
  followeeId: string,
  ctx: { actorUserId: string | null; reason: 'unfollow' | 'removed_by_followee' | 'blocked' },
): Promise<boolean> {
  const removed = await deleteFollow(tx, followerId, followeeId);
  if (!removed) return false;
  await recordUstaadEvent(
    tx,
    {
      entityType: 'member',
      entityId: followeeId,
      kind: 'unfollowed',
      reasonCode: ctx.reason,
      actorId: ctx.actorUserId,
      actorRole: 'member',
      props: { followerId },
    },
    ctx.reason === 'unfollow'
      ? {
          name: 'ustaad_unfollowed',
          memberId: followerId,
          userId: ctx.actorUserId,
          props: { followerId, followeeId },
        }
      : undefined,
  );
  return true;
}

/** Unfollow (idempotent; a missing row changes nothing). Works even if a block now hides the other member. */
export async function unfollowUstaadMember(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
): Promise<FollowResult> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    await dropUstaadFollow(tx, me.id, targetId, { actorUserId: actor.userId, reason: 'unfollow' });
    return { following: false, followers: await followerCount(tx, targetId) };
  });
}

/** "Remove follower" (spec 23 flow 7): the caller drops someone who follows them. */
export async function removeUstaadFollower(
  db: Tx,
  actor: UstaadActor,
  followerId: string,
): Promise<{ removed: boolean }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const removed = await dropUstaadFollow(tx, followerId, me.id, {
      actorUserId: actor.userId,
      reason: 'removed_by_followee',
    });
    return { removed };
  });
}

/**
 * Followers or following of a member (default: the caller), newest first, keyset cursor, 20 a page. Members blocked
 * either way with the caller are left out; the list of a member the caller may not see is 404.
 */
export async function listUstaadFollows(
  db: Tx,
  actor: UstaadActor,
  q: FollowListQuery,
): Promise<{ items: MemberCard[]; nextCursor: string | null }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const subject =
    q.memberId && q.memberId !== me.id ? (await ustaadVisibleMember(db, me.id, q.memberId)).id : me.id;
  const followers = q.kind === 'followers';
  const other = followers ? ustaadFollows.followerId : ustaadFollows.followeeId;
  const cur = decodeUstaadCursor(q.cursor);
  const rows = await db
    .select({ m: ustaadMembers, at: ustaadFollows.createdAt })
    .from(ustaadFollows)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, other))
    .where(
      and(
        eq(followers ? ustaadFollows.followeeId : ustaadFollows.followerId, subject),
        sql`${ustaadMembers.status} in ('active', 'restricted')`,
        ustaadNotBlockedSql(me.id, sql`${other}`),
        cur
          ? or(
              lt(ustaadFollows.createdAt, cur.at),
              and(eq(ustaadFollows.createdAt, cur.at), lt(other, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ustaadFollows.createdAt), desc(other))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ustaadMemberCard(r.m)),
    nextCursor: rows.length > PAGE && last ? encodeUstaadCursor(last.at, last.m.id) : null,
  };
}

/** What the caller's view of another member's profile needs (404 when blocked either way). */
export async function ustaadRelationship(
  db: Tx,
  actor: UstaadActor,
  targetId: string,
): Promise<Relationship> {
  const me = await ustaadActingMember(db, actor.memberId);
  const target = await ustaadVisibleMember(db, me.id, targetId);
  const [following] = await db
    .select({ x: sql`1` })
    .from(ustaadFollows)
    .where(and(eq(ustaadFollows.followerId, me.id), eq(ustaadFollows.followeeId, target.id)));
  const [followsMe] = await db
    .select({ x: sql`1` })
    .from(ustaadFollows)
    .where(and(eq(ustaadFollows.followerId, target.id), eq(ustaadFollows.followeeId, me.id)));
  const [muted] = await db
    .select({ x: sql`1` })
    .from(ustaadMutes)
    .where(and(eq(ustaadMutes.memberId, me.id), eq(ustaadMutes.targetId, target.id)));
  const pair = orderedPair(me.id, target.id);
  const [conn] = await db
    .select()
    .from(ustaadConnections)
    .where(and(eq(ustaadConnections.lowId, pair.lowId), eq(ustaadConnections.highId, pair.highId)));
  const [thread] = await db
    .select({ id: ustaadThreads.id, status: ustaadThreads.status })
    .from(ustaadThreads)
    .where(and(eq(ustaadThreads.lowId, pair.lowId), eq(ustaadThreads.highId, pair.highId)));
  return {
    following: following !== undefined,
    followsMe: followsMe !== undefined,
    connection: conn
      ? {
          id: conn.id,
          status: conn.status as NonNullable<Relationship['connection']>['status'],
          mine: conn.requestedBy === me.id,
        }
      : null,
    blocked: false,
    muted: muted !== undefined,
    threadId: thread && thread.status !== 'blocked' ? thread.id : null,
  };
}
