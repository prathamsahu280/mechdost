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
 * Anthropic Messages API over plain `fetch` (spec 23 § 11: no SDK dependency for this adapter). The model id comes
 * from `SMART_CORRECTION_MODEL` (default `DEFAULT_ANTHROPIC_CORRECTION_MODEL`, Claude Haiku 5.5). Request shape per
 * the API version `2026-10-21`: no sampling parameters, adaptive thinking left at its default with `effort: low`,
 * structured output through `output_config.format`, no tools, no member id or metadata. Anything but a complete
 * `end_turn` reply (refusal, `max_tokens`, non-200, bad JSON) is a failure and the word list answers.
 */
export const DEFAULT_ANTHROPIC_CORRECTION_MODEL = 'claude-haiku-5-5';
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2026-10-21';

const Reply = z.object({
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
});

export function createAnthropicCorrection(opts: {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
}): SmartCorrectionEngine {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    id: 'llm_anthropic',
    model: opts.model,
    async correct(input: CorrectionInput, signal: AbortSignal) {
      let res: Response;
      try {
        res = await doFetch(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: correctionMaxTokens(input.text),
            system: CORRECTION_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: correctionUserMessage(input) }],
            output_config: {
              effort: 'low',
              format: { type: 'json_schema', schema: CORRECTION_OUTPUT_SCHEMA },
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
      if (!parsed.success) throw new CorrectionEngineError('bad_reply');
      const { stop_reason: stop, content } = parsed.data;
      if (stop === 'refusal') throw new CorrectionEngineError('refusal');
      if (stop !== 'end_turn') throw new CorrectionEngineError('truncated');
      // Read blocks by type: a reply can start with (empty) thinking blocks.
      const text = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const corrected = parseCorrectionReply(text);
      if (corrected === null) throw new CorrectionEngineError('bad_reply');
      return { text: corrected };
    },
  };
}
