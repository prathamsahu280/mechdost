/**
 * What the composer may offer this member right now (SIM-P6, SIM-P29): the live photo limit (admin setting
 * `ustaad.posts.max_photos`, never a number hard-coded in the app), whether stories are open to them, and whether they
 * may write at all. The composer asks once and refuses before any file is uploaded; the create calls still check
 * everything again (this is a hint, never the gate).
 */
import type { ComposeLimits } from '@mechdost/shared/ustaad/dto/feed';
import type { Tx } from '../orders';
import { feedMember, memberAgeDays, type UstaadActor } from './feed-common';
import { readUstaadSettingValues } from './settings';

export async function ustaadComposeLimits(
  tx: Tx,
  actor: UstaadActor,
  now = new Date(),
): Promise<ComposeLimits> {
  const me = await feedMember(tx, actor.memberId);
  const s = await readUstaadSettingValues(tx, [
    'ustaad.posts.max_photos',
    'ustaad.posts.types.stories',
    'ustaad.stories.min_account_days',
  ]);
  const stories =
    s['ustaad.posts.types.stories'] !== true
      ? 'off'
      : memberAgeDays(me, now) < Number(s['ustaad.stories.min_account_days'])
        ? 'locked'
        : 'open';
  return {
    maxPhotos: Number(s['ustaad.posts.max_photos']),
    stories,
    canWrite: me.status === 'active' && me.restrictedMode === 'none',
  };
}
