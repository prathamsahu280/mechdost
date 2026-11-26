/**
 * Stories, "Today at the garages" (spec 23 § 4 flow 6, § 7.4, § 10 step 4–5; plan task D1). A story is a post of
 * kind `story` with one photo, voice note or short video (+ the video's poster) and `expires_at = now +
 * stories.hours`. Expiry is enforced in every read and in media signing (`postVisibleTo`, `readableUstaadMedia`, both
 * on the database clock), and the `ustaad_story_expire` job moves `visible → expired` and schedules the media purge
 * after `stories.purge_grace_hours`. Accounts younger than `stories.min_account_days` cannot post stories
 * (`USTAAD_STORIES_LOCKED`, security review § 0). Rings: mine, the members I follow and my city; muted and blocked
 * authors never show. "Seen by N" is the owner's alone.
 */
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { ustaadContentMachine } from '@mechdost/shared/state';
import type { CreateStory, StoryRing } from '@mechdost/shared/ustaad/dto/feed';
import {
  ustaadMedia,
  ustaadMembers,
  ustaadPostCounters,
  ustaadPostMedia,
  ustaadPosts,
  ustaadStoryViews,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import {
  feedMember,
  feedWriter,
  memberAgeDays,
  notMuted,
  ownUnusedMedia,
  postVisibleTo,
  visibleUstaadPost,
  type UstaadActor,
} from './feed-common';
import { openUstaadAutoHoldReport, screenUstaadContent } from './moderation';
import { ustaadScreenText } from './screen-text';
import { authorColumns, ustaadMediaViews } from './posts';
import { readUstaadSettingValues } from './settings';

const KIND_OF_MEDIA = { image: 'photo', audio: 'voice', video: 'video' } as const;

export async function createUstaadStory(
  db: Tx,
  actor: UstaadActor,
  input: CreateStory,
): Promise<{ id: string; status: string; expiresAt: string }> {
  return db.transaction(async (tx) => {
    const me = await feedWriter(tx, actor.memberId, true);
    const [existing] = await tx
      .select({ id: ustaadPosts.id, status: ustaadPosts.status, expiresAt: ustaadPosts.expiresAt })
      .from(ustaadPosts)
      .where(and(eq(ustaadPosts.authorId, me.id), eq(ustaadPosts.idemKey, input.idemKey)))
      .limit(1);
    if (existing) return { ...existing, expiresAt: existing.expiresAt?.toISOString() ?? '' };
    const s = await readUstaadSettingValues(tx, [
      'ustaad.posts.types.stories',
      'ustaad.stories.hours',
      'ustaad.stories.min_account_days',
      'ustaad.posts.video_max_s',
      'ustaad.media.voice_max_s',
    ]);
    if (s['ustaad.posts.types.stories'] !== true)
      throw new ValidationError('Stories are switched off', 'USTAAD_POST_TYPE_OFF');
    if (memberAgeDays(me) < Number(s['ustaad.stories.min_account_days']))
      throw new ForbiddenError('Stories open after your first month', 'USTAAD_STORIES_LOCKED');
    const ids = [input.mediaId, ...(input.posterMediaId ? [input.posterMediaId] : [])];
    const [main, poster] = await ownUnusedMedia(tx, me.id, ids);
    if (
      !main ||
      !(main.kind in KIND_OF_MEDIA) ||
      (poster && (poster.kind !== 'image' || main.kind !== 'video'))
    )
      throw new ValidationError('That file cannot be used', 'USTAAD_MEDIA_INVALID');
    const maxS =
      main.kind === 'video'
        ? Number(s['ustaad.posts.video_max_s'])
        : main.kind === 'audio'
          ? Number(s['ustaad.media.voice_max_s'])
          : null;
    if (maxS !== null && (main.durationMs ?? 0) > maxS * 1000)
      throw new ValidationError('Too long', 'USTAAD_MEDIA_TOO_LONG', { maxSeconds: maxS });
    const screen = await screenUstaadContent(tx, {
      kind: 'story',
      // A story caption has no smart correction (no original is accepted or stored).
      text: ustaadScreenText({ parts: [input.body], original: null, correction: 'none' }),
      mediaIds: ids,
      authorId: me.id,
    });
    if (screen === 'block')
      throw new ValidationError('This story cannot be shared', 'USTAAD_CONTENT_BLOCKED');
    const status = screen === 'ok' ? 'visible' : 'held';
    const [row] = await tx
      .insert(ustaadPosts)
      .values({
        authorId: me.id,
        cityId: me.cityId,
        kind: 'story',
        contentType: 'ugc',
        body: input.body ?? null,
        status,
        heldReasonCode: status === 'held' ? 'auto_screen' : null,
        expiresAt: sql`now() + make_interval(hours => ${Number(s['ustaad.stories.hours'])})`,
        idemKey: input.idemKey,
      })
      .returning({ id: ustaadPosts.id, status: ustaadPosts.status, expiresAt: ustaadPosts.expiresAt });
    if (!row?.expiresAt) throw new ConflictError('Could not save the story');
    await tx
      .insert(ustaadPostMedia)
      .values(ids.map((mediaId, position) => ({ postId: row.id, mediaId, position })));
    await tx.insert(ustaadPostCounters).values({ postId: row.id });
    const kind = KIND_OF_MEDIA[main.kind as keyof typeof KIND_OF_MEDIA];
    await recordUstaadEvent(
      tx,
      {
        entityType: 'post',
        entityId: row.id,
        kind: 'story_created',
        toStatus: status,
        actorId: actor.userId,
        actorRole: 'member',
        cityId: me.cityId,
        props: { media: kind },
      },
      {
        name: 'ustaad_story_created',
        memberId: me.id,
        userId: actor.userId,
        props: { postId: row.id, kind },
      },
    );
    // Held stories reach the moderation queue with a clock (G2).
    if (status === 'held')
      await openUstaadAutoHoldReport(tx, {
        targetType: 'story',
        targetId: row.id,
        authorId: me.id,
        kind: 'story',
      });
    return { id: row.id, status: row.status, expiresAt: row.expiresAt.toISOString() };
  });
}

/** Story rings for the viewer: mine first, then rings with unseen stories, then the most recent. */
export async function listUstaadStories(db: Tx, actor: UstaadActor): Promise<StoryRing[]> {
  const me = await feedMember(db, actor.memberId);
  const p = ustaadPosts;
  const rows = await db
    .select({ post: p, author: authorColumns })
    .from(p)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, p.authorId))
    .where(
      and(
        eq(p.kind, 'story'),
        postVisibleTo(me.id),
        notMuted(me.id),
        or(
          eq(p.authorId, me.id),
          eq(ustaadMembers.cityId, me.cityId),
          sql`exists (select 1 from ustaad_follows fo where fo.follower_id = ${me.id} and fo.followee_id = ${p.authorId})`,
        ),
      ),
    )
    .orderBy(asc(p.createdAt))
    .limit(500);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.post.id);
  const mineIds = rows.filter((r) => r.post.authorId === me.id).map((r) => r.post.id);
  const [media, seen, counts] = await Promise.all([
    ustaadMediaViews(db, ids),
    db
      .select({ postId: ustaadStoryViews.postId })
      .from(ustaadStoryViews)
      .where(and(eq(ustaadStoryViews.viewerId, me.id), inArray(ustaadStoryViews.postId, ids))),
    mineIds.length
      ? db
          .select({ postId: ustaadStoryViews.postId, n: sql<number>`count(*)::int` })
          .from(ustaadStoryViews)
          .where(inArray(ustaadStoryViews.postId, mineIds))
          .groupBy(ustaadStoryViews.postId)
      : Promise.resolve([] as { postId: string; n: number }[]),
  ]);
  const seenSet = new Set(seen.map((x) => x.postId));
  const countOf = new Map(counts.map((c) => [c.postId, c.n]));
  const rings = new Map<string, StoryRing & { latest: number }>();
  for (const { post, author } of rows) {
    const mine = post.authorId === me.id;
    const ring = rings.get(post.authorId) ?? { author, mine, allSeen: true, stories: [], latest: 0 };
    const isSeen = mine || seenSet.has(post.id);
    ring.stories.push({
      id: post.id,
      body: post.body,
      media: media.get(post.id) ?? [],
      seen: isSeen,
      seenBy: mine ? (countOf.get(post.id) ?? 0) : null,
      createdAt: post.createdAt.toISOString(),
      expiresAt: post.expiresAt?.toISOString() ?? '',
    });
    ring.allSeen = ring.allSeen && isSeen;
    ring.latest = Math.max(ring.latest, post.createdAt.getTime());
    rings.set(post.authorId, ring);
  }
  return [...rings.values()]
    .sort(
      (a, b) =>
        Number(b.mine) - Number(a.mine) || Number(a.allSeen) - Number(b.allSeen) || b.latest - a.latest,
    )
    .map(({ latest: _latest, ...r }) => r);
}

/** Marks a story seen (once per viewer; the owner's own view is not counted). */
export async function viewUstaadStory(db: Tx, actor: UstaadActor, storyId: string): Promise<{ seen: true }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const post = await visibleUstaadPost(tx, me.id, storyId);
    if (post.kind !== 'story' || post.status !== 'visible') throw new NotFoundError('Story not found');
    if (post.authorId === me.id) return { seen: true };
    const inserted = await tx
      .insert(ustaadStoryViews)
      .values({ postId: post.id, viewerId: me.id })
      .onConflictDoNothing()
      .returning({ postId: ustaadStoryViews.postId });
    if (inserted.length > 0)
      await tx
        .update(ustaadPostCounters)
        .set({ views: sql`${ustaadPostCounters.views} + 1` })
        .where(eq(ustaadPostCounters.postId, post.id));
    return { seen: true };
  });
}

/**
 * The `ustaad_story_expire` job (every 5 minutes): visible stories past `expires_at` move to `expired` (conditional
 * UPDATE on status + version, an `ustaad_events` row each) and their media get `purge_after = expires_at +
 * stories.purge_grace_hours` (the media purge job deletes the objects; a legal hold keeps them). Held stories that
 * expire are left for moderation. Returns how many moved.
 */
export async function expireUstaadStories(db: Tx, opts: { limit: number }): Promise<number> {
  return db.transaction(async (tx) => {
    const s = await readUstaadSettingValues(tx, ['ustaad.stories.purge_grace_hours']);
    const grace = Number(s['ustaad.stories.purge_grace_hours']);
    const due = await tx
      .select({ id: ustaadPosts.id, version: ustaadPosts.version, cityId: ustaadPosts.cityId })
      .from(ustaadPosts)
      .where(
        and(
          eq(ustaadPosts.kind, 'story'),
          eq(ustaadPosts.status, 'visible'),
          lte(ustaadPosts.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(ustaadPosts.expiresAt))
      .limit(opts.limit)
      .for('update', { skipLocked: true });
    let moved = 0;
    for (const story of due) {
      ustaadContentMachine.assert('visible', 'expired', 'system');
      const done = await tx
        .update(ustaadPosts)
        .set({ status: 'expired' })
        .where(
          and(
            eq(ustaadPosts.id, story.id),
            eq(ustaadPosts.status, 'visible'),
            eq(ustaadPosts.version, story.version),
          ),
        )
        .returning({ id: ustaadPosts.id, expiresAt: ustaadPosts.expiresAt });
      if (done.length === 0) continue;
      moved += 1;
      await tx
        .update(ustaadMedia)
        .set({
          purgeAfter: sql`(select ${ustaadPosts.expiresAt} from ${ustaadPosts} where ${ustaadPosts.id} = ${story.id})
            + make_interval(hours => ${grace})`,
        })
        .where(
          and(
            sql`${ustaadMedia.id} in (select ${ustaadPostMedia.mediaId} from ${ustaadPostMedia} where ${ustaadPostMedia.postId} = ${story.id})`,
            sql`${ustaadMedia.purgeAfter} is null`,
          ),
        );
      await recordUstaadEvent(tx, {
        entityType: 'post',
        entityId: story.id,
        kind: 'story_expired',
        fromStatus: 'visible',
        toStatus: 'expired',
        actorId: null,
        actorRole: 'system',
        cityId: story.cityId,
      });
    }
    return moved;
  });
}
