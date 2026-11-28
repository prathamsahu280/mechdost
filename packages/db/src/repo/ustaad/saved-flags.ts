/**
 * "Saved by me" for lists (spec 23 § 21i-L): one batched lookup per list for the signed-in member, on the primary key of
 * `ustaad_saved_items (member_id, kind, target_id)`, so a page of cards costs one query, never one per card. Kept apart
 * from `saved.ts` (which imports the Q&A and jobs repositories) so those can use it without a cycle.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { UstaadSaveKind } from '@mechdost/shared/ustaad/saved';
import { ustaadSavedItems } from '../../schema';
import type { Tx } from '../orders';

type ItemKind = Exclude<UstaadSaveKind, 'post'>;

/** The ids among `ids` of this kind that the member has saved. */
export async function savedIdSet(
  db: Tx,
  memberId: string,
  kind: ItemKind,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: ustaadSavedItems.targetId })
    .from(ustaadSavedItems)
    .where(
      and(
        eq(ustaadSavedItems.memberId, memberId),
        eq(ustaadSavedItems.kind, kind),
        inArray(ustaadSavedItems.targetId, [...ids]),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
