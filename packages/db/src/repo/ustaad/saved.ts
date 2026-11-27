/**
 * Saved beyond posts, and the member's own collections (spec 23 § 5 Saved; design
 * docs/superpowers/specs/2026-11-28-mechanic-network-saved-design.md).
 *
 * - Posts keep `ustaad_saves` and `saveUstaadPost` (counters, ranking); questions, answers, jobs and lessons are rows in
 *   `ustaad_saved_items` (`ON CONFLICT DO NOTHING`, an event only when a row was inserted).
 * - Saving checks the item is visible to the member now (the kind's own rule; 404 otherwise). The list re-checks on
 *   every read (status, reach/city, blocks either way), so a removed or hidden item simply drops out.
 * - Collections belong to one member: any other id is a 404. Names are unique per member ignoring case; at most
 *   `USTAAD_SAVE_COLLECTIONS_MAX` (serialised per member by an advisory lock); rename is compare-and-set on `version`.
 * - An unsave removes the item from the member's collections in the same transaction.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  USTAAD_SAVE_COLLECTIONS_MAX,
  USTAAD_SAVE_KINDS,
  USTAAD_SAVED_TEXT_MAX,
  type UstaadSaveKind,
} from '@mechdost/shared/ustaad/saved';
import type {
  SaveCollection,
  SavedItem,
  SavedPage,
  SavedSummary,
  SaveTarget,
} from '@mechdost/shared/ustaad/dto/saved';
import {
  ustaadLearningResources,
  ustaadSaveCollectionItems,
  ustaadSaveCollections,
  ustaadSavedItems,
  ustaadSaves,
} from '../../schema';
import { decodeCursor, encodeCursor } from '../cursor';
import { ConflictError, mapPgError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { recordUstaadEvent } from './events';
import { feedMember } from './feed-common';
import { assertUstaadJobVisible } from './jobs';
import { assertUstaadQaVisible, type UstaadActor } from './qa';
import { saveUstaadPost, unsaveUstaadPost } from './reactions';

async function assertVisible(tx: Tx, me: string, target: SaveTarget): Promise<void> {
  switch (target.kind) {
    case 'question':
    case 'answer':
      await assertUstaadQaVisible(tx, me, target.kind, target.id);
      return;
    case 'job':
      await assertUstaadJobVisible(tx, me, target.id);
      return;
    case 'lesson': {
      const [l] = await tx
        .select({ id: ustaadLearningResources.id })
        .from(ustaadLearningResources)
        .where(and(eq(ustaadLearningResources.id, target.id), eq(ustaadLearningResources.active, true)))
        .limit(1);
      if (!l) throw new NotFoundError('Lesson not found');
      return;
    }
    case 'post':
      return;
  }
}

/** Events: questions, answers and jobs are their own entity; a lesson is recorded on the member with its id in props. */
async function savedEvent(tx: Tx, actor: UstaadActor, target: SaveTarget, kind: 'saved' | 'unsaved') {
  const lesson = target.kind === 'lesson';
  await recordUstaadEvent(tx, {
    entityType: lesson ? 'member' : (target.kind as 'question' | 'answer' | 'job'),
    entityId: lesson ? actor.memberId : target.id,
    kind: lesson ? `lesson_${kind}` : kind,
    actorId: actor.userId,
    actorRole: 'member',
    ...(lesson ? { props: { lesson_id: target.id } } : {}),
  });
}

/** Save any kind (a repeat changes nothing). Posts go through `saveUstaadPost`. */
export async function saveUstaadItem(
  db: Tx,
  actor: UstaadActor,
  target: SaveTarget,
): Promise<{ saved: true }> {
  if (target.kind === 'post') return saveUstaadPost(db, actor, target.id);
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    await assertVisible(tx, me.id, target);
    const inserted = await tx
      .insert(ustaadSavedItems)
      .values({ memberId: me.id, kind: target.kind, targetId: target.id })
      .onConflictDoNothing()
      .returning({ id: ustaadSavedItems.targetId });
    if (inserted.length > 0) await savedEvent(tx, actor, target, 'saved');
    return { saved: true };
  });
}

/** Unsave any kind (works even when the item is no longer visible) and take it out of my collections. */
export async function unsaveUstaadItem(
  db: Tx,
  actor: UstaadActor,
  target: SaveTarget,
): Promise<{ saved: false }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    if (target.kind === 'post') {
      await unsaveUstaadPost(tx, actor, target.id);
    } else {
      const deleted = await tx
        .delete(ustaadSavedItems)
        .where(
          and(
            eq(ustaadSavedItems.memberId, me.id),
            eq(ustaadSavedItems.kind, target.kind),
            eq(ustaadSavedItems.targetId, target.id),
          ),
        )
        .returning({ id: ustaadSavedItems.targetId });
      if (deleted.length > 0) await savedEvent(tx, actor, target, 'unsaved');
    }
    await tx
      .delete(ustaadSaveCollectionItems)
      .where(
        and(
          eq(ustaadSaveCollectionItems.memberId, me.id),
          eq(ustaadSaveCollectionItems.kind, target.kind),
          eq(ustaadSaveCollectionItems.targetId, target.id),
        ),
      );
    return { saved: false };
  });
}

/**
 * Every saved item the member may still see, one row per item: kind, id, save time, words to show and search, code.
 * Each branch is bounded by the member (`ustaad_saves` / `ustaad_saved_items` indexed on member + time).
 */
function savedRows(meId: string, cityId: string): SQL {
  return sql`
    select 'post'::text as kind, sv.post_id as id, sv.created_at, p.author_id as author,
           coalesce(p.body, p.fix_symptom, '') as text, null::text as text_hi, null::text as code
      from ustaad_saves sv join ustaad_posts p on p.id = sv.post_id
     where sv.member_id = ${meId} and p.status = 'visible'
    union all
    select 'question', si.target_id, si.created_at, q.asker_id,
           q.title || coalesce(' ' || q.body, ''), null, q.code
      from ustaad_saved_items si join ustaad_questions q on q.id = si.target_id
     where si.member_id = ${meId} and si.kind = 'question' and q.status <> 'removed'
       and (q.city_id = ${cityId} or q.reach = 'state')
    union all
    select 'answer', si.target_id, si.created_at, a.author_id, coalesce(a.body, ''), null, q.code
      from ustaad_saved_items si
      join ustaad_answers a on a.id = si.target_id
      join ustaad_questions q on q.id = a.question_id
     where si.member_id = ${meId} and si.kind = 'answer' and a.status = 'visible' and q.status <> 'removed'
       and (q.city_id = ${cityId} or q.reach = 'state')
    union all
    select 'job', si.target_id, si.created_at, j.employer_member_id, j.title, null, j.code
      from ustaad_saved_items si join ustaad_jobs j on j.id = si.target_id
     where si.member_id = ${meId} and si.kind = 'job'
       and (j.employer_member_id = ${meId}
            or (j.city_id = ${cityId} and j.status not in ('draft', 'pending_review', 'removed')))
    union all
    select 'lesson', si.target_id, si.created_at, null::uuid, l.title_en, l.title_hi, null
      from ustaad_saved_items si join ustaad_learning_resources l on l.id = si.target_id
     where si.member_id = ${meId} and si.kind = 'lesson' and l.active`;
}

const notBlockedRow = (meId: string) => sql`(sv.author is null or not exists (
  select 1 from ustaad_blocks bl
   where (bl.member_id = sv.author and bl.target_id = ${meId}) or (bl.member_id = ${meId} and bl.target_id = sv.author)))`;

async function ownCollection(tx: Tx, meId: string, id: string) {
  const [c] = await tx
    .select()
    .from(ustaadSaveCollections)
    .where(and(eq(ustaadSaveCollections.id, id), eq(ustaadSaveCollections.memberId, meId)))
    .limit(1);
  if (!c) throw new NotFoundError('Collection not found');
  return c;
}

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** My saved items, newest save first (keyset on the save time), filtered by kind, collection and words. */
export async function listUstaadSavedItems(
  db: Tx,
  actor: UstaadActor,
  query: {
    kind?: UstaadSaveKind | undefined;
    collectionId?: string | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<SavedPage> {
  const me = await feedMember(db, actor.memberId);
  if (query.collectionId) await ownCollection(db, me.id, query.collectionId);
  const cur = query.cursor ? decodeCursor(query.cursor, 'timestamp') : null;
  const conds: SQL[] = [notBlockedRow(me.id)];
  if (query.kind) conds.push(sql`sv.kind = ${query.kind}`);
  if (query.q) {
    const pat = likePattern(query.q);
    conds.push(sql`(sv.text ilike ${pat} or coalesce(sv.text_hi, '') ilike ${pat})`);
  }
  if (query.collectionId)
    conds.push(sql`exists (select 1 from ustaad_save_collection_items ci
      where ci.collection_id = ${query.collectionId} and ci.kind = sv.kind and ci.target_id = sv.id)`);
  if (cur)
    conds.push(
      sql`(sv.created_at < ${cur.k}::timestamptz or (sv.created_at = ${cur.k}::timestamptz and sv.id < ${cur.id}::uuid))`,
    );
  const rows = rowsOf<{
    kind: UstaadSaveKind;
    id: string;
    k: string;
    text: string;
    text_hi: string | null;
    code: string | null;
    collection_ids: string[] | null;
  }>(
    await db.execute(sql`
      select sv.kind, sv.id, sv.created_at::text as k, sv.text, sv.text_hi, sv.code,
             (select array_agg(ci.collection_id order by ci.created_at) from ustaad_save_collection_items ci
               where ci.member_id = ${me.id} and ci.kind = sv.kind and ci.target_id = sv.id) as collection_ids
        from (${savedRows(me.id, me.cityId)}) sv
       where ${sql.join(conds, sql` and `)}
       order by sv.created_at desc, sv.id desc
       limit ${query.limit + 1}`),
  );
  const slice = rows.slice(0, query.limit);
  const last = slice.at(-1);
  const items: SavedItem[] = slice.map((r) => ({
    kind: r.kind,
    id: r.id,
    savedAt: new Date(r.k).toISOString(),
    text: r.text.slice(0, USTAAD_SAVED_TEXT_MAX),
    textHi: r.text_hi?.slice(0, USTAAD_SAVED_TEXT_MAX) ?? null,
    code: r.code,
    collectionIds: r.collection_ids ?? [],
  }));
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
  };
}

/** Counts per kind (visible items only) and my collections with their item counts. */
export async function ustaadSavedSummary(db: Tx, actor: UstaadActor): Promise<SavedSummary> {
  const me = await feedMember(db, actor.memberId);
  const counted = rowsOf<{ kind: UstaadSaveKind; n: number | string }>(
    await db.execute(sql`
      select sv.kind, count(*)::int as n from (${savedRows(me.id, me.cityId)}) sv
       where ${notBlockedRow(me.id)} group by sv.kind`),
  );
  const counts = Object.fromEntries(USTAAD_SAVE_KINDS.map((k) => [k, 0])) as Record<UstaadSaveKind, number>;
  for (const r of counted) counts[r.kind] = Number(r.n);
  const collections = await db
    .select({
      id: ustaadSaveCollections.id,
      name: ustaadSaveCollections.name,
      version: ustaadSaveCollections.version,
      count: sql<number>`(select count(*)::int from ustaad_save_collection_items ci where ci.collection_id = ${ustaadSaveCollections.id})`,
    })
    .from(ustaadSaveCollections)
    .where(eq(ustaadSaveCollections.memberId, me.id))
    .orderBy(ustaadSaveCollections.createdAt)
    .limit(USTAAD_SAVE_COLLECTIONS_MAX);
  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
    collections,
  };
}

const view = (c: typeof ustaadSaveCollections.$inferSelect, count = 0): SaveCollection => ({
  id: c.id,
  name: c.name,
  version: c.version,
  count,
});

export async function createUstaadSaveCollection(
  db: Tx,
  actor: UstaadActor,
  name: string,
): Promise<SaveCollection> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ustaad_save_collections:${me.id}`}))`);
    const has = await tx.$count(ustaadSaveCollections, eq(ustaadSaveCollections.memberId, me.id));
    if (has >= USTAAD_SAVE_COLLECTIONS_MAX)
      throw new ValidationError('Too many collections', 'USTAAD_SAVE_COLLECTIONS_MAX');
    try {
      const [row] = await tx
        .insert(ustaadSaveCollections)
        .values({ memberId: me.id, name: name.trim() })
        .returning();
      if (!row) throw new NotFoundError();
      return view(row);
    } catch (err) {
      return mapPgError(err);
    }
  });
}

export async function renameUstaadSaveCollection(
  db: Tx,
  actor: UstaadActor,
  id: string,
  input: { name: string; version: number },
): Promise<SaveCollection> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    await ownCollection(tx, me.id, id);
    let row: typeof ustaadSaveCollections.$inferSelect | undefined;
    try {
      [row] = await tx
        .update(ustaadSaveCollections)
        .set({ name: input.name.trim() })
        .where(
          and(
            eq(ustaadSaveCollections.id, id),
            eq(ustaadSaveCollections.memberId, me.id),
            eq(ustaadSaveCollections.version, input.version),
          ),
        )
        .returning();
    } catch (err) {
      return mapPgError(err);
    }
    if (!row) throw new ConflictError('Collection changed, reload');
    const count = await tx.$count(ustaadSaveCollectionItems, eq(ustaadSaveCollectionItems.collectionId, id));
    return view(row, count);
  });
}

/** Deletes the collection and its memberships; the saves themselves stay. */
export async function deleteUstaadSaveCollection(db: Tx, actor: UstaadActor, id: string): Promise<void> {
  const me = await feedMember(db, actor.memberId);
  const deleted = await db
    .delete(ustaadSaveCollections)
    .where(and(eq(ustaadSaveCollections.id, id), eq(ustaadSaveCollections.memberId, me.id)))
    .returning({ id: ustaadSaveCollections.id });
  if (deleted.length === 0) throw new NotFoundError('Collection not found');
}

async function assertSavedByMe(tx: Tx, meId: string, target: SaveTarget): Promise<void> {
  const n =
    target.kind === 'post'
      ? await tx.$count(ustaadSaves, and(eq(ustaadSaves.memberId, meId), eq(ustaadSaves.postId, target.id)))
      : await tx.$count(
          ustaadSavedItems,
          and(
            eq(ustaadSavedItems.memberId, meId),
            eq(ustaadSavedItems.kind, target.kind),
            eq(ustaadSavedItems.targetId, target.id),
          ),
        );
  if (n === 0) throw new NotFoundError('Save it first');
}

/** Put a saved item in one of my collections (a repeat changes nothing). */
export async function addToUstaadSaveCollection(
  db: Tx,
  actor: UstaadActor,
  collectionId: string,
  target: SaveTarget,
): Promise<void> {
  await db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    await ownCollection(tx, me.id, collectionId);
    await assertSavedByMe(tx, me.id, target);
    await tx
      .insert(ustaadSaveCollectionItems)
      .values({ collectionId, memberId: me.id, kind: target.kind, targetId: target.id })
      .onConflictDoNothing();
  });
}

export async function removeFromUstaadSaveCollection(
  db: Tx,
  actor: UstaadActor,
  collectionId: string,
  target: SaveTarget,
): Promise<void> {
  await db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    await ownCollection(tx, me.id, collectionId);
    await tx
      .delete(ustaadSaveCollectionItems)
      .where(
        and(
          eq(ustaadSaveCollectionItems.collectionId, collectionId),
          eq(ustaadSaveCollectionItems.kind, target.kind),
          eq(ustaadSaveCollectionItems.targetId, target.id),
        ),
      );
  });
}
