/**
 * Admin → Ustaad rules without Zod (task G1). Kept apart from `dto/admin.ts` because the database package loads
 * these at runtime before the API's `@hono/zod-openapi` has extended Zod (L101: a Zod-building module loaded that
 * early leaves the API's schemas without `.openapi`). `dto/admin.ts` re-exports everything here.
 */
import type { PROMOTION_STATES } from './codes';

/**
 * Locked items: not settings and never stored; shown read-only, and a save that names one answers 422
 * SETTING_INVARIANT (SR-8, SR-41, SR-29; AT-LEVEL-2, AT-PROMO-1).
 */
export const USTAAD_LOCKED_ITEMS = [
  /** SR-8 founder ruling: verification and every Bada/Master promotion need a staff approval row. */
  { item: 'ustaad.verify.staff_final_approval', value: true },
  /** SR-41, ASCI: the label on every promotion, in its first line. */
  { item: 'ustaad.promo.label', value: { en: 'Sponsored', hi: 'प्रायोजित' } },
  /** SR-29: changing the edges would let differencing reveal positions. Kilometres. */
  { item: 'ustaad.loc.distance_bands', value: [2, 5, 10] },
] as const;
export type UstaadLockedItem = (typeof USTAAD_LOCKED_ITEMS)[number]['item'];

export function isUstaadLockedItem(key: string): key is UstaadLockedItem {
  return USTAAD_LOCKED_ITEMS.some((l) => l.item === key);
}

/** NFC, lower case, trimmed, inner spaces collapsed: the `phrase_norm` / alias form the filters match on. */
export function normaliseUstaadPhrase(text: string): string {
  return text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

type PromotionState = (typeof PROMOTION_STATES)[number];
/** Moves an admin may make; `live` is reached by the schedule (worker), never by hand. */
const PROMOTION_MOVES: Record<PromotionState, readonly PromotionState[]> = {
  draft: ['scheduled', 'ended'],
  scheduled: ['draft', 'ended'],
  live: ['ended'],
  ended: [],
};
export function promotionMoveAllowed(from: PromotionState, to: PromotionState): boolean {
  return PROMOTION_MOVES[from].includes(to);
}
