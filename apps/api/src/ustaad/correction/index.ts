/**
 * Smart correction entry point (spec 23 § 11). STUB from workstream A with the final signature (plan "Interface
 * stubs": `correction.apply(text, mode)`): it returns the text unchanged. Workstream F replaces the body with the
 * `SmartCorrectionEngine` (LLM via plain fetch, word-list fallback, meaning guard, PII masking, cache, budget) and
 * adds `engine.ts`, `anthropic.ts`, `gemini.ts`, `wordlist.ts`, `guard.ts`, `mask.ts`, `prompt.ts`, `cache.ts` here.
 */
import type { UstaadCorrectionMode } from '@mechdost/shared/ustaad/codes';

export interface CorrectionResult {
  text: string;
  changes: readonly { from: string; to: string }[];
  engine: 'llm_anthropic' | 'llm_gemini' | 'wordlist' | 'none';
}

export function applyCorrection(text: string, _mode: UstaadCorrectionMode): Promise<CorrectionResult> {
  return Promise.resolve({ text, changes: [], engine: 'none' });
}
