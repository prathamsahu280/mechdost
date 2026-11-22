import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { clearPinPrice, getPriceBoard, setAdminPrice } from '@mechdost/db/repo';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin customer prices (design `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md`, Q26):
 * verified staff with `prices:write` read the price board (city price, PIN overrides, shop suggestions) and set or
 * clear prices. Rule failures (above MRP, below what a shop is paid, no shop) are 422 with the rule's code; a
 * stale version is 409 `STALE_PRICE`. Strict bodies; money in integer paise.
 */
const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
  .openapi({ param: { name: 'slug', in: 'path' }, example: 'castrol-activ-4t-20w40-900ml' });
const Sku = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/)
  .openapi({ param: { name: 'sku', in: 'path' }, example: 'CAS-ACT4T-0900' });
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const Pincode = z.string().regex(/^[1-9][0-9]{5}$/);
const Ref = z.object({ pricePaise: z.number().int(), version: z.number().int() });

const Board = z
  .object({
    productSlug: z.string(),
    cityCode: z.string(),
    variants: z.array(
      z.object({
        sku: z.string(),
        mrpPaise: z.number().int().nullable(),
        city: Ref.nullable(),
        pins: z.array(
          z.object({
            pincode: z.string(),
            override: Ref.nullable(),
            nearestShopPaise: z.number().int().nullable(),
            lowestShopPaise: z.number().int().nullable(),
            highestShopPaise: z.number().int().nullable(),
          }),
        ),
      }),
    ),
  })
  .openapi('AdminPriceBoard');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});
const failures = {
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Changed meanwhile'),
  422: json(ErrorSchema, 'Price rule failed'),
};

const board = createRoute({
  method: 'get',
  path: '/admin/prices/products/{slug}',
  tags: ['admin'],
  summary: 'Price board for a product in a city: city price, PIN overrides and shop suggestions',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ slug: Slug }), query: z.object({ city: CityCode }) },
  responses: { 200: json(Board, 'Price board'), ...failures, ...errorResponses },
});

const setPrice = createRoute({
  method: 'put',
  path: '/admin/prices/{sku}',
  tags: ['admin'],
  summary: 'Set the city price (pincode null) or a PIN override; version null creates it',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ sku: Sku }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              city: CityCode,
              pincode: Pincode.nullable(),
              pricePaise: z.number().int().min(1).max(100_000_000),
              version: z.number().int().min(1).nullable(),
            })
            .strict()
            .openapi('AdminPriceSet'),
        },
      },
    },
  },
  responses: { 200: json(z.object({ version: z.number().int() }), 'Saved'), ...failures, ...errorResponses },
});

const clearPin = createRoute({
  method: 'delete',
  path: '/admin/prices/{sku}/pins/{pincode}',
  tags: ['admin'],
  summary: 'Remove a PIN override (the PIN then follows the city price)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ sku: Sku, pincode: Pincode.openapi({ param: { name: 'pincode', in: 'path' } }) }),
    query: z.object({ city: CityCode, version: z.coerce.number().int().min(1) }),
  },
  responses: { 204: { description: 'Removed' }, ...failures, ...errorResponses },
});

export function adminPriceRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/prices/*'; // one pattern per prefix (L54)
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('prices:write'));

  return app
    .openapi(board, async (c) => {
      const r = await getPriceBoard(deps.db, {
        productSlug: c.req.valid('param').slug,
        cityCode: c.req.valid('query').city,
      });
      return c.json(r, 200);
    })
    .openapi(setPrice, async (c) => {
      const b = c.req.valid('json');
      const r = await setAdminPrice(deps.db, {
        sku: c.req.valid('param').sku,
        cityCode: b.city,
        pincode: b.pincode,
        pricePaise: b.pricePaise,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(clearPin, async (c) => {
      const p = c.req.valid('param');
      const q = c.req.valid('query');
      await clearPinPrice(deps.db, {
        sku: p.sku,
        cityCode: q.city,
        pincode: p.pincode,
        expectedVersion: q.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.body(null, 204);
    });
}
