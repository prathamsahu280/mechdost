/**
 * Saved (spec 23 § 5 Saved; design docs/superpowers/specs/2026-11-28-mechanic-network-saved-design.md). What a member
 * can keep: posts (the original `ustaad_saves`), questions, answers, jobs and Learn lessons (`ustaad_saved_items`), and
 * the member's own named collections. One source for the database CHECKs, the DTOs and the web.
 */
export const USTAAD_SAVE_KINDS = ['post', 'question', 'answer', 'job', 'lesson'] as const;
export type UstaadSaveKind = (typeof USTAAD_SAVE_KINDS)[number];
export const USTAAD_SAVE_ITEM_KINDS = ['question', 'answer', 'job', 'lesson'] as const;
export type UstaadSaveItemKind = (typeof USTAAD_SAVE_ITEM_KINDS)[number];
/** Collections a member may keep (founder OK pending: could become the admin setting `saved.collections_max`). */
export const USTAAD_SAVE_COLLECTIONS_MAX = 20;
export const USTAAD_SAVE_COLLECTION_NAME_MAX = 40;
/** Suggested collection names (codes; the words live in the locale files under `ustaad.saved.suggest.*`). */
export const USTAAD_SAVE_SUGGESTED_COLLECTIONS = ['wiring', 'part_prices', 'tips'] as const;
/** How much of an item's own words the Saved list shows. */
export const USTAAD_SAVED_TEXT_MAX = 160;
