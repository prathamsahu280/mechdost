import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { globalFlagSetting, mySavings, orderSavingsForCustomer } from '@mechdost/db/repo';
import { SAVINGS_PERIODS } from '@mechdost/shared/savings';
import { MySavingsDto, OrderSavingsDto, SavingsOrderCode } from '@mechdost/shared/savings-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, forbidSellers } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * "Your savings" (shopping personalisation phase 4, decision 2026-11-26): the signed-in customer's savings vs the
 * maker's printed MRP this month or this year (IST), and one order's breakdown. The user id comes from the session
 * only; another customer's order is 404 (repository scope). Shop accounts are refused like every customer-only route.
 * `customers.savings_enabled` off → `enabled: false` with zeros (the ledger is still written).
 */
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const mine = createRoute({
  method: 'get',
  path: '/me/savings',
  tags: ['savings'],
  summary: 'Your savings vs the maker’s printed MRP this month or this year (IST), per component',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ period: z.enum(SAVINGS_PERIODS) }) },
  responses: { 200: json(MySavingsDto.openapi('MySavings'), 'Savings'), ...errorResponses },
});

const ofOrder = createRoute({
  method: 'get',
  path: '/me/orders/{code}/savings',
  tags: ['savings'],
  summary: 'Savings on one of your orders: final after delivery (net of refunds), else an estimate',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: SavingsOrderCode.openapi({ param: { name: 'code', in: 'path' } }) }) },
  responses: {
    200: json(OrderSavingsDto.openapi('OrderSavings'), 'Order savings'),
    404: json(ErrorSchema, 'Not found'),
    ...errorResponses,
  },
});

const ZERO = {
  mrpPaise: 0,
  couponPaise: 0,
  coinsPaise: 0,
  deliveryPaise: 0,
  totalPaise: 0,
  excludedLines: 0,
};

export function savingsRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/me/savings', '/me/orders/:code/savings']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, forbidSellers);
  }
  return app
    .openapi(mine, async (c) => {
      const s = await mySavings(deps.db, c.get('auth').user.id, {
        period: c.req.valid('query').period,
        now: new Date(),
      });
      const enabled = await globalFlagSetting(deps.db, 'customers.savings_enabled');
      return c.json(
        {
          ...s,
          ...(enabled ? {} : { ...ZERO, orders: 0 }),
          enabled,
          from: s.from.toISOString(),
          to: s.to.toISOString(),
        },
        200,
      );
    })
    .openapi(ofOrder, async (c) => {
      // Ownership first (404 for a foreign code), whatever the switch says.
      const v = await orderSavingsForCustomer(deps.db, c.get('auth').user.id, c.req.valid('param').code);
      const enabled = await globalFlagSetting(deps.db, 'customers.savings_enabled');
      return c.json(
        enabled ? { ...v, enabled } : { ...ZERO, status: 'none' as const, refunded: false, enabled },
        200,
      );
    });
}
