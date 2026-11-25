/**
 * Level helpers (spec 23 § 9.2). Workstream A ships the ladder order; workstream B adds the pure engine here
 * (`qualifiedFollowers()`, `levelFor()`), unit tested in `test/ustaad-levels.test.ts`.
 */
import { USTAAD_LEVELS, type UstaadLevel } from './codes';

/** Position on the ladder (apprentice 0 … master 5). */
export function levelRank(level: UstaadLevel): number {
  return USTAAD_LEVELS.indexOf(level);
}

/** True when `level` is `min` or higher (Pakka+ checks for vouches, best answers). */
export function levelAtLeast(level: UstaadLevel, min: UstaadLevel): boolean {
  return levelRank(level) >= levelRank(min);
}

/** Levels whose promotion always needs a staff approval row (locked, SR-8). */
export const STAFF_REVIEW_LEVELS: readonly UstaadLevel[] = ['bada', 'master'];

/** The level a new member starts at for the track picked at join. */
export function startLevel(track: 'apprentice' | 'ustaad'): UstaadLevel {
  return track === 'ustaad' ? 'ustaad_pending' : 'apprentice';
}
