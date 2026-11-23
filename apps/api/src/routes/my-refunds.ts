import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { listMyRefunds } from '@mechdost/db/repo';
import { MyRefundPageDto } from '@mechdost/shared/refunds-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, forbidSellers } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * The signed-in customer's own refunds (spec 05, 2026-11-23: "the customer should also have a refund status page").
 * The repository takes the user id from the session, never from the URL or query, so another person's refund can never
 * be returned (nothing to 404: there is no id to guess). Shop accounts are refused like every customer-only route;
 * staff without orders of their own simply get an empty list. Only what `MyRefundDto` names leaves the server.
 */
const listRoute = createRoute({
  method: 'get',
  path: '/me/refunds',
  tags: ['refunds'],
  summary: 'Your refunds, newest first (pass `nextCursor` back as `cursor`)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      cursor: z.string().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: { description: 'Refunds', content: { 'application/json': { schema: MyRefundPageDto } } },
    422: { description: 'INVALID_CURSOR', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

export function myRefundRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/me/refunds', authenticate(deps, cache));
  app.use(
    '/me/refunds',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/me/refunds', forbidSellers);
  return app.openapi(listRoute, async (c) => {
    const page = await listMyRefunds(deps.db, c.get('auth').user.id, c.req.valid('query'));
    return c.json(page, 200);
  });
}
