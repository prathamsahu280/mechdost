import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt } from './context';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantAnswer {
  text: string;
  model: string;
}

/** Thrown when the provider cannot answer (network, rate limit, refusal). Mapped to 502 by the route. */
export class AssistantUnavailableError extends Error {
  constructor(
    readonly reason: 'provider_error' | 'rate_limited' | 'refused' | 'empty',
    readonly upstreamStatus?: number,
  ) {
    super(reason);
    this.name = 'AssistantUnavailableError';
  }
}

/**
 * Provider seam (spec 18): Anthropic today; an OpenAI adapter can implement the same interface (inbox Q19).
 * Keys live only on the server (Secret Manager in production, root `.env` locally).
 */
export interface AssistantProvider {
  reply(turns: readonly AssistantTurn[]): Promise<AssistantAnswer>;
}

export function createAnthropicProvider(opts: { apiKey: string; model: string }): AssistantProvider {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 20_000 });
  const system = systemPrompt();

  return {
    async reply(turns) {
      try {
        const response = await client.beta.messages.create({
          model: opts.model,
          max_tokens: 1024,
          // Short support answers: low effort keeps latency and cost down for chat (claude-api skill guidance).
          output_config: { effort: 'low' },
          // If a safety classifier declines, the API retries on a suitable model inside the same call.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: turns.map((t) => ({ role: t.role, content: t.text })),
        });
        if (response.stop_reason === 'refusal') throw new AssistantUnavailableError('refused');
        const text = response.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim();
        if (!text) throw new AssistantUnavailableError('empty');
        return { text, model: response.model };
      } catch (err) {
        if (err instanceof AssistantUnavailableError) throw err;
        if (err instanceof Anthropic.RateLimitError) throw new AssistantUnavailableError('rate_limited', 429);
        if (err instanceof Anthropic.APIError) {
          const status: unknown = err.status;
          throw new AssistantUnavailableError(
            'provider_error',
            typeof status === 'number' ? status : undefined,
          );
        }
        throw new AssistantUnavailableError('provider_error');
      }
    },
  };
}
