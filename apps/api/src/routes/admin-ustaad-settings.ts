/**
 * Admin → Ustaad settings (spec 23 § 8 "Admin", § 15; SR-40). Verified staff in a staff session: `ustaad:settings`
 * or `ustaad:read` to see (a community manager reads), `ustaad:settings` (super admin) to change. Every save checks
 * the invariants server-side (422 SETTING_INVARIANT / SETTING_RELATION), compare-and-sets on `version` and is audited.
 * Workstream A uses it for the access switch (`ustaad.access`); workstream G1 builds the full screen on it and adds the
 * CRUD routes for levels, badges, tags, words, reasons, reach cities, promotions and the tutorial in this file.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { readUstaadSettings, saveUstaadSetting } from '@mechdost/db/repo';
import { can, type Grant } from '@mechdost/shared/rbac';
import { USTAAD_SETTINGS, USTAAD_SETTING_KEYS } from '@mechdost/shared/ustaad/settings';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { UstaadAccessCache } from '../middleware/ustaad-member';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';
import { json } from './service-schemas';

const Key = z
  .enum(USTAAD_SETTING_KEYS)
  .openapi({ param: { name: 'key', in: 'path' }, example: 'ustaad.access' });
const Value = z.union([z.number().int(), z.boolean(), z.string().max(40)]);
const Row = z.object({
  key: z.string(),
  kind: z.enum(['int', 'boolean', 'enum']),
  default: Value,
  value: Value,
  version: z.number().int().nullable(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  values: z.array(z.string()).optional(),
  locked: z.boolean(),
});

const list = createRoute({
  method: 'get',
  path: '/admin/ustaad/settings',
  tags: ['admin'],
  summary: 'Every Ustaad Network setting: kind, bounds, default, value in effect and version',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(z.object({ settings: z.array(Row) }), 'Settings'), ...errorResponses },
});
const save = createRoute({
  method: 'put',
  path: '/admin/ustaad/settings/{key}',
  tags: ['admin'],
  summary:
    'Save one Ustaad setting (compare-and-set; version null to create; reasonCode for video above 180 s)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ key: Key }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              value: Value,
              version: z.number().int().min(1).nullable(),
              reasonCode: z
                .string()
                .regex(/^[a-z_]{3,40}$/)
                .optional(),
            })
            .strict()
            .openapi('AdminUstaadSettingSave'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Saved'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    422: json(ErrorSchema, 'SETTING_TYPE / SETTING_RANGE / SETTING_INVARIANT / SETTING_RELATION'),
    ...errorResponses,
  },
});

/** The saver's role for the invariants (super admin may raise the video length with a reason). */
const actorRoleOf = (grants: readonly Grant[]): string =>
  grants.some((g) => g.role === 'super_admin')
    ? 'super_admin'
    : (grants.find((g) => g.role !== 'customer')?.role ?? 'staff');

export function adminUstaadSettingsRoutes(deps: AppDeps, sessions: SessionCache, access: UstaadAccessCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/ustaad/settings/*';
  for (const p of ['/admin/ustaad/settings', prefix]) {
    app.use(p, authenticate(deps, sessions));
    app.use(
      p,
      rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.staff, (c) => c.get('auth').user.id),
    );
    app.use(p, requireVerified);
  }
  app.on('PUT', prefix, requirePermission('ustaad:settings'));

  return app
    .openapi(list, async (c) => {
      const grants = c.get('auth').grants;
      if (!can(grants, 'ustaad:settings') && !can(grants, 'ustaad:read')) throw Forbidden();
      const view = await readUstaadSettings(deps.db);
      const settings = USTAAD_SETTING_KEYS.map((key) => {
        const spec = USTAAD_SETTINGS[key];
        return {
          key,
          kind: spec.kind,
          default: spec.default,
          value: view.values[key],
          version: view.versions[key] ?? null,
          ...(spec.kind === 'int' ? { min: spec.min, max: spec.max } : {}),
          ...(spec.kind === 'enum' ? { values: [...spec.values] } : {}),
          locked: 'locked' in spec && spec.locked,
        };
      });
      return c.json({ settings }, 200);
    })
    .openapi(save, async (c) => {
      const b = c.req.valid('json');
      const key = c.req.valid('param').key;
      const r = await saveUstaadSetting(deps.db, {
        key,
        value: b.value,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        actorRole: actorRoleOf(c.get('auth').grants),
        ...(b.reasonCode ? { reasonCode: b.reasonCode } : {}),
      });
      if (key === 'ustaad.access') access.clear();
      return c.json(r, 200);
    });
}
