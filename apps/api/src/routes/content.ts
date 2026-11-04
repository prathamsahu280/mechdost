import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityIdByCode,
  getPublishedContent,
  getPublishedPolicy,
  listContentForAdmin,
  publishContent,
  saveContentDraft,
  unpublishContent,
} from '@mechdost/db/repo';
import { CONTENT_KEYS, CONTENT_LOCALES } from '@mechdost/shared/content';
import { POLICY_KEYS, POLICY_LIMITS } from '@mechdost/shared/policy';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Site content (hard rule 8; spec 08 "Content"; registry `@mechdost/shared/content`).
 * Public: `GET /content?locale&city` — the published text (missing keys = use the locale-file default), cacheable.
 * Admin: verified staff; `content:write` to read and draft, `content:publish` to publish or unpublish. A global
 * text needs an all-cities grant, a city override a grant covering the city (otherwise 404).
 */
const Key = z
  .enum([...CONTENT_KEYS, ...POLICY_KEYS])
  .openapi({ param: { name: 'key', in: 'path' }, example: 'hero.titleLine1' });
// Shape only; the repository cleans and checks every field (`cleanPolicy`) and refuses with POLICY_INVALID.
const Policy = z
  .object({
    title: z.string().max(500),
    lead: z.string().max(1000),
    updatedOn: z.string().max(10),
    sections: z
      .array(
        z
          .object({
            heading: z.string().max(500),
            body: z.string().max(5000),
            emoji: z.string().max(16).optional(),
          })
          .strict(),
      )
      .max(POLICY_LIMITS.sections),
  })
  .strict()
  .openapi('PolicyDocument');
const Value = z.union([z.string(), Policy]);
const Locale = z.enum(CONTENT_LOCALES);
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});
const params = {
  params: z.object({ key: Key, locale: Locale.openapi({ param: { name: 'locale', in: 'path' } }) }),
};

const published = createRoute({
  method: 'get',
  path: '/content',
  tags: ['content'],
  summary: 'Published site text for a locale (and city); keys without text use the default',
  request: { query: z.object({ locale: Locale, city: CityCode.optional() }) },
  responses: {
    200: json(z.object({ content: z.record(z.string(), z.string()) }), 'Content'),
    ...errorResponses,
  },
});

const Entry = z
  .object({
    key: z.string(),
    locale: Locale,
    draft: z.object({ value: Value, version: z.number().int() }).nullable(),
    published: z
      .object({ value: Value, version: z.number().int(), publishedAt: z.string().nullable() })
      .nullable(),
  })
  .openapi('AdminContentEntry');

const policy = createRoute({
  method: 'get',
  path: '/content/policies/{key}',
  tags: ['content'],
  summary: 'A published policy page for a locale (and city); null = show the default text',
  request: {
    params: z.object({ key: z.enum(POLICY_KEYS).openapi({ param: { name: 'key', in: 'path' } }) }),
    query: z.object({ locale: Locale, city: CityCode.optional() }),
  },
  responses: { 200: json(z.object({ policy: Policy.nullable() }), 'Policy'), ...errorResponses },
});

const adminList = createRoute({
  method: 'get',
  path: '/admin/content',
  tags: ['admin'],
  summary: 'Every editable text with its draft and live version (global, or one city with ?city=)',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ city: CityCode.optional() }) },
  responses: { 200: json(z.object({ entries: z.array(Entry) }), 'Content'), ...errorResponses },
});

const saveDraft = createRoute({
  method: 'put',
  path: '/admin/content/{key}/{locale}',
  tags: ['admin'],
  summary: 'Save a draft (compare-and-set; version null creates it). Plain text, cleaned to the key limit',
  security: [{ bearerAuth: [] }],
  request: {
    ...params,
    ...body(
      z
        .object({
          city: CityCode.nullable(),
          value: z.union([z.string().max(2000), Policy]),
          version: z.number().int().min(1).nullable(),
        })
        .strict()
        .openapi('AdminContentDraft'),
    ),
  },
  responses: {
    200: json(z.object({ version: z.number().int(), value: Value }), 'Saved'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'STALE_CONTENT'),
    422: json(ErrorSchema, 'CONTENT_EMPTY, POLICY_INVALID (details.problem)'),
    ...errorResponses,
  },
});

const Versioned = z.object({ city: CityCode.nullable(), version: z.number().int().min(1) }).strict();

const publish = createRoute({
  method: 'post',
  path: '/admin/content/{key}/{locale}/publish',
  tags: ['admin'],
  summary: 'Publish the draft (its version): it replaces the live text',
  security: [{ bearerAuth: [] }],
  request: { ...params, ...body(Versioned.openapi('AdminContentPublish')) },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Published'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'STALE_CONTENT'),
    ...errorResponses,
  },
});

const unpublish = createRoute({
  method: 'post',
  path: '/admin/content/{key}/{locale}/unpublish',
  tags: ['admin'],
  summary: 'Take the live text down (its version): the default text shows again',
  security: [{ bearerAuth: [] }],
  request: { ...params, ...body(Versioned.openapi('AdminContentUnpublish')) },
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Unpublished'),
    404: json(ErrorSchema, 'Nothing published / out of scope'),
    409: json(ErrorSchema, 'STALE_CONTENT'),
    ...errorResponses,
  },
});

/** Public content: cacheable for a minute in browsers, five at the CDN (publishing shows within that window). */
export function contentRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const cacheable = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
  return app
    .openapi(published, async (c) => {
      const q = c.req.valid('query');
      const cityId = q.city ? await cityIdByCode(deps.db, q.city) : null;
      const content = await getPublishedContent(deps.db, { locale: q.locale, cityId });
      c.header('Cache-Control', cacheable);
      return c.json({ content }, 200);
    })
    .openapi(policy, async (c) => {
      const q = c.req.valid('query');
      const cityId = q.city ? await cityIdByCode(deps.db, q.city) : null;
      const doc = await getPublishedPolicy(deps.db, {
        key: c.req.valid('param').key,
        locale: q.locale,
        cityId,
      });
      c.header('Cache-Control', cacheable);
      return c.json({ policy: doc }, 200);
    });
}

export function adminContentRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/content/*'; // one pattern per prefix (L54)
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('content:write'));
  app.on('POST', prefix, requirePermission('content:publish'));

  return app
    .openapi(adminList, async (c) => {
      const cityId = await scopedCity(deps, c, c.req.valid('query').city, 'content:write');
      const entries = await listContentForAdmin(deps.db, cityId);
      return c.json(
        {
          entries: entries.map((e) => ({
            ...e,
            published: e.published
              ? { ...e.published, publishedAt: e.published.publishedAt?.toISOString() ?? null }
              : null,
          })),
        },
        200,
      );
    })
    .openapi(saveDraft, async (c) => {
      const { key, locale } = c.req.valid('param');
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'content:write');
      const saved = await saveContentDraft(deps.db, {
        key,
        locale,
        cityId,
        value: b.value,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(saved, 200);
    })
    .openapi(publish, async (c) => {
      const { key, locale } = c.req.valid('param');
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'content:publish');
      const live = await publishContent(deps.db, {
        key,
        locale,
        cityId,
        expectedDraftVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(live, 200);
    })
    .openapi(unpublish, async (c) => {
      const { key, locale } = c.req.valid('param');
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'content:publish');
      await unpublishContent(deps.db, {
        key,
        locale,
        cityId,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ ok: true as const }, 200);
    });
}
