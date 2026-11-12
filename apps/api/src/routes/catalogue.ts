import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import {
  CATALOGUE_PAGE_MAX,
  CATALOGUE_QUERY_MAX,
  CATALOGUE_SORTS,
  getCatalogueProduct,
  listCatalogue,
  listCatalogueCategories,
} from '@mechdost/db/repo';
import {
  CatalogueCategorySchema,
  CataloguePageSchema,
  CATALOGUE_SLUG_RE,
  CatalogueProductSchema,
} from '@mechdost/shared/catalogue';
import { rateLimit } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Public catalogue reads (spec 02). No sign-in; per-IP limits (global 600/min + 240/min for listings and search).
 * Responses are the same for everyone with the same URL, so CDNs may cache them briefly (prices follow stock
 * within 30 s; spec 16). Localised by `locale` (hard rule 10): Hindi fields with the English fallback.
 */
export const CATALOGUE_RATE: RateRule = { name: 'catalogue_ip', limit: 240, windowSeconds: 60 };
const LIST_CACHE = 'public, max-age=30, stale-while-revalidate=120';
const CATEGORY_CACHE = 'public, max-age=300, stale-while-revalidate=600';

const Locale = z.enum(['en', 'hi']).default('en');
const City = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .optional()
  .openapi({ example: 'RPR' });
const Pincode = z
  .string()
  .regex(/^[1-9][0-9]{5}$/)
  .optional()
  .openapi({ example: '492001' });
const Slug = z.string().regex(CATALOGUE_SLUG_RE);

// The DTOs live in @mechdost/shared/catalogue (one definition for API and web); importing @hono/zod-openapi
// first gives them `.openapi()` for the component names.
const Page = CataloguePageSchema.openapi('CataloguePage');
const Product = CatalogueProductSchema.openapi('CatalogueProduct');
const Category = CatalogueCategorySchema.openapi('CatalogueCategory');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const categories = createRoute({
  method: 'get',
  path: '/catalogue/categories',
  tags: ['catalogue'],
  summary: 'Visible categories in admin order, with live product counts',
  request: { query: z.object({ locale: Locale }) },
  responses: { 200: json(z.object({ categories: z.array(Category) }), 'Categories'), ...errorResponses },
});

const products = createRoute({
  method: 'get',
  path: '/catalogue/products',
  tags: ['catalogue'],
  summary: 'Live products: search, filters, price for a PIN (nearest covering shop) or "From ₹" for the city',
  request: {
    query: z.object({
      city: City,
      pincode: Pincode,
      category: Slug.optional(),
      brand: Slug.optional(),
      /** Only products tagged for this vehicle type (decision 2026-11-12). */
      vehicle: z.enum(VEHICLE_TYPES).optional(),
      q: z.string().trim().max(CATALOGUE_QUERY_MAX).optional(),
      sort: z.enum(CATALOGUE_SORTS).optional(),
      available: z.enum(['true', 'false']).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(CATALOGUE_PAGE_MAX).optional(),
      locale: Locale,
    }),
  },
  responses: {
    200: json(Page, 'One page of products'),
    404: json(ErrorSchema, 'Unknown city'),
    422: json(ErrorSchema, 'Invalid cursor'),
    ...errorResponses,
  },
});

const product = createRoute({
  method: 'get',
  path: '/catalogue/products/{slug}',
  tags: ['catalogue'],
  summary: 'A live product with each variant’s best offer for the PIN (or city) and its seller',
  request: {
    params: z.object({
      slug: Slug.openapi({ param: { name: 'slug', in: 'path' }, example: 'exide-xltz4a' }),
    }),
    query: z.object({ city: City, pincode: Pincode, locale: Locale }),
  },
  responses: { 200: json(Product, 'Product'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

export function catalogueRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/catalogue/products',
    rateLimit(deps.rateLimiter, CATALOGUE_RATE, (c) => c.get('clientIp')),
  );
  const city = (code: string | undefined) => code ?? deps.config.defaultCityCode;
  const place = ({
    cityCode,
    pincode,
    pincodeKnown,
  }: {
    cityCode: string;
    pincode: string | null;
    pincodeKnown: boolean | null;
  }) => ({
    cityCode,
    pincode,
    pincodeKnown,
  });

  return app
    .openapi(categories, async (c) => {
      const rows = await listCatalogueCategories(deps.db, c.req.valid('query').locale);
      c.header('Cache-Control', CATEGORY_CACHE);
      return c.json({ categories: rows }, 200);
    })
    .openapi(products, async (c) => {
      const query = c.req.valid('query');
      const page = await listCatalogue(deps.db, {
        cityCode: city(query.city),
        pincode: query.pincode ?? null,
        category: query.category ?? null,
        brand: query.brand ?? null,
        vehicleType: query.vehicle ?? null,
        q: query.q ?? null,
        sort: query.sort ?? null,
        availableOnly: query.available === 'true',
        cursor: query.cursor ?? null,
        limit: query.limit,
        locale: query.locale,
      });
      c.header('Cache-Control', LIST_CACHE);
      return c.json(
        {
          place: place(page.place),
          items: page.items.map(({ id: _id, ...card }) => card),
          nextCursor: page.nextCursor,
        },
        200,
      );
    })
    .openapi(product, async (c) => {
      const query = c.req.valid('query');
      const {
        id: _id,
        place: where,
        ...rest
      } = await getCatalogueProduct(deps.db, c.req.valid('param').slug, {
        cityCode: city(query.city),
        pincode: query.pincode ?? null,
        locale: query.locale,
      });
      c.header('Cache-Control', LIST_CACHE);
      return c.json({ ...rest, place: place(where) }, 200);
    });
}
