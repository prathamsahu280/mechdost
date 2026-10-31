# 18 · MechDost assistant (floating chat)

Status: P0 static widget shipped 2026-11-01 · LLM backend P1 · Decisions: "Assistant" (2026-11-01)

## Goal

A floating "Ask MechDost" button on every page that answers common questions (products, workshops, bulk prices, order tracking, partners, contact) and hands off to the right page or to WhatsApp. Today the answers are static; later the same widget talks to an LLM through our API with MechDost context.

## Current implementation (static)

- `apps/web/src/components/assistant/assistant-launcher.tsx` — fixed button above the mobile tab bar (icon-only under 640px, pill with label above), `aria-expanded`/`aria-controls`; the panel code is lazy-loaded on first open.
- `assistant-panel.tsx` — non-modal dialog (`role="dialog"`, `aria-modal="false"`), focus moves to the input on open, Esc closes and returns focus to the launcher, messages list is `aria-live="polite"`, typing indicator, suggestion chips, 500-char input limit.
- `apps/web/src/assistant/intents.ts` — keyword intents in English, Hindi and Hinglish (word-start matching for Latin keywords; priority bulk → track → partner → workshop → shop → contact → fallback). Unit tests: `apps/web/test/assistant.test.ts`.
- `apps/web/src/assistant/transport.ts` — `AssistantTransport` interface; `staticTransport` returns an intent; the panel renders the translated answer + one action link (`assistant.*` messages in `packages/shared/src/i18n`).
- Analytics: `assistant_opened { path }`, `assistant_message { intent, length }` (no message text — may contain PII).

## LLM backend (P1)

- API: `POST /v1/assistant/messages` (Hono) — body `{ conversationId?, messages: [{ role, text }] (≤ 20, ≤ 500 chars each) }`, streaming response (SSE).
- Provider adapter `packages/assistant` with Anthropic and OpenAI implementations behind one interface; provider + model + key from Secret Manager (inbox **Q19**). The key never reaches the browser.
- Context: system prompt with MechDost policies, city coverage, live catalogue search tool (`search_products`), workshop finder tool (`nearby_workshops`), order lookup tool for the signed-in user only (`my_orders`, scoped by the actor — no cross-user data), escalation tool (`create_support_ticket`).
- Guardrails: per-user/IP rate limits (spec 13: 20 messages/10 min guest, 60/10 min signed-in), max tokens per reply, refusal of non-automotive tasks, no medical/legal/financial advice, never invents prices or availability (tools only), PII redaction in logs, conversation retention 30 days.
- Admin: prompt + FAQ snippets editable in the CMS (rule 8), transcript review with ratings, kill switch feature flag falls back to `staticTransport`.

## Acceptance tests

Static: intent table tests; e2e opens, answers a bulk question with a WhatsApp action, closes with Esc and restores focus, axe clean. LLM (P1): tool calls scoped to the actor (role-leak test), rate limit 429, kill switch, no secrets in client bundle.

## API (implemented 2026-11-01)

`POST /v1/assistant/messages` in `apps/api/src/routes/assistant.ts`: strict body `{ messages: [{ role: 'user'|'assistant', text: 1..500 }] (1..50, last = user) }` → `{ reply, model }`. Provider `apps/api/src/assistant/provider.ts` (Anthropic SDK; `ASSISTANT_MODEL` default `claude-opus-5-5`, server-side fallbacks, `effort: low`, cached system prompt from `context.ts`). Errors: 503 `ASSISTANT_DISABLED` (no `ANTHROPIC_API_KEY`), 502 `ASSISTANT_UNAVAILABLE`, 429 at 20 messages / 10 min per IP. Only the last 20 turns are sent; message text is never logged. Tests: `apps/api/test/assistant.test.ts`. **Next:** web transport calling the API with fallback to the built-in answers on 503/errors.
