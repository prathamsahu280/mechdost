/**
 * Moving media objects after a moderation decision (spec 23 § 13 takedown, SR-39). The database already refuses new
 * signed URLs (status `removed_archived`) in the decision's transaction; this moves every object of the file (main
 * key and image variants) out of the live bucket into the evidence/archive bucket, so URLs issued before the removal
 * stop working too (AT-TAKEDOWN-1), and back on an overturned appeal. Copy first, then delete the source; a failed
 * move is logged and counted, never thrown (the decision stands; the next decision or the purge retries).
 */
import { randomUUID } from 'node:crypto';
import { relocateUstaadMedia, ustaadMediaObjectKeys, type MediaRelocation, type Tx } from '@mechdost/db/repo';
import { MEDIA_BUCKET_PREFIX, type UstaadMediaBucket } from '@mechdost/shared/ustaad/codes';
import { log, safeError } from '../../logger';
import type { MediaHost } from '../media/host';

const extOf = (key: string) => key.slice(key.lastIndexOf('.') + 1);

export function relocatedKey(bucket: UstaadMediaBucket, ownerMemberId: string, fromKey: string): string {
  return `${MEDIA_BUCKET_PREFIX[bucket]}/${ownerMemberId}/${randomUUID()}.${extOf(fromKey)}`;
}

export async function moveUstaadMediaObjects(
  deps: { db: Tx; host: MediaHost | null | undefined },
  items: readonly MediaRelocation[],
  to: 'evidence' | 'media',
): Promise<{ moved: number; failed: number }> {
  let moved = 0;
  let failed = 0;
  if (!deps.host || items.length === 0) return { moved, failed: items.length };
  for (const item of items) {
    if (item.bucket === to) continue;
    const target: UstaadMediaBucket = to === 'media' && item.mime === 'application/pdf' ? 'docs' : to;
    try {
      const keys = await ustaadMediaObjectKeys(deps.db, item.mediaId);
      const moves = keys.map((from) => ({ from, to: relocatedKey(target, item.ownerMemberId, from) }));
      for (const mv of moves) await deps.host.copy(item.bucket, mv.from, target, mv.to);
      await relocateUstaadMedia(deps.db, { mediaId: item.mediaId, bucket: target, moves });
      for (const mv of moves) await deps.host.remove(item.bucket, mv.from);
      moved += 1;
    } catch (err) {
      failed += 1;
      log('error', 'ustaad_media_move_failed', { mediaId: item.mediaId, to: target, ...safeError(err) });
    }
  }
  return { moved, failed };
}
