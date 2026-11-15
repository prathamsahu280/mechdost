import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { NotFoundError, ownWorkshopAnalytics, workshopCityId } from '@mechdost/db/repo';
import { resolveAnalyticsRange } from '@mechdost/shared/analytics-range';
import { PortalWorkshopAnalyticsDto, workshopMedians } from '@mechdost/shared/workshop-analytics-api';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, Forbidden } from '../errors';
import { authenticate, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { cachedCityWorkshopAnalytics } from '../workshop-analytics-cache';
import { errorResponses } from './schemas';

/**
 * Workshop portal "Performance" (design 2026-11-15, spec 07): the owner's own numbers for an IST range (default the
 * last 30 days, at most 180) beside the anonymised city medians. Owner only: the `workshop_owner` role scoped to the
 * workshop. Workshop staff are refused (403) because the figures are money. The workshop comes from the grant, never
 * from the client; with several workshops the optional `workshop` id must be one of the owner's. Another workshop's
 * name or number is never in the answer (medians only, and only from three workshops with data).
 */
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Query = z
  .object({
    from: DATE.optional().openapi({ param: { name: 'from', in: 'query' }, example: '2026-11-01' }),
    to: DATE.optional().openapi({ param: { name: 'to', in: 'query' }, example: '2026-11-14' }),
    workshop: z
      .uuid()
      .optional()
      .openapi({ param: { name: 'workshop', in: 'query' } }),
  })
  .strict();

const route = createRoute({
  method: 'get',
  path: '/workshop/analytics',
  tags: ['workshop'],
  summary: 'Your workshop’s numbers for an IST date range, with the anonymised city medians (owner only)',
  security: [{ bearerAuth: [] }],
  request: { query: Query },
  responses: {
    200: {
      description: 'Performance',
      content: { 'application/json': { schema: PortalWorkshopAnalyticsDto } },
    },
    ...errorResponses,
  },
});

const OWNER_ROLE = 'workshop_owner';

export function workshopAnalyticsRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/workshop/analytics', authenticate(deps, cache));
  app.use(
    '/workshop/analytics',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/workshop/analytics', requireVerified);

  return app.openapi(route, async (c) => {
    const q = c.req.valid('query');
    const range = resolveAnalyticsRange({ from: q.from, to: q.to }, new Date());
    if (!range.ok)
      throw new ApiError(
        400,
        range.code,
        range.code === 'RANGE_TOO_LONG' ? 'The range is longer than 180 days' : 'The date range is not valid',
      );
    const owned = c
      .get('auth')
      .grants.filter((g) => g.role === OWNER_ROLE && g.workshopId !== null)
      .map((g) => g.workshopId)
      .filter((id): id is string => id !== null)
      .sort();
    if (owned.length === 0) throw Forbidden();
    const workshopId = q.workshop ?? owned[0];
    // A workshop id the caller does not own is "not found", like any foreign id.
    if (!workshopId || !owned.includes(workshopId)) throw new NotFoundError('Workshop not found');
    const cityId = await workshopCityId(deps.db, workshopId);
    if (!cityId) throw new NotFoundError('Workshop not found');
    const own = await ownWorkshopAnalytics(deps.db, { cityId, workshopId, range });
    if (!own) throw new NotFoundError('Workshop not found');
    const city = await cachedCityWorkshopAnalytics(deps.db, cityId, range);
    const { id, name, nameHi, ...stats } = own;
    c.header('Cache-Control', 'private, max-age=60');
    return c.json(
      {
        range: { from: range.fromDate, to: range.toDate, days: range.days },
        workshop: { id, name, nameHi },
        stats,
        // The asking workshop is left out of its own benchmark (anonymity, security review 2026-11-15).
        cityMedians: workshopMedians(city.workshops, { excludeId: id }),
      },
      200,
    );
  });
}
