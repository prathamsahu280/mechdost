/**
 * Another member's profile and posts (spec 23 § 5 `/ustaad/u/[handle]`; workstream D web, 2026-11-26). Composes the
 * D2 building blocks: `ustaadVisibleMember` (404 when left, banned or blocked either way, SR-35), `ustaadMemberCard`
 * (no phone, garage or location, SR-34), `ustaadRelationship`, and the feed's visibility rule `postVisibleTo` for the
 * posts list (keyset on `(created_at, id)`, hydrated by `ustaadPostsByIds`). A restricted member's profile is hidden
 * like their content (`authorShown`). Mutes hide authors in feeds only, so a muted member's own profile still lists
 * their posts. Reads only; nothing is written.
 */
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FeedPage } from '@mechdost/shared/ustaad/dto/feed';
import type { ProfileView } from '@mechdost/shared/ustaad/dto/social';
import type { UstaadSpecialityCode } from '@mechdost/shared/ustaad/codes';
import { ustaadMemberCounters, ustaadMembers, ustaadMemberSpecialities, ustaadPosts } from '../../schema';
import { decodeCursor, encodeCursor } from '../cursor';
import { NotFoundError } from '../errors';
import type { Tx } from '../orders';
import { postVisibleTo, type UstaadActor } from './feed-common';
import { ustaadRelationship } from './follows';
import { ustaadActingMember, ustaadMemberCard, ustaadVisibleMember } from './graph-common';
import { ustaadPostsByIds } from './posts';
import { readUstaadSettingValues } from './settings';

/** The member behind `handle` as the caller may see them, or 404 (never 403: no oracle). */
async function visibleByHandle(tx: Tx, viewerId: string, handle: string) {
  const [row] = await tx
    .select({ id: ustaadMembers.id })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.handle, handle.toLowerCase()))
    .limit(1);
  if (!row) throw new NotFoundError('Member not found');
  if (row.id === viewerId) return ustaadActingMember(tx, viewerId);
  const m = await ustaadVisibleMember(tx, viewerId, row.id);
  if (m.status !== 'active' || m.restrictedMode !== 'none') throw new NotFoundError('Member not found');
  return m;
}

export async function ustaadProfileByHandle(
  db: Tx,
  actor: UstaadActor,
  handle: string,
): Promise<ProfileView> {
  const me = await ustaadActingMember(db, actor.memberId);
  const m = await visibleByHandle(db, me.id, handle);
  const mine = m.id === me.id;
  const [counters] = await db
    .select()
    .from(ustaadMemberCounters)
    .where(eq(ustaadMemberCounters.memberId, m.id))
    .limit(1);
  const specs = await db
    .select({ code: ustaadMemberSpecialities.code })
    .from(ustaadMemberSpecialities)
    .where(eq(ustaadMemberSpecialities.memberId, m.id));
  const s = await readUstaadSettingValues(db, ['ustaad.feed.show_follower_counts']);
  const showCounts = s['ustaad.feed.show_follower_counts'] === true;
  return {
    member: ustaadMemberCard(m),
    mine,
    specialities: specs.map((x) => x.code as UstaadSpecialityCode),
    followers: showCounts ? (counters?.followers ?? 0) : null,
    following: showCounts ? (counters?.following ?? 0) : null,
    posts: counters?.posts ?? 0,
    helpfulAnswers: counters?.helpfulAnswers ?? 0,
    bestAnswers: counters?.bestAnswers ?? 0,
    relationship: mine ? null : await ustaadRelationship(db, actor, m.id),
  };
}

/** One member's posts (no stories), newest first, as the caller may see them; 404 when the member is hidden. */
export async function listUstaadMemberPosts(
  db: Tx,
  actor: UstaadActor,
  memberId: string,
  page: { cursor?: string | undefined; limit: number },
): Promise<FeedPage> {
  const me = await ustaadActingMember(db, actor.memberId);
  if (memberId !== me.id) {
    const m = await ustaadVisibleMember(db, me.id, memberId);
    if (m.status !== 'active' || m.restrictedMode !== 'none') throw new NotFoundError('Member not found');
  }
  const p = ustaadPosts;
  const cur = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const rows = await db
    .select({ id: p.id, k: sql<string>`${p.createdAt}::text` })
    .from(p)
    .where(
      and(
        eq(p.authorId, memberId),
        sql`${p.kind} <> 'story'`,
        postVisibleTo(me.id),
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
