import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  clearCitySetting,
  listOperationalSettings,
  NotFoundError,
  saveOperationalSetting,
} from '@mechdost/db/repo';
import { SETTING_KEYS } from '@mechdost/shared/settings';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin settings (hard rule 8; registry `@mechdost/shared/settings`): verified staff; `settings:read` to see,
 * `settings:write` to change. A city override needs a grant covering that city; a global value needs an
 * all-cities grant (otherwise 404, like other out-of-scope targets).
 */
const Key = z
  .enum(SETTING_KEYS)
  .openapi({ param: { name: 'key', in: 'path' }, example: 'orders.acceptance_timeout_min' });
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const Value = z.union([z.number().int(), z.boolean(), z.null()]);
const Row = z
  .object({
    key: z.string(),
    default: Value,
    global: z.object({ value: Value, version: z.number().int() }).nullable(),
    city: z.object({ value: Value, version: z.number().int() }).nullable(),
    effective: Value,
  })
  .openapi('AdminSetting');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const list = createRoute({
  method: 'get',
  path: '/admin/settings',
  tags: ['admin'],
  summary: 'Operational settings: default, global value, city override and the value in effect',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ city: CityCode.optional() }) },
  responses: { 200: json(z.object({ settings: z.array(Row) }), 'Settings'), ...errorResponses },
});

const save = createRoute({
  method: 'put',
  path: '/admin/settings/{key}',
  tags: ['admin'],
  summary: 'Set the global value or a city override (compare-and-set; version null to create)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ key: Key }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({ city: CityCode.nullable(), value: Value, version: z.number().int().min(1).nullable() })
            .strict()
            .openapi('AdminSettingSave'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Saved'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    422: json(ErrorSchema, 'SETTING_TYPE / SETTING_RANGE'),
    ...errorResponses,
  },
});

const clear = createRoute({
  method: 'post',
  path: '/admin/settings/{key}/clear',
  tags: ['admin'],
  summary: 'Remove a city override (the global value applies again)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ key: Key }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({ city: CityCode, version: z.number().int().min(1) })
            .strict()
            .openapi('AdminSettingClear'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ ok: z.literal(true) }), 'Cleared'),
    404: json(ErrorSchema, 'Out of scope'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    ...errorResponses,
  },
});

export function adminSettingsRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/settings/*'; // one pattern per prefix (L54)
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('settings:read'));
  app.on(['PUT', 'POST'], prefix, requirePermission('settings:write'));

  return app
    .openapi(list, async (c) => {
      const cityId = await scopedCity(deps, c, c.req.valid('query').city, 'settings:read');
      const rows = await listOperationalSettings(deps.db, cityId);
      return c.json({ settings: rows.map((r) => Row.parse(r)) }, 200);
    })
    .openapi(save, async (c) => {
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'settings:write');
      const r = await saveOperationalSetting(deps.db, {
        key: c.req.valid('param').key,
        cityId,
        value: b.value,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(clear, async (c) => {
      const b = c.req.valid('json');
      const cityId = await scopedCity(deps, c, b.city, 'settings:write');
      if (!cityId) throw new NotFoundError('City not found');
      await clearCitySetting(deps.db, {
        key: c.req.valid('param').key,
        cityId,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ ok: true as const }, 200);
    });
}
