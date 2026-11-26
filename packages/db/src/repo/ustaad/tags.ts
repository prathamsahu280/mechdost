/**
 * Hashtags (spec 23 § 4 flow 5, § 6.3, § 15 "hashtags", SR-25). Curated only: a tag typed by a member resolves to an
 * admin row by slug, Hindi name or alias (NFC, lower case: "battri" → #battery); a merged tag resolves to its target;
 * inactive tags and unknown text are refused (`USTAAD_TAG_UNKNOWN`), and a post carries at most `tags.max_per_post`
 * distinct tags (`USTAAD_TAG_LIMIT`). Tags are optional on a post (no seed migration exists, and the composer
 * suggests one from the vehicle; decisions 2026-11-26 "workstream D1"). A tag page lists live posts newest first.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { TAG_GROUPS } from '@mechdost/shared/ustaad/codes';
import { normaliseTagInput, type TagListItem } from '@mechdost/shared/ustaad/dto/feed';
import {
  ustaadPostTags,
  ustaadPosts,
  ustaadTagFollows,
  ustaadTags,
  ustaadTagSuggestions,
} from '../../schema';
import { decodeCursor, encodeCursor } from '../cursor';
import { NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { feedMember, feedWriter, notMuted, postVisibleTo, type UstaadActor } from './feed-common';
import { ustaadPostsByIds } from './posts';

const norm = (v: string) => v.normalize('NFC').toLowerCase();

/** The tag ids for a post (distinct, ≤ `max`). Throws `USTAAD_TAG_UNKNOWN` / `USTAAD_TAG_LIMIT`. */
export async function resolveUstaadTagIds(tx: Tx, inputs: readonly string[], max: number): Promise<string[]> {
  if (inputs.length === 0) return [];
  const wanted = inputs.map((raw) => {
    const t = normaliseTagInput(raw);
    if (t === null) throw new ValidationError('Unknown tag', 'USTAAD_TAG_UNKNOWN', { tag: raw });
    return t;
  });
  const arr = sql`ARRAY[${sql.join(
    wanted.map((w) => sql`${w}`),
    sql`, `,
  )}]::text[]`;
  const rows = await tx
    .select({
      id: ustaadTags.id,
      slug: ustaadTags.slug,
      nameHi: ustaadTags.nameHi,
      aliases: ustaadTags.aliases,
      active: ustaadTags.active,
      mergedIntoId: ustaadTags.mergedIntoId,
    })
    .from(ustaadTags)
    .where(
      or(
        inArray(ustaadTags.slug, wanted),
        sql`${ustaadTags.aliases} && ${arr}`,
        sql`lower(${ustaadTags.nameHi}) = any(${arr})`,
      ),
    );
  const targetIds = rows.map((r) => r.mergedIntoId).filter((x): x is string => x !== null);
  const targets = targetIds.length
    ? await tx
        .select({ id: ustaadTags.id, active: ustaadTags.active, mergedIntoId: ustaadTags.mergedIntoId })
        .from(ustaadTags)
        .where(inArray(ustaadTags.id, targetIds))
    : [];
  const liveTarget = new Map(targets.filter((x) => x.active && !x.mergedIntoId).map((x) => [x.id, x.id]));
  const ids = new Set<string>();
  for (const w of wanted) {
    const hit = rows.find(
      (r) => r.slug === w || r.aliases.some((a) => norm(a) === w) || norm(r.nameHi) === w,
    );
    const id = hit?.mergedIntoId ? liveTarget.get(hit.mergedIntoId) : hit?.active ? hit.id : undefined;
    if (!id) throw new ValidationError('Unknown tag', 'USTAAD_TAG_UNKNOWN', { tag: w });
    ids.add(id);
  }
  if (ids.size > max) throw new ValidationError('Too many tags', 'USTAAD_TAG_LIMIT', { max });
  return [...ids];
}

/** Active, unmerged tags (search by slug prefix, name or alias), with "followed" for the viewer. */
export async function searchUstaadTags(
  db: Tx,
  actor: UstaadActor,
  query: { q?: string | undefined; group?: (typeof TAG_GROUPS)[number] | undefined },
): Promise<TagListItem[]> {
  await feedMember(db, actor.memberId);
  const q = query.q ? normaliseTagInput(query.q) : null;
  if (query.q && q === null) return [];
  const rows = await db
    .select({
      slug: ustaadTags.slug,
      nameEn: ustaadTags.nameEn,
      nameHi: ustaadTags.nameHi,
      group: ustaadTags.group,
      followed: sql<boolean>`exists (select 1 from ${ustaadTagFollows} tf
          where tf.tag_id = ${ustaadTags.id} and tf.member_id = ${actor.memberId})`,
    })
    .from(ustaadTags)
    .where(
      and(
        eq(ustaadTags.active, true),
        isNull(ustaadTags.mergedIntoId),
        query.group ? eq(ustaadTags.group, query.group) : undefined,
        q
          ? or(
              sql`${ustaadTags.slug} like ${`${q.replace(/_/g, '\\_')}%`}`,
              ilike(ustaadTags.nameEn, `%${q.replace(/_/g, '\\_')}%`),
              sql`lower(${ustaadTags.nameHi}) like ${`%${q}%`}`,
              sql`${q} = any(${ustaadTags.aliases})`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(ustaadTags.slug))
    .limit(100);
  return rows.map((r) => ({ ...r, followed: r.followed === true || (r.followed as unknown) === 't' }));
}

async function liveTag(tx: Tx, slug: string) {
  const [tag] = await tx
    .select()
    .from(ustaadTags)
    .where(and(eq(ustaadTags.slug, slug), eq(ustaadTags.active, true), isNull(ustaadTags.mergedIntoId)))
    .limit(1);
  if (!tag) throw new NotFoundError('Tag not found');
  return tag;
}

/** A tag with its live posts, newest first (keyset on `created_at, id`). */
export async function ustaadTagPage(
  db: Tx,
  actor: UstaadActor,
  slug: string,
  page: { cursor?: string | undefined; limit: number },
) {
  const me = await feedMember(db, actor.memberId);
  const tag = await liveTag(db, slug);
  const cur = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const rows = await db
    .select({ id: ustaadPosts.id, k: sql<string>`${ustaadPosts.createdAt}::text` })
    .from(ustaadPostTags)
    .innerJoin(ustaadPosts, eq(ustaadPosts.id, ustaadPostTags.postId))
    .where(
      and(
        eq(ustaadPostTags.tagId, tag.id),
        eq(ustaadPosts.status, 'visible'),
        sql`${ustaadPosts.kind} <> 'story'`,
        postVisibleTo(me.id),
        notMuted(me.id),
        cur
          ? or(
              lt(ustaadPosts.createdAt, sql`${cur.k}::timestamptz`),
              and(eq(ustaadPosts.createdAt, sql`${cur.k}::timestamptz`), lt(ustaadPosts.id, cur.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ustaadPosts.createdAt), desc(ustaadPosts.id))
    .limit(page.limit + 1);
  const more = rows.length > page.limit;
  const slice = rows.slice(0, page.limit);
  const last = slice.at(-1);
  const [followed] = await db
    .select({ x: sql`1` })
    .from(ustaadTagFollows)
    .where(and(eq(ustaadTagFollows.memberId, me.id), eq(ustaadTagFollows.tagId, tag.id)))
    .limit(1);
  return {
    tag: {
      slug: tag.slug,
      nameEn: tag.nameEn,
      nameHi: tag.nameHi,
      group: tag.group,
      followed: Boolean(followed),
    },
    items: await ustaadPostsByIds(
      db,
      actor,
      slice.map((r) => r.id),
    ),
    nextCursor: more && last ? encodeCursor({ k: last.k, id: last.id }) : null,
  };
}

export async function followUstaadTag(db: Tx, actor: UstaadActor, slug: string): Promise<{ followed: true }> {
  await feedWriter(db, actor.memberId);
  const tag = await liveTag(db, slug);
  await db.insert(ustaadTagFollows).values({ memberId: actor.memberId, tagId: tag.id }).onConflictDoNothing();
  return { followed: true };
}

export async function unfollowUstaadTag(
  db: Tx,
  actor: UstaadActor,
  slug: string,
): Promise<{ followed: false }> {
  await feedMember(db, actor.memberId);
  const [tag] = await db
    .select({ id: ustaadTags.id })
    .from(ustaadTags)
    .where(eq(ustaadTags.slug, slug))
    .limit(1);
  if (!tag) throw new NotFoundError('Tag not found');
  await db
    .delete(ustaadTagFollows)
    .where(and(eq(ustaadTagFollows.memberId, actor.memberId), eq(ustaadTagFollows.tagId, tag.id)));
  return { followed: false };
}

/** "Suggest a tag": a row for the admin's tag list (never a live tag by itself). */
export async function suggestUstaadTag(db: Tx, actor: UstaadActor, text: string): Promise<{ id: string }> {
  await feedWriter(db, actor.memberId);
  const [row] = await db
    .insert(ustaadTagSuggestions)
    .values({ memberId: actor.memberId, text: text.normalize('NFC') })
    .returning({ id: ustaadTagSuggestions.id });
  if (!row) throw new ValidationError('Could not save the suggestion');
  return row;
}
