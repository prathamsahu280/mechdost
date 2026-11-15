import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityIdByCode,
  getCompany,
  getHomeLayout,
  getHomeLayoutForAdmin,
  resetHomeLayout,
  saveCompany,
  saveHomeLayout,
} from '@mechdost/db/repo';
import { COMPANY_FIELDS, COMPANY_MAX, type CompanyField } from '@mechdost/shared/company';
import { HOME_CATEGORY_KEYS, HOME_SECTIONS, MAP_MODES } from '@mechdost/shared/site-layout';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { revalidateWeb } from '../revalidate';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Two whole-site documents the admin edits (design 2026-11-15 items 6 and 8; repo `site-config.ts`):
 * - the home layout: public `GET /site/home-layout?city=` (cacheable); admin read with `content:write`, save and
 *   reset with `content:publish` (it is live at once); a global layout needs an all-cities grant, a city's a grant
 *   covering it (otherwise 404);
 * - the company details: public `GET /company` (only the filled fields; the law wants them shown); admin read with
 *   `settings:read`, save with `settings:write`, all-cities grant only (the legal entity belongs to no city).
 * Both refresh the website's cache by tag after a save.
 */
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const Layout = z
  .object({
    order: z.array(z.enum(HOME_SECTIONS)).max(HOME_SECTIONS.length),
    hidden: z.array(z.enum(HOME_SECTIONS)).max(HOME_SECTIONS.length),
    featured: z.array(z.enum(HOME_CATEGORY_KEYS)).max(HOME_CATEGORY_KEYS.length).nullable(),
    emoji: z.partialRecord(z.enum(HOME_CATEGORY_KEYS), z.string().max(16)),
    mapDefault: z.enum(MAP_MODES),
  })
  .strict()
  .openapi('HomeLayout');

const Company = z
  .object(
    Object.fromEntries(COMPANY_FIELDS.map((f) => [f, z.string().max(COMPANY_MAX[f])])) as Record<
      CompanyField,
      z.ZodString
    >,
  )
  .partial()
  .strict()
  .openapi('CompanyDetails');
const CompanyOut = z.record(z.string(), z.string());

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const publicLayout = createRoute({
  method: 'get',
  path: '/site/home-layout',
  tags: ['content'],
  summary: 'The home layout for a city (its own, else the global one, else the default)',
  request: { query: z.object({ city: CityCode.optional() }) },
  responses: { 200: json(z.object({ layout: Layout }), 'Layout'), ...errorResponses },
});

const publicCompany = createRoute({
  method: 'get',
  path: '/company',
  tags: ['content'],
  summary: 'The company details that are filled in (legal name, CIN, GSTIN, address, grievance officer)',
  responses: { 200: json(z.object({ company: CompanyOut }), 'Company details'), ...errorResponses },
});

const adminLayout = createRoute({
  method: 'get',
  path: '/admin/site/layout',
  tags: ['admin'],
  summary: 'The layout of one scope for editing, with its version and whether a city only inherits it',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ city: CityCode.optional() }) },
  responses: {
    200: json(
      z.object({ layout: Layout, version: z.number().int().nullable(), inherited: z.boolean() }),
      'Layout',
    ),
    ...errorResponses,
  },
});

const saveLayout = createRoute({
  method: 'put',
  path: '/admin/site/layout',
  tags: ['admin'],
  summary: 'Save the layout (compare-and-set; version null creates). Live at once',
  security: [{ bearerAuth: [] }],
  request: body(
    z
      .object({ city: CityCode.nullable(), layout: Layout, version: z.number().int().min(1).nullable() })
      .strict()
      .openapi('AdminLayoutSave'),
  ),
  responses: {
    200: json(z.object({ version: z.number().int(), layout: Layout }), 'Saved'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'STALE_SETTING'),
    422: json(ErrorSchema, 'LAYOUT_INVALID (details.problem)'),
    ...errorResponses,
  },
});

const resetLayout = createRoute({
  method: 'post',
  path: '/admin/site/layout/reset',
  tags: ['admin'],
  summary:
    'Remove the saved layout of a scope (a city inherits the global one; the global one is the default)',
  security: [{ bearerAuth: [] }],
  request: body(
    z
      .object({ city: CityCode.nullable(), version: z.number().int().min(1) })
      .strict()
      .openapi('AdminLayoutReset'),
  ),
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Reset'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'STALE_SETTING'),
    ...errorResponses,
  },
});

const adminCompany = createRoute({
  method: 'get',
  path: '/admin/company',
  tags: ['admin'],
  summary: 'The company details with the version to save against',
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(
      z.object({ details: z.record(z.string(), z.string()), version: z.number().int().nullable() }),
      'Company',
    ),
    ...errorResponses,
  },
});

const saveCompanyRoute = createRoute({
  method: 'put',
  path: '/admin/company',
  tags: ['admin'],
  summary: 'Save the company details (compare-and-set; version null creates). An empty field is not shown',
  security: [{ bearerAuth: [] }],
  request: body(
    z
      .object({ details: Company, version: z.number().int().min(1).nullable() })
      .strict()
      .openapi('AdminCompanySave'),
  ),
  responses: {
    200: json(z.object({ version: z.number().int(), details: z.record(z.string(), z.string()) }), 'Saved'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'STALE_SETTING'),
    422: json(ErrorSchema, 'COMPANY_INVALID (details.field)'),
    ...errorResponses,
  },
});

/** Public reads: cacheable for a minute in browsers, five at the CDN. */
const cacheable = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

export function siteConfigPublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  return app
    .openapi(publicLayout, async (c) => {
      const code = c.req.valid('query').city;
      const cityId = code ? await cityIdByCode(deps.db, code) : null;
      const layout = await getHomeLayout(deps.db, cityId);
      c.header('Cache-Control', cacheable);
      return c.json({ layout }, 200);
    })
    .openapi(publicCompany, async (c) => {
      const { details } = await getCompany(deps.db);
      c.header('Cache-Control', cacheable);
      return c.json(
        { company: Object.fromEntries(Object.entries(details).filter(([, v]) => v !== '')) },
        200,
      );
    });
}

export function siteConfigAdminRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const guard = (
    prefix: string,
    read: 'content:write' | 'settings:read',
    write: 'content:publish' | 'settings:write',
  ) => {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
    app.use(prefix, requirePermission(read));
    app.on(['PUT', 'POST'], prefix, requirePermission(write));
  };
  guard('/admin/site/*', 'content:write', 'content:publish'); // one pattern per prefix (L54)
  guard('/admin/company/*', 'settings:read', 'settings:write');

  return app
    .openapi(adminLayout, async (c) => {
      const cityId = await scopedCity(deps, c, c.req.valid('query').city, 'content:write');
      return c.json(await getHomeLayoutForAdmin(deps.db, cityId), 200);
    })
    .openapi(saveLayout, async (c) => {
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'content:publish');
      const saved = await saveHomeLayout(deps.db, {
        cityId,
        layout: b.layout,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      await revalidateWeb(deps, ['site-layout']);
      return c.json(saved, 200);
    })
    .openapi(resetLayout, async (c) => {
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'content:publish');
      await resetHomeLayout(deps.db, {
        cityId,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      await revalidateWeb(deps, ['site-layout']);
      return c.json({ ok: true as const }, 200);
    })
    .openapi(adminCompany, async (c) => {
      await scopedCity(deps, c, null, 'settings:read'); // all-cities grant only
      return c.json(await getCompany(deps.db), 200);
    })
    .openapi(saveCompanyRoute, async (c) => {
      const b = c.req.valid('json');
      await scopedCity(deps, c, null, 'settings:write');
      const saved = await saveCompany(deps.db, {
        details: b.details,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      await revalidateWeb(deps, ['company']);
      return c.json(saved, 200);
    });
}
