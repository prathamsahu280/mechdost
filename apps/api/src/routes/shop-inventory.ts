import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  cityScopeFrom,
  listShopInventory,
  NotFoundError,
  saveShopOffer,
  shopIdsFrom,
  shopInStaffScope,
} from '@mechdost/db/repo';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Shop offers (spec 07): shop owners/staff (`inventory:write`, their own shops) and staff (`partners:write`, shops
 * in their cities; decision "admin sets prices per shop") list and edit price, stock, lead time and on/off per SKU.
 * Price ≤ MRP, stock ≥ reserved, compare-and-set on `version`, audited. Same handlers, two scopes.
 */
const ShopId = z.uuid().openapi({ param: { name: 'shopId', in: 'path' } });
const Sku = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,47}$/)
  .openapi({ param: { name: 'sku', in: 'path' }, example: 'CAS-ACT4T-0900' });
const Locale = z.enum(['en', 'hi']).default('en');

const Offer = z
  .object({
    sku: z.string(),
    product: z.string(),
    productSlug: z.string(),
    mrpPaise: z.number().int(),
    sellingPaise: z.number().int(),
    onHand: z.number().int(),
    reserved: z.number().int(),
    free: z.number().int(),
    leadDays: z.number().int().nullable(),
    active: z.boolean(),
    version: z.number().int(),
  })
  .openapi('ShopOffer');
const Changes = {
  sellingPaise: z.number().int().min(1).optional(),
  onHand: z.number().int().min(0).max(100_000).optional(),
  leadDays: z.number().int().min(0).max(60).nullable().optional(),
  active: z.boolean().optional(),
};
const Patch = z
  .object({ version: z.number().int().min(1), ...Changes })
  .strict()
  .openapi('ShopOfferPatch');
const Create = z
  .object({
    sku: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,47}$/),
    ...Changes,
    sellingPaise: z.number().int().min(1),
  })
  .strict()
  .openapi('ShopOfferCreate');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const saved = {
  200: json(z.object({ version: z.number().int() }), 'Saved'),
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Changed meanwhile / below reserved / already listed'),
  ...errorResponses,
};

function routesFor(base: '/shops' | '/admin/shops', tag: string) {
  return {
    list: createRoute({
      method: 'get',
      path: `${base}/{shopId}/inventory`,
      tags: [tag],
      summary: 'Offers of a shop: price, MRP, stock, reserved, free, lead time, on/off',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ shopId: ShopId }), query: z.object({ locale: Locale }) },
      responses: {
        200: json(z.object({ offers: z.array(Offer) }), 'Offers'),
        404: json(ErrorSchema, 'Not found'),
        ...errorResponses,
      },
    }),
    create: createRoute({
      method: 'post',
      path: `${base}/{shopId}/inventory`,
      tags: [tag],
      summary: 'Offer a live SKU (price ≤ MRP)',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ shopId: ShopId }),
        body: { required: true, content: { 'application/json': { schema: Create } } },
      },
      responses: saved,
    }),
    patch: createRoute({
      method: 'patch',
      path: `${base}/{shopId}/inventory/{sku}`,
      tags: [tag],
      summary: 'Change price, stock (absolute, never below reserved), lead time or on/off',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ shopId: ShopId, sku: Sku }),
        body: { required: true, content: { 'application/json': { schema: Patch } } },
      },
      responses: saved,
    }),
  };
}

export function shopInventoryRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const prefix of ['/shops/*', '/admin/shops/*']) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
  }
  app.use('/shops/*', requirePermission('inventory:write'));
  app.use('/admin/shops/*', requirePermission('partners:write'));

  /** Resolve the caller's right to this shop: own shop for partners, a shop in the staff member's cities. */
  async function scoped(c: Context<AppEnv>, shopId: string, as: 'shop' | 'staff') {
    const grants = c.get('auth').grants;
    if (as === 'shop') {
      if (!shopIdsFrom(grants, 'inventory:write').includes(shopId)) throw new NotFoundError('Shop not found');
    } else await shopInStaffScope(deps.db, shopId, cityScopeFrom(grants, 'partners:write'));
    return { actorUserId: c.get('auth').user.id, actorRole: as };
  }

  for (const [base, as, tag] of [
    ['/shops', 'shop', 'shop'],
    ['/admin/shops', 'staff', 'admin'],
  ] as const) {
    const r = routesFor(base, tag);
    app.openapi(r.list, async (c) => {
      const { shopId } = c.req.valid('param');
      await scoped(c, shopId, as);
      return c.json({ offers: await listShopInventory(deps.db, shopId, c.req.valid('query').locale) }, 200);
    });
    app.openapi(r.create, async (c) => {
      const { shopId } = c.req.valid('param');
      const { sku, ...changes } = c.req.valid('json');
      const actor = await scoped(c, shopId, as);
      return c.json(
        await saveShopOffer(deps.db, { shopId, sku, expectedVersion: null, changes, ...actor }),
        200,
      );
    });
    app.openapi(r.patch, async (c) => {
      const { shopId, sku } = c.req.valid('param');
      const { version, ...changes } = c.req.valid('json');
      const actor = await scoped(c, shopId, as);
      return c.json(
        await saveShopOffer(deps.db, { shopId, sku, expectedVersion: version, changes, ...actor }),
        200,
      );
    });
  }
  return app;
}
