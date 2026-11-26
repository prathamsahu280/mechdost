/**
 * Helpers shared by the feed repositories (posts, stories, comments, reactions, tags; spec 23 § 6.3, § 7.4, SR-35).
 * One visibility rule for every by-id read and write: a post is visible to a viewer when it is the viewer's own
 * (`visible` or `held`), or it is `visible`, its author is an active member with no restricted mode, and nobody is
 * blocked between the two; a story is visible only until `expires_at` on the database clock. Mutes hide authors from
 * lists only (`notMuted`). No phone number is ever selected here (SR-34).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  ustaadAnswers,
  ustaadComments,
  ustaadMedia,
  ustaadMembers,
  ustaadMessages,
  ustaadPostMedia,
  ustaadPosts,
  ustaadQuestions,
} from '../../schema';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { assertUstaadMemberCanWrite, type UstaadActor } from './qa';

export type { UstaadActor };
export type UstaadMemberRow = typeof ustaadMembers.$inferSelect;
export type UstaadPostRow = typeof ustaadPosts.$inferSelect;

/** The caller's member row (404 when they left or are banned). `lock` takes the row lock for daily caps. */
export async function feedMember(tx: Tx, memberId: string, lock = false): Promise<UstaadMemberRow> {
  const q = tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, memberId)).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row || row.status === 'left' || row.status === 'banned') throw new NotFoundError('Member not found');
  return row;
}

/** A member who may write (active, no restricted mode), else 403 `USTAAD_RESTRICTED` (C's guard). */
export async function feedWriter(tx: Tx, memberId: string, lock = false): Promise<UstaadMemberRow> {
  const me = await feedMember(tx, memberId, lock);
  assertUstaadMemberCanWrite(me);
  return me;
}

/** Nobody blocked between `viewer` and `author` (SQL, either direction). */
export const notBlockedWith = (viewer: string, author: SQL | typeof ustaadPosts.authorId) =>
  sql`not exists (select 1 from ustaad_blocks bl where (bl.member_id = ${author} and bl.target_id = ${viewer})
      or (bl.member_id = ${viewer} and bl.target_id = ${author}))`;

/** The author is an active member with no restricted mode (their content shows to others). */
export const authorShown = (author: SQL | typeof ustaadPosts.authorId) =>
  sql`exists (select 1 from ustaad_members au where au.id = ${author} and au.status = 'active'
      and au.restricted_mode = 'none')`;

/** The viewer has not muted the post's author (lists only). */
export const notMuted = (viewer: string) =>
  sql`not exists (select 1 from ustaad_mutes mu where mu.member_id = ${viewer} and mu.target_id = ${ustaadPosts.authorId})`;

/** The visibility rule on `ustaad_posts` for one viewer (see the file comment). */
export function postVisibleTo(viewer: string): SQL {
  const p = ustaadPosts;
  return sql`((${p.kind} <> 'story' or ${p.expiresAt} > now()) and (
      (${p.authorId} = ${viewer} and ${p.status} in ('visible', 'held'))
      or (${p.status} = 'visible' and ${authorShown(p.authorId)} and ${notBlockedWith(viewer, p.authorId)})))`;
}

/** A post the viewer may see, or 404 (never 403: no oracle). `live` = visible (not held) and not a story. */
export async function visibleUstaadPost(
  tx: Tx,
  viewer: string,
  postId: string,
  opts: { live?: boolean } = {},
): Promise<UstaadPostRow> {
  const [row] = await tx
    .select()
    .from(ustaadPosts)
    .where(and(eq(ustaadPosts.id, postId), postVisibleTo(viewer)))
    .limit(1);
  if (!row) throw new NotFoundError('Post not found');
  if (opts.live && (row.status !== 'visible' || row.kind === 'story'))
    throw new NotFoundError('Post not found');
  return row;
}

export interface FeedMediaRow {
  id: string;
  kind: string;
  bucket: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  declaredBytes: number;
  lqip: string | null;
}

/**
 * Media a member attaches: their own, verified, in a live bucket (`media`, or `docs` for PDFs), and not attached to
 * anything yet (one object, one place: a story purge must never delete a post's file). Else 422
 * `USTAAD_MEDIA_INVALID` (no detail: the same answer for foreign, missing and pending ids).
 */
export async function ownUnusedMedia(
  tx: Tx,
  memberId: string,
  ids: readonly string[],
): Promise<FeedMediaRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      id: ustaadMedia.id,
      owner: ustaadMedia.ownerMemberId,
      status: ustaadMedia.status,
      kind: ustaadMedia.kind,
      bucket: ustaadMedia.bucket,
      durationMs: ustaadMedia.durationMs,
      width: ustaadMedia.width,
      height: ustaadMedia.height,
      declaredBytes: ustaadMedia.declaredBytes,
      lqip: ustaadMedia.lqip,
    })
    .from(ustaadMedia)
    .where(inArray(ustaadMedia.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: FeedMediaRow[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    const bucketOk = r?.kind === 'document' ? r.bucket === 'docs' : r?.bucket === 'media';
    if (!r || r.owner !== memberId || r.status !== 'verified' || !bucketOk)
      throw new ValidationError('That file cannot be used', 'USTAAD_MEDIA_INVALID');
    out.push({
      id: r.id,
      kind: r.kind,
      bucket: r.bucket,
      durationMs: r.durationMs,
      width: r.width,
      height: r.height,
      declaredBytes: r.declaredBytes,
      lqip: r.lqip,
    });
  }
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const res = await tx.execute(sql`select (
      exists (select 1 from ${ustaadPostMedia} where ${ustaadPostMedia.mediaId} in (${list}))
      or exists (select 1 from ${ustaadComments} where ${ustaadComments.mediaId} in (${list}))
      or exists (select 1 from ${ustaadQuestions} where ${ustaadQuestions.voiceMediaId} in (${list}))
      or exists (select 1 from ${ustaadAnswers} where ${ustaadAnswers.voiceMediaId} in (${list}))
      or exists (select 1 from ${ustaadMessages} where ${ustaadMessages.mediaId} in (${list}))
    ) as used`);
  const used = rowsOf<{ used: unknown }>(res)[0];
  if (used?.used === true || used?.used === 't')
    throw new ValidationError('That file cannot be used', 'USTAAD_MEDIA_INVALID');
  return out;
}

/** Today's date in India (`YYYY-MM-DD`), for daily notice grouping. */
export function istDay(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Days since the member joined the network (the account age for stories and links). */
export function memberAgeDays(me: Pick<UstaadMemberRow, 'joinedAt'>, now = new Date()): number {
  return (now.getTime() - me.joinedAt.getTime()) / 86_400_000;
}

export function forbidden(code: string, message: string): never {
  throw new ForbiddenError(message, code);
}
