import { z } from 'zod';
import {
  CorrectionEngineError,
  fetchFailure,
  type CorrectionInput,
  type FetchLike,
  type SmartCorrectionEngine,
} from './engine';
import {
  CORRECTION_OUTPUT_SCHEMA,
  CORRECTION_SYSTEM_PROMPT,
  correctionMaxTokens,
  correctionUserMessage,
  parseCorrectionReply,
} from './prompt';

/**
 * Google Gemini `generateContent` over plain `fetch` (spec 23 § 11, the optional alternative). There is no default
 * model id: `SMART_CORRECTION_MODEL` is required for this provider (config refuses to start without it). The request
 * shape (systemInstruction, contents, generationConfig.responseMimeType / responseSchema) is from Google's public
 * REST reference and has **not** been tested against the live API (no key yet, Q-U3); verify before turning it on.
 */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const Reply = z.object({
  candidates: z
    .array(
      z
        .object({
          finishReason: z.string().optional(),
          content: z
            .object({ parts: z.array(z.object({ text: z.string().optional() }).loose()).optional() })
            .loose()
            .optional(),
        })
        .loose(),
    )
    .optional(),
});

export function createGeminiCorrection(opts: {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
}): SmartCorrectionEngine {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: 'llm_gemini',
    model: opts.model,
    async correct(input: CorrectionInput, signal: AbortSignal) {
      let res: Response;
      try {
        res = await doFetch(`${GEMINI_BASE_URL}/${encodeURIComponent(opts.model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: CORRECTION_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: correctionUserMessage(input) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: { text: { type: 'STRING' } },
                required: [...CORRECTION_OUTPUT_SCHEMA.required],
              },
              maxOutputTokens: correctionMaxTokens(input.text),
            },
          }),
          signal,
        });
      } catch (err) {
        throw fetchFailure(err, signal);
      }
      if (res.status === 429) throw new CorrectionEngineError('rate_limited', 429);
      if (!res.ok) throw new CorrectionEngineError('http_error', res.status);
      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        throw signal.aborted ? fetchFailure(err, signal) : new CorrectionEngineError('bad_reply');
      }
      const parsed = Reply.safeParse(body);
      const first = parsed.success ? parsed.data.candidates?.[0] : undefined;
      if (!first) throw new CorrectionEngineError('bad_reply');
      if (first.finishReason === 'SAFETY') throw new CorrectionEngineError('refusal');
      if (first.finishReason !== 'STOP') throw new CorrectionEngineError('truncated');
      const text = (first.content?.parts ?? []).map((p) => p.text ?? '').join('');
      const corrected = parseCorrectionReply(text);
      if (corrected === null) throw new CorrectionEngineError('bad_reply');
      return { text: corrected };
    },
  };
}
