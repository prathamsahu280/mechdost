import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  cityIdByCode,
  cityScopeFrom,
  couponUsageReport,
  createCoupon,
  listPublicOffers,
  decideShopOffer,
  listCoupons,
  listShopOffers,
  NotFoundError,
  previewCoupon,
  setCouponPaused,
  shopIdsFrom,
  updateCoupon,
} from '@mechdost/db/repo';
import {
  AdminCouponDto,
  AdminCouponListDto,
  CouponInputSchema,
  CouponPauseBodySchema,
  CouponPreviewDto,
  CouponUpdateBodySchema,
  CouponUsageReportDto,
  PublicOffersDto,
  ShopOfferDecidedDto,
  ShopOfferDecisionBodySchema,
  ShopOffersDto,
} from '@mechdost/shared/coupon-api';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import {
  authenticate,
  forbidSellers,
  requireCustomerVerified,
  requirePermission,
  requireVerified,
} from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Coupons (spec 03 / 07 / 08, design 2026-11-15). Three surfaces, three permissions:
 * - the customer checks a code on their cart before applying (`POST /checkout/coupon`, signed in, verified; limited
 *   per user and per IP so codes cannot be guessed; nothing is counted until the order is placed);
 * - staff with `coupons:write` create, edit, pause and resume (`/admin/coupons`; city scope from the grant);
 * - the shop owner reads and decides the offers it is asked to fund (`/shop/offers/{shopId}`; another shop's is 404).
 * Bodies are strict; money is integer paise; the admin times are India wall-clock (`YYYY-MM-DDTHH:mm`).
 */
export const COUPON_CHECK_USER_RATE: RateRule = {
  name: 'coupon_check_user',
  limit: 30,
  windowSeconds: 3600,
  failClosed: true,
};
export const COUPON_CHECK_IP_RATE: RateRule = {
  name: 'coupon_check_ip',
  limit: 60,
  windowSeconds: 3600,
  failClosed: true,
};
/** The public offers list: generous (the web caches it), but a script cannot hammer the query. */
export const OFFERS_IP_RATE: RateRule = { name: 'offers_ip', limit: 120, windowSeconds: 60 };

const Pincode = z.string().regex(/^[1-9][0-9]{5}$/);
const Lines = z
  .array(
    z
      .object({ sku: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,47}$/), qty: z.number().int().min(1).max(99) })
      .strict(),
  )
  .min(1)
  .max(20)
  .refine((l) => new Set(l.map((x) => x.sku)).size === l.length, { message: 'Each product appears once' });

const CheckBody = z
  .object({
    /** Left out (or null) = ask only for the automatic offer this cart gets (2026-11-16). */
    code: z.string().trim().min(1).max(40).nullish(),
    pincode: Pincode,
    lines: Lines,
    locale: z.enum(['en', 'hi']).default('en'),
  })
  .strict()
  .openapi('CouponCheckRequest');

const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const ShopId = z.uuid().openapi({ param: { name: 'shopId', in: 'path' } });
const CouponId = z.uuid().openapi({ param: { name: 'couponId', in: 'path' } });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const notFound = { 404: json(ErrorSchema, 'Not found') };
const refused = {
  409: json(
    ErrorSchema,
    'Changed meanwhile (STALE_COUPON, STALE_OFFER) or the code is taken (COUPON_CODE_TAKEN)',
  ),
  422: json(ErrorSchema, 'A coupon rule failed (COUPON_RULE, COUPON_LOCKED, COUPON_SHOP)'),
};

const check = createRoute({
  method: 'post',
  path: '/checkout/coupon',
  tags: ['checkout'],
  summary: 'Check a coupon code on a cart: its conditions and the saving, or the reason it cannot be used',
  security: [{ bearerAuth: [] }],
  request: { body: body(CheckBody) },
  responses: { 200: json(CouponPreviewDto, 'Applicable, or refused with a reason code'), ...errorResponses },
});

const publicOffers = createRoute({
  method: 'get',
  path: '/offers',
  tags: ['public'],
  summary: 'Offers the admin made public for a city: live, in the page language (no sign-in)',
  request: {
    query: z.object({
      city: z.string().regex(/^[A-Z]{3}$/),
      locale: z.enum(['en', 'hi']).default('en'),
    }),
  },
  responses: { 200: json(PublicOffersDto, 'Offers (maybe none)'), ...notFound, ...errorResponses },
});

const adminUsage = createRoute({
  method: 'get',
  path: '/admin/coupons/{id}/usage',
  tags: ['admin'],
  summary:
    "One coupon's use: orders, released uses, discount given, unique customers and IST days (newest first)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: Id }),
    query: z.object({
      cursor: z.string().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(92).optional(),
    }),
  },
  responses: { 200: json(CouponUsageReportDto, 'Usage'), ...notFound, ...errorResponses },
});

const adminList = createRoute({
  method: 'get',
  path: '/admin/coupons',
  tags: ['admin'],
  summary: 'Coupons in your cities, newest first',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      cursor: z.string().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: { 200: json(AdminCouponListDto, 'Coupons'), ...errorResponses },
});

const adminCreate = createRoute({
  method: 'post',
  path: '/admin/coupons',
  tags: ['admin'],
  summary: 'Create a coupon (MechDost-funded, or shop-funded which waits for the shop to accept)',
  security: [{ bearerAuth: [] }],
  request: { body: body(CouponInputSchema) },
  responses: { 201: json(AdminCouponDto, 'Created'), ...notFound, ...refused, ...errorResponses },
});

const adminUpdate = createRoute({
  method: 'put',
  path: '/admin/coupons/{id}',
  tags: ['admin'],
  summary:
    'Edit a coupon (version check; a shop-funded one is sent back to its shop when its money terms change)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: Id }), body: body(CouponUpdateBodySchema) },
  responses: { 200: json(AdminCouponDto, 'Saved'), ...notFound, ...refused, ...errorResponses },
});

const adminPause = createRoute({
  method: 'post',
  path: '/admin/coupons/{id}/pause',
  tags: ['admin'],
  summary: 'Pause (with a reason) or resume a coupon',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: Id }), body: body(CouponPauseBodySchema) },
  responses: { 200: json(AdminCouponDto, 'Saved'), ...notFound, ...refused, ...errorResponses },
});

const shopList = createRoute({
  method: 'get',
  path: '/shop/offers/{shopId}',
  tags: ['shop'],
  summary: 'Offers you are asked to fund (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId }) },
  responses: { 200: json(ShopOffersDto, 'Offers'), ...notFound, ...errorResponses },
});

const shopDecide = createRoute({
  method: 'post',
  path: '/shop/offers/{shopId}/{couponId}/decision',
  tags: ['shop'],
  summary: 'Accept or decline the terms of an offer you fund (the version is the one you were shown)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId, couponId: CouponId }),
    body: body(ShopOfferDecisionBodySchema),
  },
  responses: {
    200: json(ShopOfferDecidedDto, 'Decided'),
    ...notFound,
    ...refused,
    ...errorResponses,
  },
});

export function couponRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  // Public offers list: anonymous, so an IP limit (cheap) before any query; cacheable at the edge.
  app.use(
    '/offers',
    rateLimit(deps.rateLimiter, OFFERS_IP_RATE, (c) => c.get('clientIp')),
  );

  // Customer: one pattern per prefix (L54). Anonymous IP limit first (cheap), then sign-in, then the per-user limit.
  app.use(
    '/checkout/coupon',
    rateLimit(deps.rateLimiter, COUPON_CHECK_IP_RATE, (c) => c.get('clientIp')),
  );
  app.use('/checkout/coupon', authenticate(deps, cache));
  app.use(
    '/checkout/coupon',
    rateLimit(deps.rateLimiter, COUPON_CHECK_USER_RATE, (c) => c.get('auth').user.id),
  );
  app.use('/checkout/coupon', forbidSellers);
  app.use('/checkout/coupon', requireCustomerVerified(deps));
  app.use('/checkout/coupon', requirePermission('orders:place'));

  for (const prefix of ['/admin/coupons', '/admin/coupons/*']) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
    app.use(prefix, requirePermission('coupons:write'));
  }

  app.use('/shop/offers/*', authenticate(deps, cache));
  app.use(
    '/shop/offers/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/shop/offers/*', requireVerified);
  app.use('/shop/offers/*', requirePermission('inventory:write'));

  const scopeOf = (c: Context<AppEnv>) => cityScopeFrom(c.get('auth').grants, 'coupons:write');

  /** The shops the caller owns; a shop outside the caller's grants is 404, a staff member of it is 403. */
  function owned(c: Context<AppEnv>, shopId: string): string[] {
    const grants = c.get('auth').grants;
    if (!shopIdsFrom(grants, 'inventory:write').includes(shopId)) throw new NotFoundError('Shop not found');
    const ids = grants.filter((g) => g.role === 'seller_owner' && g.shopId !== null).map((g) => g.shopId);
    if (!ids.includes(shopId)) throw Forbidden('OWNER_ONLY', 'Only the shop owner can do this');
    return ids.filter((id): id is string => id !== null);
  }

  return app
    .openapi(check, async (c) => {
      const b = c.req.valid('json');
      const r = await previewCoupon(deps.db, {
        userId: c.get('auth').user.id,
        code: b.code ?? null,
        pincode: b.pincode,
        lines: b.lines,
        locale: b.locale,
      });
      return c.json(r, 200);
    })
    .openapi(publicOffers, async (c) => {
      const q = c.req.valid('query');
      const offers = await listPublicOffers(deps.db, {
        cityId: await cityIdByCode(deps.db, q.city),
        locale: q.locale,
      });
      // Short shared cache: an offer ending or a pause shows within a minute; never personal data.
      c.header('Cache-Control', 'public, max-age=30, s-maxage=60');
      return c.json({ offers }, 200);
    })
    .openapi(adminUsage, async (c) => {
      const q = c.req.valid('query');
      return c.json(
        await couponUsageReport(deps.db, {
          scope: scopeOf(c),
          couponId: c.req.valid('param').id,
          staffUserId: c.get('auth').user.id,
          cursor: q.cursor ?? null,
          ...(q.limit ? { limit: q.limit } : {}),
        }),
        200,
      );
    })
    .openapi(adminList, async (c) =>
      c.json(await listCoupons(deps.db, { scope: scopeOf(c), ...c.req.valid('query') }), 200),
    )
    .openapi(adminCreate, async (c) =>
      c.json(
        await createCoupon(deps.db, {
          staffUserId: c.get('auth').user.id,
          scope: scopeOf(c),
          coupon: c.req.valid('json'),
        }),
        201,
      ),
    )
    .openapi(adminUpdate, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await updateCoupon(deps.db, {
          couponId: c.req.valid('param').id,
          expectedVersion: b.version,
          staffUserId: c.get('auth').user.id,
          scope: scopeOf(c),
          coupon: b.coupon,
        }),
        200,
      );
    })
    .openapi(adminPause, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await setCouponPaused(deps.db, {
          couponId: c.req.valid('param').id,
          paused: b.paused,
          reason: b.reason,
          expectedVersion: b.version,
          staffUserId: c.get('auth').user.id,
          scope: scopeOf(c),
        }),
        200,
      );
    })
    .openapi(shopList, async (c) => {
      const { shopId } = c.req.valid('param');
      return c.json(
        { offers: await listShopOffers(deps.db, { shopId, ownedShopIds: owned(c, shopId) }) },
        200,
      );
    })
    .openapi(shopDecide, async (c) => {
      const { shopId, couponId } = c.req.valid('param');
      const b = c.req.valid('json');
      return c.json(
        await decideShopOffer(deps.db, {
          shopId,
          ownedShopIds: owned(c, shopId),
          couponId,
          decision: b.decision,
          expectedVersion: b.version,
          userId: c.get('auth').user.id,
        }),
        200,
      );
    });
}
