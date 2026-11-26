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

/** Strikes are staff decisions between −500 and −50 (§ 9.1); the ledger CHECK allows −500…100 and never 0. */
const STRIKE_MIN = -500;
const STRIKE_MAX = -50;

/**
 * Points for one ledger row; 0 means "write nothing" (the ledger refuses delta 0). Setting-driven reasons read the
 * settings; sponsored and MechDost-authored content earns nothing (locked); `strike` is clamped to −500…−50;
 * `reversal` and `correction` carry their own delta (the negative of the row they undo).
 */
export function izzatPoints(
  reason: UstaadIzzatReason,
  values: Readonly<Partial<Record<UstaadSettingKey, unknown>>>,
  opts: { delta?: number; sponsored?: boolean } = {},
): number {
  if (opts.sponsored) return 0;
  const key = IZZAT_SETTING_FOR[reason];
  if (key) {
    const v = values[key];
    return typeof v === 'number' && Number.isInteger(v) ? v : 0;
  }
  const d = opts.delta ?? 0;
  if (!Number.isInteger(d)) return 0;
  if (reason === 'strike') return Math.min(STRIKE_MAX, Math.max(STRIKE_MIN, d > 0 ? STRIKE_MAX : d));
  return Math.max(STRIKE_MIN, Math.min(100, d));
}
