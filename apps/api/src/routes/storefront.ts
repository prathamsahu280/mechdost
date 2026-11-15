import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  addCartLine,
  getCart,
  getCartIfChanged,
  getWishlistIfChanged,
  mergeCart,
  removeCartLine,
  setCartLine,
  setWishlisted,
} from '@mechdost/db/repo';
import {
  CART_SKU_RE,
  CartDto,
  CartLineQtyBody,
  CartMergeBody,
  CartUnchangedDto,
} from '@mechdost/shared/cart-api';
import {
  PRODUCT_SLUG_RE,
  WishlistChangeDto,
  WishlistDto,
  WishlistUnchangedDto,
} from '@mechdost/shared/wishlist-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * The signed-in customer's server cart and wishlist (spec 03 "Server cart", spec 02 "Wishlist", design 2026-11-15
 * items 3 and 5). No id is ever in a URL: the customer is the session, so another customer's cart or list cannot be
 * named (a foreign id is not a thing, and the usual 404 test is "the other customer's data never appears"). Bodies are
 * strict (a price field is a 400: the cart holds a SKU and a quantity, and prices come from the checkout quote).
 * Writes are limited per customer (spec 13). Real sign-in mode only: the demo build keeps its browser cart.
 */
export const CART_WRITE_RATE: RateRule = { name: 'cart_write', limit: 240, windowSeconds: 3600 };
export const CART_MERGE_RATE: RateRule = { name: 'cart_merge', limit: 20, windowSeconds: 3600 };
export const WISHLIST_WRITE_RATE: RateRule = { name: 'wishlist_write', limit: 240, windowSeconds: 3600 };

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});
const problems = {
  404: json(ErrorSchema, 'Not found'),
  422: json(ErrorSchema, 'A rule was not met (the wishlist is full)'),
  ...errorResponses,
};
const localeQuery = z.object({ locale: z.enum(['en', 'hi']).optional() });
/** `since` = the version the caller already holds: an unchanged cart or list answers with no body worth sending. */
const refreshQuery = localeQuery.extend({ since: z.coerce.number().int().min(0).optional() });
const Sku = z
  .string()
  .regex(CART_SKU_RE)
  .openapi({ param: { name: 'sku', in: 'path' } });
const Slug = z
  .string()
  .regex(PRODUCT_SLUG_RE)
  .openapi({ param: { name: 'slug', in: 'path' } });
const tags = ['storefront'];
const security = [{ bearerAuth: [] }];

const cartGet = createRoute({
  method: 'get',
  path: '/me/cart',
  tags,
  summary:
    'Your saved cart (lines that are no longer sold are removed and reported). With ?since=<version>: { unchanged: true } when it has not changed',
  security,
  request: { query: refreshQuery },
  responses: { 200: json(CartDto.or(CartUnchangedDto), 'Cart'), ...errorResponses },
});
const lineParams = { params: z.object({ sku: Sku }), query: localeQuery };
const cartAdd = createRoute({
  method: 'post',
  path: '/me/cart/lines/{sku}/add',
  tags,
  summary: 'Add to a line (adds from two devices sum; the line stops at 99; up to 20 lines)',
  security,
  request: { ...lineParams, ...body(CartLineQtyBody) },
  responses: {
    200: json(CartDto, 'Cart'),
    422: json(ErrorSchema, 'Not available, or the cart is full'),
    ...errorResponses,
  },
});
const cartSet = createRoute({
  method: 'put',
  path: '/me/cart/lines/{sku}',
  tags,
  summary: "Set a line's quantity (last write wins for this line only; other lines are untouched)",
  security,
  request: { ...lineParams, ...body(CartLineQtyBody) },
  responses: {
    200: json(CartDto, 'Cart'),
    422: json(ErrorSchema, 'Not available, or the cart is full'),
    ...errorResponses,
  },
});
const cartRemove = createRoute({
  method: 'delete',
  path: '/me/cart/lines/{sku}',
  tags,
  summary: 'Remove a line (removing what is not there changes nothing)',
  security,
  request: lineParams,
  responses: { 200: json(CartDto, 'Cart'), ...errorResponses },
});
const cartMerge = createRoute({
  method: 'post',
  path: '/me/cart/merge',
  tags,
  summary: 'Fold the guest cart into your saved cart at sign-in (larger quantity wins; safe to repeat)',
  security,
  request: { query: localeQuery, ...body(CartMergeBody) },
  responses: { 200: json(CartDto, 'Cart'), ...errorResponses },
});
const wishlistGet = createRoute({
  method: 'get',
  path: '/me/wishlist',
  tags,
  summary: 'Your wishlist, newest first. With ?since=<version>: { unchanged: true } when it has not changed',
  security,
  request: { query: refreshQuery },
  responses: { 200: json(WishlistDto.or(WishlistUnchangedDto), 'Wishlist'), ...errorResponses },
});
const wishlistAdd = createRoute({
  method: 'put',
  path: '/me/wishlist/{slug}',
  tags,
  summary: 'Add a product (up to 100; adding it again changes nothing)',
  security,
  request: { params: z.object({ slug: Slug }) },
  responses: { 200: json(WishlistChangeDto, 'Saved'), ...problems },
});
const wishlistRemove = createRoute({
  method: 'delete',
  path: '/me/wishlist/{slug}',
  tags,
  summary: 'Remove a product (removing it again changes nothing)',
  security,
  request: { params: z.object({ slug: Slug }) },
  responses: { 200: json(WishlistChangeDto, 'Saved'), ...problems },
});

export function storefrontRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern per prefix (L171): '/me/cart/*' also matches '/me/cart'.
  for (const path of ['/me/cart/*', '/me/wishlist/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  const user = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.on(
    ['POST', 'PUT', 'DELETE'],
    '/me/cart/lines/:sku',
    rateLimit(deps.rateLimiter, CART_WRITE_RATE, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/me/cart/lines/:sku/add',
    rateLimit(deps.rateLimiter, CART_WRITE_RATE, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/me/cart/merge',
    rateLimit(deps.rateLimiter, CART_MERGE_RATE, (c) => c.get('auth').user.id),
  );
  app.on(
    ['PUT', 'DELETE'],
    '/me/wishlist/:slug',
    rateLimit(deps.rateLimiter, WISHLIST_WRITE_RATE, (c) => c.get('auth').user.id),
  );
  const localeOf = (c: Context<AppEnv>, asked?: 'en' | 'hi') =>
    asked ?? (c.get('auth').user.language === 'hi' ? 'hi' : 'en');

  return app
    .openapi(cartGet, async (c) => {
      const { locale, since } = c.req.valid('query');
      const loc = localeOf(c, locale);
      return c.json(
        since === undefined
          ? await getCart(deps.db, user(c), loc)
          : await getCartIfChanged(deps.db, user(c), loc, since),
        200,
      );
    })
    .openapi(cartAdd, async (c) =>
      c.json(
        await addCartLine(
          deps.db,
          user(c),
          c.req.valid('param').sku,
          c.req.valid('json').qty,
          localeOf(c, c.req.valid('query').locale),
        ),
        200,
      ),
    )
    .openapi(cartSet, async (c) =>
      c.json(
        await setCartLine(
          deps.db,
          user(c),
          c.req.valid('param').sku,
          c.req.valid('json').qty,
          localeOf(c, c.req.valid('query').locale),
        ),
        200,
      ),
    )
    .openapi(cartRemove, async (c) =>
      c.json(
        await removeCartLine(
          deps.db,
          user(c),
          c.req.valid('param').sku,
          localeOf(c, c.req.valid('query').locale),
        ),
        200,
      ),
    )
    .openapi(cartMerge, async (c) => {
      const r = await mergeCart(
        deps.db,
        user(c),
        c.req.valid('json').lines,
        localeOf(c, c.req.valid('query').locale),
      );
      return c.json(r.cart, 200);
    })
    .openapi(wishlistGet, async (c) => {
      const { locale, since } = c.req.valid('query');
      return c.json(await getWishlistIfChanged(deps.db, user(c), localeOf(c, locale), since ?? -1), 200);
    })
    .openapi(wishlistAdd, async (c) =>
      c.json(await setWishlisted(deps.db, user(c), c.req.valid('param').slug, true), 200),
    )
    .openapi(wishlistRemove, async (c) =>
      c.json(await setWishlisted(deps.db, user(c), c.req.valid('param').slug, false), 200),
    );
}
