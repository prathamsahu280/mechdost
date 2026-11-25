import type { CorrectionEngineId, CorrectionLang } from '@mechdost/shared/ustaad/correction';
import { correctionCacheKey, type CorrectionCache } from './cache';
import { CorrectionEngineError, type CorrectionFailureReason, type SmartCorrectionEngine } from './engine';
import { countPhrase, meaningGuard } from './guard';
import { hasPlaceholderChars, maskPii } from './mask';

/**
 * One correction, end to end (spec 23 § 11): mask → (LLM: cache → daily budget → call with timeout → restore →
 * meaning guard → cache) → otherwise the word list on the masked text → restore → guard. Never throws for engine
 * trouble: the word list always answers. Returns why the LLM was not used, for content-free logs.
 */
export type LlmSkipReason =
  | 'no_engine'
  | 'no_consent'
  | 'placeholder_chars'
  | 'unmasked_digits'
  | 'budget'
  | 'guard'
  | 'placeholder'
  | CorrectionFailureReason;

export interface CorrectionRun {
  engine: CorrectionEngineId;
  text: string;
  cached: boolean;
  llmSkipped: LlmSkipReason | null;
  ms: number;
}

export interface CorrectionRunInput {
  text: string;
  langHint: CorrectionLang | null;
  /** Every active protected word (only those present are sent to the LLM). */
  protectedWords: readonly string[];
  protectedVersion: string;
  llm: SmartCorrectionEngine | null;
  /** The member's `ustaad_correction` consent. */
  llmAllowed: boolean;
  wordList: SmartCorrectionEngine;
  cache: CorrectionCache;
  /** Reserves one call of the daily LLM budget; false when it is spent or the counter store cannot answer. */
  reserveLlmCall: () => Promise<boolean>;
  timeoutMs: number;
  maxLengthChangePct: number;
  now?: () => number;
}

/** Runs `fn` with an abort signal that fires after `ms`; the race also ends a call that ignores the signal. */
async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new CorrectionEngineError('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctrl.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runCorrection(input: CorrectionRunInput): Promise<CorrectionRun> {
  const now = input.now ?? (() => performance.now());
  const started = now();
  const { text } = input;
  const mask = maskPii(text);
  const present = input.protectedWords.filter((p) => countPhrase(text, p) > 0);
  const guardOpts = { maxLengthChangePct: input.maxLengthChangePct };
  const accept = (maskedOut: string): string | null => {
    const restored = mask.restore(maskedOut);
    if (restored === null) return null;
    return meaningGuard(text, restored, present, guardOpts).ok ? restored : null;
  };

  let skipped: LlmSkipReason;
  const llm = input.llm;
  if (!llm) skipped = 'no_engine';
  else if (!input.llmAllowed) skipped = 'no_consent';
  else if (hasPlaceholderChars(text)) skipped = 'placeholder_chars';
  else if (!mask.safeForLlm) skipped = 'unmasked_digits';
  else {
    const key = correctionCacheKey({
      engine: llm.id,
      model: llm.model,
      protectedVersion: input.protectedVersion,
      lang: input.langHint,
      maskedText: mask.masked,
    });
    const hit = await input.cache.get(key);
    const fromCache = hit === null ? null : accept(hit);
    if (fromCache !== null)
      return { engine: llm.id, text: fromCache, cached: true, llmSkipped: null, ms: now() - started };
    if (!(await input.reserveLlmCall())) skipped = 'budget';
    else {
      try {
        const out = await withTimeout(input.timeoutMs, (signal) =>
          llm.correct({ text: mask.masked, langHint: input.langHint, protected: present }, signal),
        );
        const restored = mask.restore(out.text);
        if (restored === null) skipped = 'placeholder';
        else if (!meaningGuard(text, restored, present, guardOpts).ok) skipped = 'guard';
        else {
          await input.cache.set(key, out.text);
          return { engine: llm.id, text: restored, cached: false, llmSkipped: null, ms: now() - started };
        }
      } catch (err) {
        skipped = err instanceof CorrectionEngineError ? err.reason : 'network';
      }
    }
  }

  const out = await input.wordList.correct(
    { text: mask.masked, langHint: input.langHint, protected: present },
    new AbortController().signal,
  );
  return {
    engine: 'wordlist',
    text: accept(out.text) ?? text,
    cached: false,
    llmSkipped: skipped,
    ms: now() - started,
  };
}
