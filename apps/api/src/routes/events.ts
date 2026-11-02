import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { recordClientEvents, type ClientEventRow } from '@mechdost/db/repo';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import { rateLimit } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/**
 * Web/app analytics ingestion (spec 12; hard rules 9 and 16). Anonymous (no sign-in), per-IP limited, batches of
 * up to 50. Each event is checked against the shared registry (`CLIENT_EVENT_SCHEMAS`): unknown names or invalid
 * props are dropped and counted, never stored. Consent (DPDP): without analytics consent nothing is stored.
 * Client clocks are untrusted: `occurredAt` must be within the last 24 h (else it becomes the receive time).
 */
export const EVENTS_RATE: RateRule = { name: 'events_ip', limit: 120, windowSeconds: 60 };
const MAX_AGE_MS = 24 * 3_600_000;
const MAX_SKEW_MS = 5 * 60_000;

const Batch = z
  .object({
    source: z.enum(['web', 'app']),
    anonymousId: z.uuid(),
    sessionId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .nullable()
      .optional(),
    consent: z.object({ analytics: z.boolean(), version: z.string().max(20) }).strict(),
    events: z
      .array(
        z
          .object({
            event: z.string().max(64),
            occurredAt: z.iso.datetime({ offset: true }),
            page: z.string().max(200).regex(/^\//).nullable().optional(),
            props: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .openapi('EventBatch');

const ingest = createRoute({
  method: 'post',
  path: '/events',
  tags: ['analytics'],
  summary: 'Send a batch of up to 50 web/app events (dropped without analytics consent)',
  request: { body: { required: true, content: { 'application/json': { schema: Batch } } } },
  responses: {
    202: {
      description: 'Accepted',
      content: {
        'application/json': {
          schema: z.object({ stored: z.number().int(), rejected: z.number().int() }),
        },
      },
    },
    ...errorResponses,
  },
});

const schemaFor = (name: string) =>
  Object.hasOwn(CLIENT_EVENT_SCHEMAS, name)
    ? CLIENT_EVENT_SCHEMAS[name as keyof typeof CLIENT_EVENT_SCHEMAS]
    : null;

export function eventRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/events',
    rateLimit(deps.rateLimiter, EVENTS_RATE, (c) => c.get('clientIp')),
  );
  return app.openapi(ingest, async (c) => {
    const batch = c.req.valid('json');
    if (!batch.consent.analytics) return c.json({ stored: 0, rejected: 0 }, 202);
    const now = Date.now();
    const rows: ClientEventRow[] = [];
    let rejected = 0;
    for (const e of batch.events) {
      const parsed = schemaFor(e.event)?.safeParse(e.props);
      if (!parsed?.success) {
        rejected += 1;
        continue;
      }
      const at = Date.parse(e.occurredAt);
      rows.push({
        event: e.event,
        occurredAt: new Date(at > now - MAX_AGE_MS && at < now + MAX_SKEW_MS ? at : now),
        page: e.page ?? null,
        props: parsed.data,
      });
    }
    const stored = await recordClientEvents(deps.db, {
      source: batch.source,
      anonymousId: batch.anonymousId,
      sessionId: batch.sessionId ?? null,
      consentVersion: batch.consent.version,
      rows,
    });
    return c.json({ stored, rejected }, 202);
  });
}
