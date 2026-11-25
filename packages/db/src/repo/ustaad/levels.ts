/**
 * Level recompute hook (spec 23 § 9.2). STUB from workstream A with the final signature; workstream B implements it
 * (qualified followers, OR groups, staff review for Bada/Master, never a drop for inactivity).
 */
import type { UstaadLevel } from '@mechdost/shared/ustaad/codes';
import type { Tx } from '../orders';

export interface LevelRecomputeResult {
  /** The level after the recompute (unchanged in the stub). */
  level: UstaadLevel | null;
  /** True when a staff review was queued instead of a promotion. */
  reviewQueued: boolean;
}

export async function recomputeUstaadLevel(_tx: Tx, _memberId: string): Promise<LevelRecomputeResult> {
  return Promise.resolve({ level: null, reviewQueued: false });
}
