import {
  CorrectResponse,
  type CorrectionChoice,
  type CorrectionLang,
  type CorrectionSegmentView,
  type CorrectResponseView,
} from '@mechdost/shared/ustaad/correction';
import { authed, type ApiResult } from '../orders-api';

/**
 * Smart correction on the web (spec 23 § 11). The API call plus the pure state the suggest card and the "Edited · see
 * original" toggle use (kept here, not in the components, so it is unit-tested without a DOM).
 */
export function requestCorrection(
  locale: string,
  input: { text: string; lang?: CorrectionLang | null; mode?: 'suggest' | 'auto' },
): Promise<ApiResult<CorrectResponseView>> {
  return authed(locale, '/ustaad/correct', CorrectResponse, { method: 'POST', body: input });
}

/** What the composer shows after a check: nothing, "looks clear", or the suggest card. */
export type SuggestView =
  | { kind: 'clear' }
  | { kind: 'suggest'; result: CorrectResponseView }
  | { kind: 'auto'; result: CorrectResponseView };

export function suggestViewFor(result: CorrectResponseView): SuggestView {
  if (!result.changed || result.mode === 'off') return { kind: 'clear' };
  return result.mode === 'auto' ? { kind: 'auto', result } : { kind: 'suggest', result };
}

/** The draft after a choice, with what Undo restores and what the post stores (`correction` code, spec § 6.3). */
export interface ChoiceOutcome {
  text: string;
  /** Text Undo brings back (null = nothing to undo). */
  undo: string | null;
  /** Stored with the post: `suggested_used` only when the member took the suggestion unchanged. */
  correction: 'none' | 'suggested_used';
  /** Original kept as `body_original` when the suggestion was used. */
  original: string | null;
}

export function applyChoice(choice: CorrectionChoice, result: CorrectResponseView): ChoiceOutcome {
  if (choice === 'use')
    return {
      text: result.text,
      undo: result.original,
      correction: 'suggested_used',
      original: result.original,
    };
  // Keep mine and Edit myself both leave the member's own text in the field (Edit then focuses it).
  return { text: result.original, undo: null, correction: 'none', original: null };
}

/** Segments for display: a changed run with no new text (words removed) shows as nothing but keeps its `was`. */
export function visibleSegments(segments: readonly CorrectionSegmentView[]): CorrectionSegmentView[] {
  return segments.filter((s) => s.text !== '' || s.kind === 'same');
}

/** Which text a reader sees under "Edited · see original" (the corrected text unless they asked for the original). */
export function shownText(
  post: { body: string; bodyOriginal: string | null },
  showOriginal: boolean,
): string {
  return showOriginal && post.bodyOriginal !== null ? post.bodyOriginal : post.body;
}

/** API error code → `ustaad.correction` message key. */
export function correctionErrorKey(code: string): 'limited' | 'failed' {
  return code === 'RATE_LIMITED' ? 'limited' : 'failed';
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
