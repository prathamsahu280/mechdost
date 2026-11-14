import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { globalIntSetting } from '@mechdost/db/repo';
import { AssistantUnavailableError } from '../assistant/provider';
import { ApiError } from '../errors';
import { log } from '../logger';
import { rateLimit } from '../middleware/rate-limit';
import { RateLimitUnavailable, type RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/** spec 18: guests 20 messages / 10 min per IP (signed-in limits arrive with web auth). */
export const ASSISTANT_RATE: RateRule = { name: 'assistant_ip', limit: 20, windowSeconds: 600 };
const MAX_TURNS = 20;
/** Site-wide day window; the limit is the admin's `assistant.daily_messages` (cost cap, Q91, 2026-11-14). */
const DAILY_WINDOW_SECONDS = 86_400;

const Turn = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(500),
  })
  .strict();

const AskBody = z
  .object({
    messages: z
      .array(Turn)
      .min(1)
      .max(50)
      .refine((m) => m.at(-1)?.role === 'user', { message: 'The last message must be from the user' }),
  })
  .strict()
  .openapi('AssistantAsk');

const Answer = z.object({ reply: z.string(), model: z.string() }).openapi('AssistantAnswer');

const ask = createRoute({
  method: 'post',
  path: '/assistant/messages',
  tags: ['assistant'],
  summary: 'Ask the MechDost assistant (LLM-backed; 503 when no provider is configured)',
  request: { body: { required: true, content: { 'application/json': { schema: AskBody } } } },
  responses: {
    200: { description: 'Answer', content: { 'application/json': { schema: Answer } } },
    ...errorResponses,
  },
});

/**
 * POST /v1/assistant/messages. Public (no sign-in yet) but rate limited per IP; only the last 20 turns are sent
 * to the provider. Message text is never logged (it may contain personal details).
 */
export function assistantRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/assistant/*',
    rateLimit(deps.rateLimiter, ASSISTANT_RATE, (c) => c.get('clientIp')),
  );
  return app.openapi(ask, async (c) => {
    if (!deps.assistant) {
      throw new ApiError(503, 'ASSISTANT_DISABLED', 'The assistant is not configured');
    }
    // One site-wide budget per day, so many IPs together cannot run up the provider bill. Checked before the
    // provider is called; refuses (503) rather than spends when the counter store cannot answer.
    const cap = await globalIntSetting(deps.db, 'assistant.daily_messages');
    let today;
    try {
      today = await deps.rateLimiter.hit(
        { name: 'assistant_day', limit: cap, windowSeconds: DAILY_WINDOW_SECONDS, failClosed: true },
        'site',
      );
    } catch (err) {
      if (err instanceof RateLimitUnavailable)
        throw new ApiError(503, 'ASSISTANT_UNAVAILABLE', 'The assistant could not answer right now');
      throw err;
    }
    if (cap === 0 || !today.allowed)
      throw new ApiError(
        429,
        'ASSISTANT_DAILY_LIMIT',
        'The assistant is resting for today — please call support',
      );
    const { messages } = c.req.valid('json');
    const recent = messages.slice(-MAX_TURNS);
    // Providers require the conversation to start with a user turn.
    const firstUser = recent.findIndex((m) => m.role === 'user');
    const turns = recent.slice(firstUser);
    const started = performance.now();
    try {
      const answer = await deps.assistant.reply(turns);
      log('info', 'assistant_answer', {
        requestId: c.get('requestId'),
        model: answer.model,
        turns: turns.length,
        ms: Math.round(performance.now() - started),
      });
      return c.json({ reply: answer.text, model: answer.model }, 200);
    } catch (err) {
      if (err instanceof AssistantUnavailableError) {
        log('warn', 'assistant_unavailable', {
          requestId: c.get('requestId'),
          reason: err.reason,
          upstreamStatus: err.upstreamStatus,
        });
        throw new ApiError(502, 'ASSISTANT_UNAVAILABLE', 'The assistant could not answer right now');
      }
      throw err;
    }
  });
}
