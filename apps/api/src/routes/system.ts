import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { ping } from '@mechdost/db/repo';
import { log } from '../logger';
import type { AppDeps, AppEnv } from '../types';

const Status = z.object({ status: z.enum(['ok', 'unavailable']) }).openapi('Status');

const health = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Liveness — the process is up (no dependencies checked)',
  responses: { 200: { description: 'Alive', content: { 'application/json': { schema: Status } } } },
});

const ready = createRoute({
  method: 'get',
  path: '/ready',
  tags: ['system'],
  summary: 'Readiness — the database is reachable',
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: Status } } },
    503: { description: 'Not ready', content: { 'application/json': { schema: Status } } },
  },
});

const READY_TIMEOUT_MS = 2000;

export function systemRoutes(deps: AppDeps) {
  return new OpenAPIHono<AppEnv>()
    .openapi(health, (c) => c.json({ status: 'ok' as const }, 200))
    .openapi(ready, async (c) => {
      try {
        await Promise.race([
          ping(deps.db),
          new Promise((_, reject) =>
            setTimeout(() => {
              reject(new Error('ready timeout'));
            }, READY_TIMEOUT_MS).unref(),
          ),
        ]);
        return c.json({ status: 'ok' as const }, 200);
      } catch (err) {
        log('warn', 'not_ready', { requestId: c.get('requestId'), error: (err as Error).message });
        return c.json({ status: 'unavailable' as const }, 503);
      }
    });
}
