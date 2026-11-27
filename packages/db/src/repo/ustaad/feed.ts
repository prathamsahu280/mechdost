/**
 * The Home feed (spec 23 § 9.5; plan task D2). Mechanics only (the gate and the member guard come first).
 *  - For you: candidates from the last `feed.window_days` (posts by members I follow, posts with a tag I follow or
 *    my vehicle speciality, my city, my own), ranked by the pure `rankFeed` with the admin weights `feed.w_*`, at most
 *    300 ids. The API keeps that list as a 10-minute snapshot and pages through it (no repeats, no skips); each page is
 *    hydrated by `ustaadPostsByIds`, which re-checks visibility (removed, blocked, expired posts drop out).
 *  - Following: posts by members I follow, newest first, keyset on `(created_at, id)`.
 * Both leave out stories, held posts, muted and blocked authors and authors who are not shown (left, banned,
 * restricted). No trending tab, no promotions here (workstream D part 2).
 */
import { and, desc, eq, gt, lt, ne, or, sql } from 'drizzle-orm';
import type { FeedPage } from '@mechdost/shared/ustaad/dto/feed';
import { FEED_SNAPSHOT_MAX, rankFeed } from '@mechdost/shared/ustaad/feed-score';
import { ustaadPostCounters, ustaadPosts } from '../../schema';
import { decodeCursor, encodeCursor } from '../cursor';
import type { Tx } from '../orders';
import { feedMember, notMuted, postVisibleTo, type UstaadActor } from './feed-common';
import { ustaadPostsByIds } from './posts';
import { readUstaadSettingValues } from './settings';

const truthy = (v: unknown) => v === true || v === 't';

/** Ranked post ids for the For you tab (≤ 300). */
export async function ustaadForYouIds(db: Tx, actor: UstaadActor, now = new Date()): Promise<string[]> {
  const me = await feedMember(db, actor.memberId);
  const s = await readUstaadSettingValues(db, [
    'ustaad.feed.w_follows',
    'ustaad.feed.w_city',
    'ustaad.feed.w_tag',
    'ustaad.feed.w_recency',
    'ustaad.feed.w_helpful',
    'ustaad.feed.window_days',
  ]);
  const p = ustaadPosts;
  const followed = sql<boolean>`exists (select 1 from ustaad_follows fo
      where fo.follower_id = ${me.id} and fo.followee_id = ${p.authorId})`;
  const tagMatch = sql<boolean>`(exists (select 1 from ustaad_post_tags pt
        join ustaad_tag_follows tf on tf.tag_id = pt.tag_id and tf.member_id = ${me.id}
        where pt.post_id = ${p.id})
      or exists (select 1 from ustaad_member_specialities sp
        where sp.member_id = ${me.id} and sp.code = ${p.segmentCode}))`;
  const rows = await db
    .select({
      id: p.id,
      createdAt: p.createdAt,
      cityId: p.cityId,
      authorId: p.authorId,
      followed,
      tagMatch,
      likes: ustaadPostCounters.likes,
      saves: ustaadPostCounters.saves,
      views: ustaadPostCounters.views,
    })
    .from(p)
    .leftJoin(ustaadPostCounters, eq(ustaadPostCounters.postId, p.id))
    .where(
      and(
        eq(p.status, 'visible'),
        sql`${p.kind} <> 'story'`,
        sql`${p.createdAt} > now() - make_interval(days => ${Number(s['ustaad.feed.window_days'])})`,
        postVisibleTo(me.id),
        notMuted(me.id),
        or(eq(p.authorId, me.id), eq(p.cityId, me.cityId), followed, tagMatch),
      ),
    )
    .orderBy(desc(p.createdAt))
    .limit(1000);
  return rankFeed(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      followed: truthy(r.followed),
      sameCity: r.cityId === me.cityId,
      tagMatch: truthy(r.tagMatch),
      likes: r.likes ?? 0,
      saves: r.saves ?? 0,
      views: r.views ?? 0,
    })),
    {
      follows: Number(s['ustaad.feed.w_follows']),
      city: Number(s['ustaad.feed.w_city']),
      tag: Number(s['ustaad.feed.w_tag']),
      recency: Number(s['ustaad.feed.w_recency']),
      helpful: Number(s['ustaad.feed.w_helpful']),
    },
    now.getTime(),
    FEED_SNAPSHOT_MAX,
  );
}

/** The Following tab: members I follow, newest first. */
export async function listUstaadFollowingFeed(
  db: Tx,
  actor: UstaadActor,
  page: { cursor?: string | undefined; limit: number },
): Promise<FeedPage> {
  const me = await feedMember(db, actor.memberId);
  const p = ustaadPosts;
  const cur = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const rows = await db
    .select({ id: p.id, k: sql<string>`${p.createdAt}::text` })
    .from(p)
    .where(
      and(
        eq(p.status, 'visible'),
        sql`${p.kind} <> 'story'`,
        sql`exists (select 1 from ustaad_follows fo where fo.follower_id = ${me.id} and fo.followee_id = ${p.authorId})`,
        postVisibleTo(me.id),
        notMuted(me.id),
        cur
          ? or(
              lt(p.createdAt, sql`${cur.k}::timestamptz`),
              and(eq(p.createdAt, sql`${cur.k}::timestamptz`), lt(p.id, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(page.limit + 1);
  const slice = rows.slice(0, page.limit);
  const last = slice.at(-1);
  return {
    items: await ustaadPostsByIds(
      db,
      actor,
      slice.map((r) => r.id),
    ),
    nextCursor: rows.length > page.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
  };
}

/** The most a "new posts" check reports: the pill only needs "some". */
export const FEED_FRESH_MAX = 10;

/**
 * "New posts" for the Home pill (UI upgrade U1, design § 3.1; closes SIM-F4): how many feed candidates for this tab
 * arrived after `since` (the newest item the member already has), capped at {@link FEED_FRESH_MAX}. Same candidate
 * rules as the tabs above (visible, not a story, not blocked or muted, author shown; For you = mine-city, followed or
 * matching tag; Following = followed authors), never my own posts. A bounded `limit` read on the
 * `(city_id, status, created_at)` index; no ranking, no snapshot.
 */
export async function countUstaadFreshFeed(
  db: Tx,
  actor: UstaadActor,
  q: { tab: 'for_you' | 'following'; since: Date },
): Promise<number> {
  const me = await feedMember(db, actor.memberId);
  const p = ustaadPosts;
  const followed = sql<boolean>`exists (select 1 from ustaad_follows fo
      where fo.follower_id = ${me.id} and fo.followee_id = ${p.authorId})`;
  const tagMatch = sql<boolean>`(exists (select 1 from ustaad_post_tags pt
        join ustaad_tag_follows tf on tf.tag_id = pt.tag_id and tf.member_id = ${me.id}
        where pt.post_id = ${p.id})
      or exists (select 1 from ustaad_member_specialities sp
        where sp.member_id = ${me.id} and sp.code = ${p.segmentCode}))`;
  const rows = await db
    .select({ id: p.id })
    .from(p)
    .where(
      and(
        eq(p.status, 'visible'),
        sql`${p.kind} <> 'story'`,
        gt(p.createdAt, q.since),
        ne(p.authorId, me.id),
        postVisibleTo(me.id),
        notMuted(me.id),
        q.tab === 'following' ? followed : or(eq(p.cityId, me.cityId), followed, tagMatch),
      ),
    )
    .limit(FEED_FRESH_MAX);
  return rows.length;
}
