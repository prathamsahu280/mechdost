import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { clearRecentlyViewed, recentlyViewed, recordRecentViews } from '@mechdost/db/repo';
import { RecentlyViewedDto, RecentViewsBodySchema } from '@mechdost/shared/recently-viewed-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/**
 * Recently viewed (shopping personalisation phase 2, design 2026-11-25): the signed-in person's own list, kept on the
 * server only while they have given the `personalisation` consent (the repository checks it on every call; without it
 * nothing is written and the answer is `{ stored: false }`). Personal: every answer is `private, no-store`. A write is
 * one product view or a device's list merged in at sign-in; a person may write `RECENT_WRITE_RATE` times an hour
 * (product pages are cached, so a view is at most one call per page open).
 */
export const RECENT_WRITE_RATE: RateRule = { name: 'recent_write', limit: 600, windowSeconds: 3600 };
const NO_STORE = 'private, no-store';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const tags = ['me'];
const security = [{ bearerAuth: [] }];

const getRoute = createRoute({
  method: 'get',
  path: '/me/recently-viewed',
  tags,
  summary: 'Your recently viewed products, newest first (empty and stored: false without the consent)',
  security,
  responses: { 200: json(RecentlyViewedDto, 'List'), ...errorResponses },
});
const postRoute = createRoute({
  method: 'post',
  path: '/me/recently-viewed',
  tags,
  summary: 'Record a product view, or merge this device list at sign-in (only with the consent)',
  security,
  request: { body: { required: true, content: { 'application/json': { schema: RecentViewsBodySchema } } } },
  responses: { 200: json(RecentlyViewedDto, 'List as it is now'), ...errorResponses },
});
const deleteRoute = createRoute({
  method: 'delete',
  path: '/me/recently-viewed',
  tags,
  summary: 'Clear your recently viewed products',
  security,
  responses: { 200: json(z.object({ cleared: z.number().int() }), 'Cleared'), ...errorResponses },
});

export function recentlyViewedRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/me/recently-viewed', authenticate(deps, cache));
  app.use(
    '/me/recently-viewed',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/me/recently-viewed',
    rateLimit(deps.rateLimiter, RECENT_WRITE_RATE, (c) => c.get('auth').user.id),
  );

  return app
    .openapi(getRoute, async (c) => {
      c.header('Cache-Control', NO_STORE);
      return c.json(await recentlyViewed(deps.db, c.get('auth').user.id), 200);
    })
    .openapi(postRoute, async (c) => {
      const b = c.req.valid('json');
      c.header('Cache-Control', NO_STORE);
      return c.json(
        await recordRecentViews(deps.db, { userId: c.get('auth').user.id, cityCode: b.city, views: b.views }),
        200,
      );
    })
    .openapi(deleteRoute, async (c) => {
      c.header('Cache-Control', NO_STORE);
      return c.json({ cleared: await clearRecentlyViewed(deps.db, c.get('auth').user.id) }, 200);
    });
}
