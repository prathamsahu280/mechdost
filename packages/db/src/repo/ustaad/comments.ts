/**
 * Comments on posts (spec 23 § 4 flow 5 "Reply", § 6.3, § 7.4; plan task D2): text, a voice note or a photo (the
 * commenter's own verified, unused media), one level of replies (a reply to a reply is `USTAAD_REPLY_DEPTH`),
 * idempotent on `idemKey`, screened like posts. Stories take no comments (a story reply goes to messages). A visible
 * comment moves the post's counter by a conditional `+ 1`; the author hiding it moves it back (`> 0` guard). The post
 * author and the parent comment's author get `ustaad.reply`, grouped per post per IST day, never for their own
 * comment. Lists hide blocked and hidden authors (SR-35) and never select a phone number.
 */
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { ustaadContentMachine } from '@mechdost/shared/state';
import type { CommentInput, CommentView } from '@mechdost/shared/ustaad/dto/feed';
import { ustaadComments, ustaadMedia, ustaadMembers, ustaadPostCounters } from '../../schema';
import { decodeCursor, encodeCursor } from '../cursor';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import {
  authorShown,
  feedMember,
  feedWriter,
  istDay,
  notBlockedWith,
  ownUnusedMedia,
  visibleUstaadPost,
  type UstaadActor,
} from './feed-common';
import { screenUstaadContent } from './moderation';
import { notifyUstaad } from './notify';
import { authorColumns } from './posts';
import { readUstaadSettingValues } from './settings';

const inputOf = (_c: CommentInput, mediaKind: string | null): 'voice' | 'photo' | 'text' =>
  mediaKind === 'audio' ? 'voice' : mediaKind === 'image' ? 'photo' : 'text';

export async function commentOnUstaadPost(
  db: Tx,
  actor: UstaadActor,
  postId: string,
  input: CommentInput,
): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const me = await feedWriter(tx, actor.memberId);
    const post = await visibleUstaadPost(tx, me.id, postId, { live: true });
    const [existing] = await tx
      .select({ id: ustaadComments.id, status: ustaadComments.status })
      .from(ustaadComments)
      .where(and(eq(ustaadComments.authorId, me.id), eq(ustaadComments.idemKey, input.idemKey)))
      .limit(1);
    if (existing) return existing;
    let parentAuthor: string | null = null;
    if (input.parentId) {
      const [parent] = await tx
        .select({
          id: ustaadComments.id,
          parentId: ustaadComments.parentId,
          authorId: ustaadComments.authorId,
        })
        .from(ustaadComments)
        .where(
          and(
            eq(ustaadComments.id, input.parentId),
            eq(ustaadComments.postId, post.id),
            eq(ustaadComments.status, 'visible'),
            notBlockedWith(me.id, sql`${ustaadComments.authorId}`),
          ),
        )
        .limit(1);
      if (!parent) throw new NotFoundError('Comment not found');
      if (parent.parentId !== null)
        throw new ValidationError('Reply to the first comment', 'USTAAD_REPLY_DEPTH');
      parentAuthor = parent.authorId;
    }
    let mediaKind: string | null = null;
    if (input.mediaId) {
      const [m] = await ownUnusedMedia(tx, me.id, [input.mediaId]);
      const s = await readUstaadSettingValues(tx, ['ustaad.media.voice_max_s']);
      const ok =
        m !== undefined &&
        (m.kind === 'image' ||
          (m.kind === 'audio' && (m.durationMs ?? 0) <= Number(s['ustaad.media.voice_max_s']) * 1000));
      if (!ok) throw new ValidationError('That file cannot be used', 'USTAAD_MEDIA_INVALID');
      mediaKind = m.kind;
    }
    // The pre-correction words are shown as "see original", so they are screened too.
    const bodyOriginal = input.correction === 'none' ? null : (input.bodyOriginal ?? null);
    const screen = await screenUstaadContent(tx, {
      kind: 'comment',
      text: [input.body, bodyOriginal].filter(Boolean).join('\n') || null,
      mediaIds: input.mediaId ? [input.mediaId] : [],
      authorId: me.id,
    });
    if (screen === 'block')
      throw new ValidationError('This reply cannot be shared', 'USTAAD_CONTENT_BLOCKED');
    const status = screen === 'ok' ? 'visible' : 'held';
    const [row] = await tx
      .insert(ustaadComments)
      .values({
        postId: post.id,
        authorId: me.id,
        parentId: input.parentId ?? null,
        body: input.body ?? null,
        bodyOriginal,
        correction: input.correction,
        mediaId: input.mediaId ?? null,
        status,
        idemKey: input.idemKey,
      })
      .returning({ id: ustaadComments.id, status: ustaadComments.status });
    if (!row) throw new ConflictError('Could not save the reply');
    if (status === 'visible')
      await tx
        .update(ustaadPostCounters)
        .set({ comments: sql`${ustaadPostCounters.comments} + 1` })
        .where(eq(ustaadPostCounters.postId, post.id));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'comment',
        entityId: row.id,
        kind: 'created',
        toStatus: status,
        actorId: actor.userId,
        actorRole: 'member',
        cityId: post.cityId,
        props: { postId: post.id, reply: input.parentId !== undefined, input: inputOf(input, mediaKind) },
      },
      {
        name: 'ustaad_comment_posted',
        memberId: me.id,
        userId: actor.userId,
        props: {
          commentId: row.id,
          postId: post.id,
          input: inputOf(input, mediaKind),
          reply: input.parentId !== undefined,
        },
      },
    );
    if (status === 'visible') {
      const targets = [
        ...new Set([post.authorId, parentAuthor].filter((x): x is string => x !== null)),
      ].filter((id) => id !== me.id);
      const users = targets.length
        ? await tx
            .select({ userId: ustaadMembers.userId })
            .from(ustaadMembers)
            .where(and(inArray(ustaadMembers.id, targets), eq(ustaadMembers.status, 'active')))
        : [];
      for (const u of users)
        await notifyUstaad(tx, 'ustaad.reply', {
          userId: u.userId,
          entityId: post.id,
          version: `d${istDay()}`,
          params: { memberName: me.displayName },
          linkParams: { postId: post.id },
        });
    }
    return row;
  });
}

/** Comments of a post the viewer may see, oldest first (replies carry `parentId`), keyset on `created_at, id`. */
export async function listUstaadComments(
  db: Tx,
  actor: UstaadActor,
  postId: string,
  page: { cursor?: string | undefined; limit: number },
): Promise<{ items: CommentView[]; nextCursor: string | null }> {
  const me = await feedMember(db, actor.memberId);
  const post = await visibleUstaadPost(db, me.id, postId, { live: true });
  const cur = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const c = ustaadComments;
  const rows = await db
    .select({
      comment: c,
      k: sql<string>`${c.createdAt}::text`,
      author: authorColumns,
      media: {
        kind: ustaadMedia.kind,
        durationMs: ustaadMedia.durationMs,
        width: ustaadMedia.width,
        height: ustaadMedia.height,
        bytes: ustaadMedia.declaredBytes,
        lqip: ustaadMedia.lqip,
      },
    })
    .from(c)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, c.authorId))
    .leftJoin(ustaadMedia, and(eq(ustaadMedia.id, c.mediaId), eq(ustaadMedia.status, 'verified')))
    .where(
      and(
        eq(c.postId, post.id),
        or(
          and(
            eq(c.status, 'visible'),
            authorShown(sql`${c.authorId}`),
            notBlockedWith(me.id, sql`${c.authorId}`),
          ),
          and(eq(c.authorId, me.id), eq(c.status, 'held')),
        ),
        cur
          ? or(
              gt(c.createdAt, sql`${cur.k}::timestamptz`),
              and(eq(c.createdAt, sql`${cur.k}::timestamptz`), gt(c.id, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(c.createdAt), asc(c.id))
    .limit(page.limit + 1);
  const slice = rows.slice(0, page.limit);
  const last = slice.at(-1);
  return {
    items: slice.map(({ comment: x, author, media }) => ({
      id: x.id,
      postId: post.id,
      parentId: x.parentId,
      body: x.body,
      bodyOriginal: x.bodyOriginal,
      correction: x.correction,
      media: x.mediaId && media ? { mediaId: x.mediaId, role: null, position: 0, ...media } : null,
      author,
      mine: x.authorId === me.id,
      status: x.status,
      createdAt: x.createdAt.toISOString(),
    })),
    nextCursor: rows.length > page.limit && last ? encodeCursor({ k: last.k, id: last.comment.id }) : null,
  };
}

/** The author hides their own comment (`visible|held → hidden_author`); anyone else gets 404. */
export async function deleteUstaadComment(
  db: Tx,
  actor: UstaadActor,
  commentId: string,
): Promise<{ status: 'hidden_author' }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const [x] = await tx
      .select()
      .from(ustaadComments)
      .where(
        and(
          eq(ustaadComments.id, commentId),
          eq(ustaadComments.authorId, me.id),
          inArray(ustaadComments.status, ['visible', 'held']),
        ),
      )
      .limit(1);
    if (!x) throw new NotFoundError('Comment not found');
    ustaadContentMachine.assert(x.status as 'visible' | 'held', 'hidden_author', 'member');
    const done = await tx
      .update(ustaadComments)
      .set({ status: 'hidden_author' })
      .where(
        and(
          eq(ustaadComments.id, x.id),
          eq(ustaadComments.status, x.status),
          eq(ustaadComments.version, x.version),
        ),
      )
      .returning({ id: ustaadComments.id });
    if (done.length === 0) throw new ConflictError('The reply changed, try again');
    if (x.status === 'visible' && x.postId)
      await tx
        .update(ustaadPostCounters)
        .set({ comments: sql`${ustaadPostCounters.comments} - 1` })
        .where(and(eq(ustaadPostCounters.postId, x.postId), sql`${ustaadPostCounters.comments} > 0`));
    await recordUstaadEvent(tx, {
      entityType: 'comment',
      entityId: x.id,
      kind: 'hidden_by_author',
      fromStatus: x.status,
      toStatus: 'hidden_author',
      actorId: actor.userId,
      actorRole: 'member',
    });
    return { status: 'hidden_author' };
  });
}
