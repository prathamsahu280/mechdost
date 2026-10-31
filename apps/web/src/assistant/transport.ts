import { detectIntent, type Intent } from './intents';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantReply {
  /** Drives the follow-up action link (shop, workshops, bulk quote …) — always detected locally. */
  intent: Intent;
  /** Free-text answer from the LLM when the API answered; otherwise the widget shows the canned answer. */
  text?: string;
}

/**
 * How the widget gets answers. Today: `staticTransport` (keyword intents → translated canned answers, no network).
 * Later: an HTTP transport calling `POST /v1/assistant/messages` on the MechDost API, which holds the provider key
 * (Anthropic or OpenAI — inbox Q19), adds site context and rate limits per user/IP. The key never reaches the
 * browser. Swapping transports does not change the widget.
 */
export interface AssistantTransport {
  reply(history: readonly ChatMessage[]): Promise<AssistantReply>;
}

export const staticTransport: AssistantTransport = {
  reply(history) {
    const last = [...history].reverse().find((m) => m.role === 'user');
    return Promise.resolve({ intent: last ? detectIntent(last.text) : 'fallback' });
  },
};

const MAX_TURNS = 20;
const MAX_TEXT = 500;
const TIMEOUT_MS = 15_000;

/**
 * HTTP transport (spec 18): `POST {apiUrl}/v1/assistant/messages`. Falls back to the static answers when the API
 * is unreachable, slow, rate limited or not configured (503 → the API is skipped for the rest of the visit).
 */
export function createApiTransport(apiUrl: string): AssistantTransport {
  let disabled = false;
  return {
    async reply(history) {
      const fallback = await staticTransport.reply(history);
      if (disabled) return fallback;
      const recent = history.slice(-MAX_TURNS);
      const firstUser = recent.findIndex((m) => m.role === 'user');
      const messages = recent
        .slice(Math.max(0, firstUser))
        .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TEXT) }));
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);
      try {
        const res = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/assistant/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });
        if (res.status === 503) disabled = true;
        if (!res.ok) return fallback;
        const body: unknown = await res.json();
        const text =
          typeof body === 'object' && body !== null && 'reply' in body && typeof body.reply === 'string'
            ? body.reply.trim()
            : '';
        return text ? { intent: fallback.intent, text } : fallback;
      } catch {
        return fallback;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** API transport when the web app knows the API URL, static answers otherwise (local demo, tests). */
export function defaultTransport(): AssistantTransport {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  return apiUrl ? createApiTransport(apiUrl) : staticTransport;
}
