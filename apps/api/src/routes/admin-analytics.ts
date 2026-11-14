import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  adminOverviewCounts,
  analyticsCities,
  analyticsDashboard,
  cityScopeFrom,
  NotFoundError,
  type AnalyticsResult,
  type CityScope,
  type OverviewScopes,
} from '@mechdost/db/repo';
import { AdminOverviewDto, AnalyticsDashboardDto } from '@mechdost/shared/admin-analytics-api';
import { resolveAnalyticsRange } from '@mechdost/shared/analytics-range';
import type { Grant, Permission } from '@mechdost/shared/rbac';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, Forbidden } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { TtlCache } from '../ttl-cache';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin analytics (spec 08 "Analytics", built 2026-11-14) and the Overview queue counts. Read-only aggregates;
 * verified staff only. The dashboard needs `analytics:read` and stays inside the caller's cities (a city outside
 * them is 404, like any out-of-scope target); site traffic (web events carry no city yet) only for an all-cities
 * grant. Answers are cached per (scope, city, range) for two minutes on this instance and privately for a minute in
 * the browser, so a busy admin team cannot turn the dashboard into a database load.
 */
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DashboardQuery = z
  .object({
    city: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .openapi({ param: { name: 'city', in: 'query' }, example: 'RPR' }),
    from: DATE.optional().openapi({ param: { name: 'from', in: 'query' }, example: '2026-11-01' }),
    to: DATE.optional().openapi({ param: { name: 'to', in: 'query' }, example: '2026-11-14' }),
  })
  .strict();

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const dashboardRoute = createRoute({
  method: 'get',
  path: '/admin/analytics/dashboard',
  tags: ['admin'],
  summary:
    'Analytics for an IST date range (default the last 30 days, at most 180) in the staff member’s cities',
  security: [{ bearerAuth: [] }],
  request: { query: DashboardQuery },
  responses: {
    200: json(AnalyticsDashboardDto, 'Dashboard'),
    404: json(ErrorSchema, 'City outside the staff member’s scope'),
    ...errorResponses,
  },
});

const overviewRoute = createRoute({
  method: 'get',
  path: '/admin/overview',
  tags: ['admin'],
  summary:
    'Live work-queue counts for the admin Overview (null where the staff member has no read permission)',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(AdminOverviewDto, 'Queue counts'), ...errorResponses },
});

const CACHE_HEADER = 'private, max-age=60';
const CACHE_TTL_MS = 120_000;

/** The scope as a permission grants it; null when no grant holds the permission at all. */
function scopeOrNull(grants: readonly Grant[], permission: Permission): CityScope | null {
  const scope = cityScopeFrom(grants, permission);
  return scope.all || scope.cityIds.length > 0 ? scope : null;
}

export function adminAnalyticsRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const dashboards = new TtlCache<AnalyticsResult>(CACHE_TTL_MS, 200);
  for (const path of ['/admin/analytics/*', '/admin/overview']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
  }
  app.use('/admin/analytics/*', requirePermission('analytics:read'));

  return app
    .openapi(dashboardRoute, async (c) => {
      const q = c.req.valid('query');
      const range = resolveAnalyticsRange({ from: q.from, to: q.to }, new Date());
      if (!range.ok)
        throw new ApiError(
          400,
          range.code,
          range.code === 'RANGE_TOO_LONG'
            ? 'The range is longer than 180 days'
            : 'The date range is not valid',
        );
      const scope = cityScopeFrom(c.get('auth').grants, 'analytics:read');
      const cities = await analyticsCities(deps.db, scope);
      const chosen = q.city ? cities.find((x) => x.code === q.city) : null;
      if (q.city && !chosen) throw new NotFoundError('City not found');
      const cityIds = chosen ? [chosen.id] : scope.all ? ('all' as const) : scope.cityIds;
      // Web events carry no city: site-wide traffic only for staff who may see every city.
      const traffic = scope.all;
      const key = JSON.stringify([
        scope.all ? 'all' : [...scope.cityIds].sort(),
        chosen?.id ?? null,
        range.fromDate,
        range.toDate,
      ]);
      const data =
        dashboards.get(key) ??
        dashboards.set(key, await analyticsDashboard(deps.db, { cityIds, range, traffic }));
      c.header('Cache-Control', CACHE_HEADER);
      return c.json(
        {
          range: { from: range.fromDate, to: range.toDate, days: range.days },
          city: chosen?.code ?? null,
          cities: cities.map(({ code, name, nameHi }) => ({ code, name, nameHi })),
          ...data,
        },
        200,
      );
    })
    .openapi(overviewRoute, async (c) => {
      const { grants, staffWithheld } = c.get('auth');
      const scopes: OverviewScopes = {
        orders: scopeOrNull(grants, 'orders:read'),
        service: scopeOrNull(grants, 'service:read'),
        tickets: scopeOrNull(grants, 'tickets:read'),
        reviews: scopeOrNull(grants, 'reviews:moderate'),
        applications: scopeOrNull(grants, 'applications:review'),
        prices: scopeOrNull(grants, 'prices:approve'),
        analytics: scopeOrNull(grants, 'analytics:read'),
      };
      if (Object.values(scopes).every((s) => s === null)) {
        if (staffWithheld.length > 0)
          throw Forbidden('STAFF_2FA_REQUIRED', 'Sign in with your password and the code sent to your phone');
        throw Forbidden();
      }
      const counts = await adminOverviewCounts(deps.db, { now: new Date(), scopes });
      return c.json(counts, 200);
    });
}
