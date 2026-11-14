import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  cityScopeFrom,
  getMyShops,
  listShopInventory,
  NotFoundError,
  saveShopOffer,
  setOwnShopHours,
  shopIdsFrom,
  shopInStaffScope,
} from '@mechdost/db/repo';
import { MyShops, OwnShopHoursSchema } from '@mechdost/shared/shop-api';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Shop offers (spec 07): shop owners/staff (`inventory:write`, their own shops) and staff (shops in their cities;
 * decision "admin sets prices per shop"; registered by `admin-shops.ts`) list and edit price, stock, lead time and
 * on/off per SKU. Price ≤ MRP, stock ≥ reserved, compare-and-set on `version`, audited. Same handlers, two scopes.
 * Also the shop's own profile (`GET /shop/me`) and the owner's working hours (`PUT /shop/hours/{shopId}`).
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

interface ActorFields {
  actorUserId: string;
  actorRole: 'shop' | 'staff';
}

/** The three offer routes under `base`; `scoped` resolves the caller's right to the shop (404 otherwise). */
function registerInventory(
  app: OpenAPIHono<AppEnv>,
  deps: AppDeps,
  base: '/shops' | '/admin/shops',
  tag: string,
  scoped: (c: Context<AppEnv>, shopId: string, write: boolean) => Promise<ActorFields>,
) {
  const r = routesFor(base, tag);
  app.openapi(r.list, async (c) => {
    const { shopId } = c.req.valid('param');
    await scoped(c, shopId, false);
    return c.json({ offers: await listShopInventory(deps.db, shopId, c.req.valid('query').locale) }, 200);
  });
  app.openapi(r.create, async (c) => {
    const { shopId } = c.req.valid('param');
    const { sku, ...changes } = c.req.valid('json');
    const actor = await scoped(c, shopId, true);
    return c.json(
      await saveShopOffer(deps.db, { shopId, sku, expectedVersion: null, changes, ...actor }),
      200,
    );
  });
  app.openapi(r.patch, async (c) => {
    const { shopId, sku } = c.req.valid('param');
    const { version, ...changes } = c.req.valid('json');
    const actor = await scoped(c, shopId, true);
    return c.json(
      await saveShopOffer(deps.db, { shopId, sku, expectedVersion: version, changes, ...actor }),
      200,
    );
  });
}

/**
 * Staff offers under `/admin/shops/{shopId}/inventory`, registered on the admin shop router (which owns the
 * `/admin/shops/*` middleware): reading needs `partners:read` in the shop's city, changing needs `partners:write`.
 */
export function registerAdminShopInventory(app: OpenAPIHono<AppEnv>, deps: AppDeps) {
  registerInventory(app, deps, '/admin/shops', 'admin', async (c, shopId, write) => {
    const grants = c.get('auth').grants;
    await shopInStaffScope(
      deps.db,
      shopId,
      cityScopeFrom(grants, write ? 'partners:write' : 'partners:read'),
    );
    return { actorUserId: c.get('auth').user.id, actorRole: 'staff' };
  });
}

const myShops = createRoute({
  method: 'get',
  path: '/shop/me',
  tags: ['shop'],
  summary: 'Your shop(s): name, standing (paused/suspended with the reason), hours, coverage summary',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(MyShops.openapi('MyShops'), 'Shops'), ...errorResponses },
});

const ownHours = createRoute({
  method: 'put',
  path: '/shop/hours/{shopId}',
  tags: ['shop'],
  summary: 'The owner sets the working hours (IST); routing suggests open shops first',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: { required: true, content: { 'application/json': { schema: OwnShopHoursSchema } } },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Saved'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    ...errorResponses,
  },
});

export function shopInventoryRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const prefix of ['/shops/*', '/shop/me', '/shop/hours/*']) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
  }
  app.use('/shops/*', requirePermission('inventory:write'));
  app.use('/shop/me', requirePermission('orders:read'));
  app.use('/shop/hours/*', requirePermission('inventory:write'));

  registerInventory(app, deps, '/shops', 'shop', (c, shopId) => {
    if (!shopIdsFrom(c.get('auth').grants, 'inventory:write').includes(shopId))
      return Promise.reject(new NotFoundError('Shop not found'));
    return Promise.resolve({ actorUserId: c.get('auth').user.id, actorRole: 'shop' });
  });

  return app
    .openapi(myShops, async (c) => {
      const grants = c.get('auth').grants;
      const owned = new Set(grants.filter((g) => g.role === 'seller_owner').map((g) => g.shopId));
      const shops = await getMyShops(deps.db, shopIdsFrom(grants, 'orders:read'));
      return c.json({ shops: shops.map((s) => ({ ...s, isOwner: owned.has(s.id) })) }, 200);
    })
    .openapi(ownHours, async (c) => {
      const { shopId } = c.req.valid('param');
      const grants = c.get('auth').grants;
      if (!shopIdsFrom(grants, 'inventory:write').includes(shopId)) throw new NotFoundError('Shop not found');
      // Shop staff see the hours; only the owner changes them (user 2026-11-14).
      if (!grants.some((g) => g.role === 'seller_owner' && g.shopId === shopId))
        throw Forbidden('OWNER_ONLY', 'Only the shop owner changes the working hours');
      const b = c.req.valid('json');
      return c.json(
        await setOwnShopHours(deps.db, {
          shopId,
          userId: c.get('auth').user.id,
          expectedVersion: b.version,
          hours: b.hours,
        }),
        200,
      );
    });
}
