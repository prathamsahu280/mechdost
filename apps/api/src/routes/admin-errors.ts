import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { AdminErrors } from '@mechdost/shared/admin-errors-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { NOT_CONNECTED } from '../monitoring/sentry-issues';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses } from './schemas';

/**
 * Admin → Errors (decision 2026-11-14, spec 08): the latest unresolved Sentry issues of the website and the API.
 * Verified staff with an all-cities `settings:read` grant (super admin, operations manager); a city manager gets
 * 404 like other platform-wide data. Counts and links only; the read token stays on the server. Without the token
 * the answer is `{ connected: false }` and the panel says how to connect it.
 */
const list = createRoute({
  method: 'get',
  path: '/admin/errors',
  tags: ['admin'],
  summary: 'Latest unresolved Sentry issues (website and API), counts only',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Issues', content: { 'application/json': { schema: AdminErrors } } },
    ...errorResponses,
  },
});

export function adminErrorRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const path = '/admin/errors';
  app.use(path, authenticate(deps, cache));
  app.use(
    path,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(path, requireVerified);
  app.use(path, requirePermission('settings:read'));

  return app.openapi(list, async (c) => {
    // Platform-wide data: only an all-cities grant (404 otherwise, like other out-of-scope targets).
    await scopedCity(deps, c, null, 'settings:read');
    const body = deps.sentryIssues ? await deps.sentryIssues.list() : NOT_CONNECTED;
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  });
}
