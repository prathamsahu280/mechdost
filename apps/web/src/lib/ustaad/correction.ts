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

/**
 * A choice on the suggest card. `current` is the field as it is now: Keep mine and Edit myself never rewrite it (the
 * member may have typed since the check), and Use suggestion replaces only the exact text that was checked (Undo
 * brings that text back, as typed, untrimmed).
 */
export function applyChoice(
  choice: CorrectionChoice,
  result: CorrectResponseView,
  current: string,
): ChoiceOutcome {
  if (choice === 'use')
    return { text: result.text, undo: current, correction: 'suggested_used', original: current };
  return { text: current, undo: null, correction: 'none', original: null };
}

/**
 * The card (and Undo) only apply while the field still holds the text they were made for; once the member types,
 * they go away instead of overwriting newer words.
 */
export function stillApplies(madeFor: string | null, current: string): boolean {
  return madeFor !== null && madeFor === current;
}

/** Segments for display: a changed run with no new text (words removed) shows as nothing but keeps its `was`. */
export function visibleSegments(segments: readonly CorrectionSegmentView[]): CorrectionSegmentView[] {
  return segments.filter((s) => s.text !== '' || s.kind === 'same');
}

/** API error code → `ustaad.correction` message key. */
export function correctionErrorKey(code: string): 'limited' | 'failed' {
  return code === 'RATE_LIMITED' ? 'limited' : 'failed';
}

export { shownText, textLang } from './correction-text';
