import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cityScopeFrom, saveUsageAlertConfig, saveUsageLimit, usageView } from '@mechdost/db/repo';
import {
  USAGE_METRIC_CODES,
  UsageAlertConfigInput,
  UsageLimitInput,
  UsageView,
  type UsageMetricCode,
} from '@mechdost/shared/usage';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { enforceRate, rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { runUsageCheck, usageSourcesFromConfig } from '../usage/check';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin → Usage & limits (founder 2026-11-26; spec 08). Verified staff with an all-cities `settings:read` grant
 * (super admin, operations manager) see the latest values, the 30-day trend and the alert settings, and may run
 * "Check now" (rate-limited per person and for everyone: each check lists the R2 buckets). Changing a limit, the
 * thresholds or the recipients needs `settings:write` (super admin). A city manager gets 404 like other
 * platform-wide data; other roles 403. No key or token ever reaches the answer.
 */
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const Metric = z
  .enum(USAGE_METRIC_CODES as [UsageMetricCode, ...UsageMetricCode[]])
  .openapi({ param: { name: 'metric', in: 'path' }, example: 'r2_storage_bytes' });

const view = createRoute({
  method: 'get',
  path: '/admin/usage',
  tags: ['admin'],
  summary: 'Usage and free limits: latest values, 30-day trend, alert settings',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(UsageView, 'Usage'), ...errorResponses },
});

const check = createRoute({
  method: 'post',
  path: '/admin/usage/check',
  tags: ['admin'],
  summary: 'Measure every provider now, store the values and raise alerts',
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(
      z.object({
        stored: z.number().int(),
        alerts: z.number().int(),
        usage: UsageView,
      }),
      'Checked',
    ),
    ...errorResponses,
  },
});

const saveLimit = createRoute({
  method: 'put',
  path: '/admin/usage/limits/{metric}',
  tags: ['admin'],
  summary: 'Set one metric limit (null = default) and whether it alerts (compare-and-set)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ metric: Metric }),
    body: { required: true, content: { 'application/json': { schema: UsageLimitInput } } },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Saved'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    ...errorResponses,
  },
});

const saveAlerts = createRoute({
  method: 'put',
  path: '/admin/usage/alerts',
  tags: ['admin'],
  summary: 'Thresholds, email recipients and email language (compare-and-set)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { required: true, content: { 'application/json': { schema: UsageAlertConfigInput } } },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Saved'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    ...errorResponses,
  },
});

export function adminUsageRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/usage/*'; // covers /admin/usage too (L54)
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('settings:read'));
  app.on('PUT', prefix, requirePermission('settings:write'));
  const sources = deps.usageSources ?? usageSourcesFromConfig(deps.config);
  const canEdit = (c: Parameters<typeof scopedCity>[1]) =>
    cityScopeFrom(c.get('auth').grants, 'settings:write').all;

  return app
    .openapi(view, async (c) => {
      await scopedCity(deps, c, null, 'settings:read');
      c.header('Cache-Control', 'no-store');
      return c.json(await usageView(deps.db, { canEdit: canEdit(c) }), 200);
    })
    .openapi(check, async (c) => {
      await scopedCity(deps, c, null, 'settings:read');
      await enforceRate(c, deps.rateLimiter, RATE_RULES.usageCheck, c.get('auth').user.id, 1);
      await enforceRate(c, deps.rateLimiter, RATE_RULES.usageCheckGlobal, 'all', 1);
      const r = await runUsageCheck(deps.db, sources, {
        trigger: 'manual',
        actor: { type: 'admin', userId: c.get('auth').user.id },
      });
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          stored: r.stored,
          alerts: r.alerts.length,
          usage: await usageView(deps.db, { canEdit: canEdit(c) }),
        },
        200,
      );
    })
    .openapi(saveLimit, async (c) => {
      await scopedCity(deps, c, null, 'settings:write');
      const b = c.req.valid('json');
      const r = await saveUsageLimit(deps.db, {
        metric: c.req.valid('param').metric,
        limit: b.limit,
        alerts: b.alerts,
        expectedVersion: b.expectedVersion,
        actor: { type: 'admin', userId: c.get('auth').user.id },
      });
      return c.json(r, 200);
    })
    .openapi(saveAlerts, async (c) => {
      await scopedCity(deps, c, null, 'settings:write');
      const b = c.req.valid('json');
      const r = await saveUsageAlertConfig(deps.db, {
        ...b,
        actor: { type: 'admin', userId: c.get('auth').user.id },
      });
      return c.json(r, 200);
    });
}
