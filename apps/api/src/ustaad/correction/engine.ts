import type { CorrectionEngineId, CorrectionLang } from '@mechdost/shared/ustaad/correction';

/**
 * Smart-correction engine seam (spec 23 § 11). Every engine receives text that is already PII-masked and returns the
 * corrected (still masked) text; the caller restores, guards and falls back. Engines throw `CorrectionEngineError`
 * on any failure (no key, HTTP error, refusal, bad JSON, timeout); the caller then uses the word list.
 */
export interface CorrectionInput {
  text: string;
  langHint: CorrectionLang | null;
  /** Protected words found in the text (sent so the model keeps them). */
  protected: readonly string[];
}

export interface SmartCorrectionEngine {
  readonly id: CorrectionEngineId;
  /** Model id (cache key part); `wordlist` for the word list. */
  readonly model: string;
  correct(input: CorrectionInput, signal: AbortSignal): Promise<{ text: string }>;
}

export type CorrectionFailureReason =
  'http_error' | 'rate_limited' | 'refusal' | 'truncated' | 'bad_reply' | 'timeout' | 'network';

export class CorrectionEngineError extends Error {
  constructor(
    readonly reason: CorrectionFailureReason,
    readonly upstreamStatus?: number,
  ) {
    super(`smart correction engine failed: ${reason}`);
    this.name = 'CorrectionEngineError';
  }
}

/** The part of `fetch` the providers use (tests pass a double that records the request). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Maps a thrown fetch error to a reason (an aborted signal is the 2 s timeout). */
export function fetchFailure(err: unknown, signal: AbortSignal): CorrectionEngineError {
  if (err instanceof CorrectionEngineError) return err;
  return new CorrectionEngineError(signal.aborted ? 'timeout' : 'network');
}
