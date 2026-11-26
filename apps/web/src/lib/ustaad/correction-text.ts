import type { CorrectionLang } from '@mechdost/shared/ustaad/correction';

/**
 * The pure text helpers behind "Edited · see original" (spec 23 § 11), kept apart from the correction API call so the
 * feed's post cards can show corrected text without loading the correction schemas (Zod) on Home (spec 23 § 17
 * budget, 2026-11-26). `correction.ts` re-exports both.
 */

/** Which text a reader sees under "Edited · see original" (the corrected text unless they asked for the original). */
export function shownText(
  post: { body: string; bodyOriginal: string | null },
  showOriginal: boolean,
): string {
  return showOriginal && post.bodyOriginal !== null ? post.bodyOriginal : post.body;
}

/**
 * `lang` attribute for member text: mostly Devanagari → `hi`; Latin text only from the composer's hint (`hinglish` or
 * `cg` → `hi-Latn`, `en` → `en`), else undefined (inherits the page, never a guessed Hinglish voice for English).
 */
export function textLang(
  text: string,
  hint: CorrectionLang | null = null,
): 'hi' | 'hi-Latn' | 'en' | undefined {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return undefined;
  const deva = letters.filter((c) => /[ऀ-ॿ]/.test(c)).length;
  if (deva * 2 >= letters.length) return 'hi';
  if (hint === 'hinglish' || hint === 'cg') return 'hi-Latn';
  return hint === 'en' ? 'en' : undefined;
}
