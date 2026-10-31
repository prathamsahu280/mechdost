import { detectIntent, type Intent } from './intents';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantReply {
  intent: Intent;
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
