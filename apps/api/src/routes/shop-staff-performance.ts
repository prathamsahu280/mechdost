import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { getShopStaffPerformance, shopIdsFrom } from '@mechdost/db/repo';
import { ShopStaffPerformance, STAFF_PERFORMANCE_WINDOWS } from '@mechdost/shared/shop-staff-performance';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Shop staff performance and earnings (design 2026-11-16; spec 07, 13): `GET /shop/staff-performance/{shopId}?days=`.
 * Any person who works at the shop may ask; what they get depends on their own grants, decided in the repository:
 * the owner sees every member, the shop totals and the payout ledger, a staff member only their own row. A shop the
 * caller does not work at is a 404 (the same answer for a shop that does not exist).
 */
const route = createRoute({
  method: 'get',
  path: '/shop/staff-performance/{shopId}',
  tags: ['shop'],
  summary:
    'Per-person performance and the payout ledger for the last 30 or 90 IST days (owner: everyone; staff: yourself)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: z.uuid().openapi({ param: { name: 'shopId', in: 'path' } }) }),
    query: z.object({
      days: z
        .enum(STAFF_PERFORMANCE_WINDOWS.map(String) as ['30', '90'])
        .default('30')
        .transform((d) => (d === '90' ? (90 as const) : (30 as const))),
    }),
  },
  responses: {
    200: { description: 'Performance', content: { 'application/json': { schema: ShopStaffPerformance } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

export function shopStaffPerformanceRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/shop/staff-performance/*';
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('inventory:write'));

  return app.openapi(route, async (c) => {
    const { shopId } = c.req.valid('param');
    const { days } = c.req.valid('query');
    const auth = c.get('auth');
    const owned = auth.grants
      .filter((g) => g.role === 'seller_owner' && g.shopId !== null)
      .map((g) => g.shopId)
      .filter((id): id is string => id !== null);
    return c.json(
      await getShopStaffPerformance(deps.db, {
        shopId,
        ownedShopIds: owned,
        workShopIds: shopIdsFrom(auth.grants, 'inventory:write'),
        userId: auth.user.id,
        days,
      }),
      200,
    );
  });
}
