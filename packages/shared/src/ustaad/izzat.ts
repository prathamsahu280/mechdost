/**
 * Izzat (spec 23 § 9.1): non-spendable reputation, never money, never Coins (locked). Workstream B fills the rules
 * (reversals, sponsored content earns nothing) here; A ships the reason → setting map the ledger reads.
 */
import type { UstaadIzzatReason } from './codes';
import type { UstaadSettingKey } from './settings';

/** Reasons whose points come from a setting; `strike`, `reversal` and `correction` carry their own delta. */
export const IZZAT_SETTING_FOR: Partial<Record<UstaadIzzatReason, UstaadSettingKey>> = {
  answer_posted: 'ustaad.izzat.answer_posted',
  best_answer: 'ustaad.izzat.best_answer',
  helpful_received: 'ustaad.izzat.helpful_received',
  follower_gained: 'ustaad.izzat.follower_gained',
  video_completed: 'ustaad.izzat.video_completed',
};

/** Izzat shown on a card: a negative total shows as 0. */
export function shownIzzat(total: number): number {
  return Math.max(0, total);
}
