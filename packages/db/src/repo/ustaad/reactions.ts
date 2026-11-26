/**
 * Likes, saves, shares and poll votes (spec 23 § 4 flow 5, § 6.9, § 9.5; plan task D2). Each reaction is a row with
 * `ON CONFLICT DO NOTHING RETURNING`; only an inserted (or deleted) row moves the counter, in the same transaction,
 * by a conditional `± 1` (`> 0` guard on the way down), so a double tap or an unlike racing a like never drifts or goes
 * negative. Likes are visible (founder ruling, `feed.show_like_counts`) and never touch Izzat or levels. The author
 * gets one `ustaad.likes_digest` notice per post per IST day (the first like of the day; the count is the total at
 * that moment), never for their own like. Like / save / share / story view are client analytics events (spec 23
 * § 16); here they write `ustaad_events` rows only.
 */
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FeedPage } from '@mechdost/shared/ustaad/dto/feed';
import {
  ustaadMembers,
  ustaadPollOptions,
  ustaadPolls,
  ustaadPollVotes,
  ustaadPostCounters,
  ustaadPosts,
  ustaadReactions,
  ustaadSaves,
} from '../../schema';
import { decodeCursor, encodeCursor } from '../cursor';
import { ConflictError, NotFoundError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import {
  authorShown,
  feedMember,
  feedWriter,
  istDay,
  visibleUstaadPost,
  type UstaadActor,
} from './feed-common';
import { notifyUstaad } from './notify';
import { ustaadPostsByIds } from './posts';
import { readUstaadSettingValues } from './settings';

async function likesShown(tx: Tx, n: number): Promise<number | null> {
  const s = await readUstaadSettingValues(tx, ['ustaad.feed.show_like_counts']);
  return s['ustaad.feed.show_like_counts'] === true ? n : null;
}

async function likeCount(tx: Tx, postId: string): Promise<number> {
  const [c] = await tx
    .select({ likes: ustaadPostCounters.likes })
    .from(ustaadPostCounters)
    .where(eq(ustaadPostCounters.postId, postId))
    .limit(1);
  return c?.likes ?? 0;
}

export async function likeUstaadPost(
  db: Tx,
  actor: UstaadActor,
  postId: string,
): Promise<{ liked: true; likes: number | null }> {
  return db.transaction(async (tx) => {
    const me = await feedWriter(tx, actor.memberId);
    const post = await visibleUstaadPost(tx, me.id, postId, { live: true });
    const inserted = await tx
      .insert(ustaadReactions)
      .values({ postId: post.id, memberId: me.id, kind: 'like' })
      .onConflictDoNothing()
      .returning({ postId: ustaadReactions.postId });
    if (inserted.length === 0)
      return { liked: true, likes: await likesShown(tx, await likeCount(tx, post.id)) };
    const [c] = await tx
      .update(ustaadPostCounters)
      .set({ likes: sql`${ustaadPostCounters.likes} + 1` })
      .where(eq(ustaadPostCounters.postId, post.id))
      .returning({ likes: ustaadPostCounters.likes });
    const likes = c?.likes ?? 0;
    await recordUstaadEvent(tx, {
      entityType: 'post',
      entityId: post.id,
      kind: 'liked',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: post.cityId,
    });
    if (post.authorId !== me.id) {
      const [author] = await tx
        .select({ userId: ustaadMembers.userId })
        .from(ustaadMembers)
        .where(eq(ustaadMembers.id, post.authorId))
        .limit(1);
      if (author)
        await notifyUstaad(tx, 'ustaad.likes_digest', {
          userId: author.userId,
          entityId: post.id,
          version: `d${istDay()}`,
          params: { count: likes },
        });
    }
    return { liked: true, likes: await likesShown(tx, likes) };
  });
}

export async function unlikeUstaadPost(
  db: Tx,
  actor: UstaadActor,
  postId: string,
): Promise<{ liked: false; likes: number | null }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const post = await visibleUstaadPost(tx, me.id, postId);
    const deleted = await tx
      .delete(ustaadReactions)
      .where(
        and(
          eq(ustaadReactions.postId, post.id),
          eq(ustaadReactions.memberId, me.id),
          eq(ustaadReactions.kind, 'like'),
        ),
      )
      .returning({ postId: ustaadReactions.postId });
    if (deleted.length === 0)
      return { liked: false, likes: await likesShown(tx, await likeCount(tx, post.id)) };
    const [c] = await tx
      .update(ustaadPostCounters)
      .set({ likes: sql`${ustaadPostCounters.likes} - 1` })
      .where(and(eq(ustaadPostCounters.postId, post.id), sql`${ustaadPostCounters.likes} > 0`))
      .returning({ likes: ustaadPostCounters.likes });
    await recordUstaadEvent(tx, {
      entityType: 'post',
      entityId: post.id,
      kind: 'unliked',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: post.cityId,
    });
    return { liked: false, likes: await likesShown(tx, c?.likes ?? (await likeCount(tx, post.id))) };
  });
}

export async function saveUstaadPost(db: Tx, actor: UstaadActor, postId: string): Promise<{ saved: true }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const post = await visibleUstaadPost(tx, me.id, postId, { live: true });
    const inserted = await tx
      .insert(ustaadSaves)
      .values({ postId: post.id, memberId: me.id })
      .onConflictDoNothing()
      .returning({ postId: ustaadSaves.postId });
    if (inserted.length > 0) {
      await tx
        .update(ustaadPostCounters)
        .set({ saves: sql`${ustaadPostCounters.saves} + 1` })
        .where(eq(ustaadPostCounters.postId, post.id));
      await recordUstaadEvent(tx, {
        entityType: 'post',
        entityId: post.id,
        kind: 'saved',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: post.cityId,
      });
    }
    return { saved: true };
  });
}

/** Unsave works on any post the member saved (even one that is no longer visible), so the Saved list can be cleaned. */
export async function unsaveUstaadPost(
  db: Tx,
  actor: UstaadActor,
  postId: string,
): Promise<{ saved: false }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const deleted = await tx
      .delete(ustaadSaves)
      .where(and(eq(ustaadSaves.postId, postId), eq(ustaadSaves.memberId, me.id)))
      .returning({ postId: ustaadSaves.postId });
    if (deleted.length > 0) {
      await tx
        .update(ustaadPostCounters)
        .set({ saves: sql`${ustaadPostCounters.saves} - 1` })
        .where(and(eq(ustaadPostCounters.postId, postId), sql`${ustaadPostCounters.saves} > 0`));
      await recordUstaadEvent(tx, {
        entityType: 'post',
        entityId: postId,
        kind: 'unsaved',
        actorId: actor.userId,
        actorRole: 'member',
      });
    }
    return { saved: false };
  });
}

/** My saved posts, newest save first (keyset on the save time). Posts I may no longer see are left out. */
export async function listUstaadSaved(
  db: Tx,
  actor: UstaadActor,
  page: { cursor?: string | undefined; limit: number },
): Promise<FeedPage> {
  const me = await feedMember(db, actor.memberId);
  const cur = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const rows = await db
    .select({ id: ustaadSaves.postId, k: sql<string>`${ustaadSaves.createdAt}::text` })
    .from(ustaadSaves)
    .where(
      and(
        eq(ustaadSaves.memberId, me.id),
        cur
          ? or(
              lt(ustaadSaves.createdAt, sql`${cur.k}::timestamptz`),
              and(eq(ustaadSaves.createdAt, sql`${cur.k}::timestamptz`), lt(ustaadSaves.postId, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ustaadSaves.createdAt), desc(ustaadSaves.postId))
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

/** A share (WhatsApp teaser link, copy link, send to a mechanic): counts it; the API signs the teaser token. */
export async function shareUstaadPost(
  db: Tx,
  actor: UstaadActor,
  postId: string,
  channel: 'whatsapp' | 'copy_link' | 'member',
): Promise<{ postId: string }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const post = await visibleUstaadPost(tx, me.id, postId, { live: true });
    await tx
      .update(ustaadPostCounters)
      .set({ shares: sql`${ustaadPostCounters.shares} + 1` })
      .where(eq(ustaadPostCounters.postId, post.id));
    await recordUstaadEvent(tx, {
      entityType: 'post',
      entityId: post.id,
      kind: 'shared',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: post.cityId,
      props: { channel },
    });
    return { postId: post.id };
  });
}

/**
 * The public teaser (SR-44): true while the post is live (visible, not a story, author shown). The teaser page shows
 * a generic card only; a removed post makes it 404 at once (AT-TAKEDOWN-1).
 */
export async function ustaadTeaserVisible(db: Tx, postId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ustaadPosts.id })
    .from(ustaadPosts)
    .where(
      and(
        eq(ustaadPosts.id, postId),
        eq(ustaadPosts.status, 'visible'),
        sql`${ustaadPosts.kind} <> 'story'`,
        authorShown(ustaadPosts.authorId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** One vote per member per poll (`USTAAD_ALREADY_VOTED` for a different option; the same option is a no-op). */
export async function voteUstaadPoll(
  db: Tx,
  actor: UstaadActor,
  pollId: string,
  optionId: string,
): Promise<{ optionId: string }> {
  return db.transaction(async (tx) => {
    const me = await feedWriter(tx, actor.memberId);
    const [poll] = await tx
      .select({
        id: ustaadPolls.id,
        postId: ustaadPolls.postId,
        open: sql<boolean>`${ustaadPolls.closesAt} > now()`,
      })
      .from(ustaadPolls)
      .where(eq(ustaadPolls.id, pollId))
      .limit(1);
    if (!poll) throw new NotFoundError('Poll not found');
    const post = await visibleUstaadPost(tx, me.id, poll.postId, { live: true });
    const [option] = await tx
      .select({ id: ustaadPollOptions.id })
      .from(ustaadPollOptions)
      .where(and(eq(ustaadPollOptions.id, optionId), eq(ustaadPollOptions.pollId, poll.id)))
      .limit(1);
    if (!option) throw new NotFoundError('Option not found');
    if (!(poll.open === true || (poll.open as unknown) === 't'))
      throw new ConflictError('This poll is closed', 'USTAAD_POLL_CLOSED');
    const inserted = await tx
      .insert(ustaadPollVotes)
      .values({ pollId: poll.id, optionId: option.id, memberId: me.id })
      .onConflictDoNothing()
      .returning({ optionId: ustaadPollVotes.optionId });
    if (inserted.length === 0) {
      const [mine] = await tx
        .select({ optionId: ustaadPollVotes.optionId })
        .from(ustaadPollVotes)
        .where(and(eq(ustaadPollVotes.pollId, poll.id), eq(ustaadPollVotes.memberId, me.id)))
        .limit(1);
      if (mine?.optionId !== option.id) throw new ConflictError('You already voted', 'USTAAD_ALREADY_VOTED');
      return { optionId: option.id };
    }
    await tx
      .update(ustaadPollOptions)
      .set({ votes: sql`${ustaadPollOptions.votes} + 1` })
      .where(eq(ustaadPollOptions.id, option.id));
    await recordUstaadEvent(tx, {
      entityType: 'post',
      entityId: post.id,
      kind: 'poll_voted',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: post.cityId,
      props: { pollId: poll.id, optionId: option.id },
    });
    return { optionId: option.id };
  });
}
