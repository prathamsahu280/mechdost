/**
 * Brand and range switches (design `docs/superpowers/specs/2026-11-22-real-catalogue-and-smart-search-design.md`,
 * spec 02 / 08): the admin turns a whole brand or product range off at once, with a reason code. Zod-free (L79).
 * Codes, never free text (hard rule 16); the note is an extra.
 */
export const HIDE_REASONS = [
  'discontinued',
  'supplier_issue',
  'price_review',
  'quality_issue',
  'out_of_season',
  'legal',
  'other',
] as const;
export type HideReason = (typeof HIDE_REASONS)[number];

export function isHideReason(v: unknown): v is HideReason {
  return typeof v === 'string' && (HIDE_REASONS as readonly string[]).includes(v);
}

/** Most packs one bulk call may touch (one audited batch). */
export const BULK_MAX = 500;

/** Longest admin-only photo source (a URL) we keep. */
export const PHOTO_SOURCE_MAX = 500;
