import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { listShopPayoutEntries } from '@mechdost/db/repo';
import { SHOP_PAYOUT_ENTRY_KINDS } from '@mechdost/shared/coins';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * What MechDost owes shops (`shop_payout_entries`, append-only; code review 2026-11-14): today the MechDost Coins
 * discount on delivered parts. Verified staff with `payouts:read` (finance, super admin). Weekly payouts (Q11) build
 * on this report.
 */
const Entry = z
  .object({
    id: z.string(),
    shopId: z.string(),
    shopName: z.string(),
    orderCode: z.string().nullable(),
    kind: z.enum(SHOP_PAYOUT_ENTRY_KINDS),
    amountPaise: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('ShopPayoutEntry');

const list = createRoute({
  method: 'get',
  path: '/admin/payouts/entries',
  tags: ['admin'],
  summary: 'What MechDost owes shops, newest first, optionally for one shop (payouts:read)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      shopId: z.uuid().optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Entries',
      content: {
        'application/json': {
          schema: z.object({
            entries: z.array(Entry),
            nextCursor: z.string().nullable(),
            totalPaise: z.number().int(),
          }),
        },
      },
    },
    422: { description: 'INVALID_CURSOR', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

export function payoutRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/payouts/*'; // one pattern per prefix (L54)
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('payouts:read'));

  return app.openapi(list, async (c) => {
    const page = await listShopPayoutEntries(deps.db, c.req.valid('query'));
    return c.json(
      {
        ...page,
        entries: page.entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      },
      200,
    );
  });
}
