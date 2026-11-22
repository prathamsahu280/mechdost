import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { getTradeProfile, updateProfile } from '@mechdost/db/repo';
import { ProfilePatchDto } from '@mechdost/shared/account-api';
import { TRADE_STATUSES, type TradeStatus } from '@mechdost/shared/business-codes';
import { permissionsOf } from '@mechdost/shared/rbac';
import type { SessionCache } from '../auth/session-cache';
import { authenticate } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv, AuthContext } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

const Me = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    phoneVerified: z.boolean(),
    emailVerified: z.boolean(),
    language: z.string(),
    version: z.number().int(),
    roles: z.array(
      z.object({
        role: z.string(),
        cityId: z.string().nullable(),
        shopId: z.string().nullable(),
        workshopId: z.string().nullable(),
      }),
    ),
    permissions: z.array(z.string()),
    /** Trade account status (audience entry design 2026-11-22): `verified` shows the badge. */
    trade: z.object({ status: z.enum(TRADE_STATUSES) }),
  })
  .openapi('Me');

const getMe = createRoute({
  method: 'get',
  path: '/me',
  tags: ['account'],
  summary: 'The signed-in user, their roles and effective permissions (auto-provisions on first call)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Current user', content: { 'application/json': { schema: Me } } },
    ...errorResponses,
  },
});

const patchMe = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['account'],
  summary: 'Edit own name or language',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: ProfilePatchDto } } } },
  responses: {
    200: { description: 'Updated user', content: { 'application/json': { schema: Me } } },
    409: { description: 'Stale version', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

function toMe(auth: AuthContext, trade: TradeStatus): z.infer<typeof Me> {
  const { user, grants } = auth;
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    phoneVerified: user.phoneVerifiedAt !== null,
    emailVerified: user.emailVerifiedAt !== null,
    language: user.language,
    version: user.version,
    roles: grants.map((g) => ({
      role: g.role,
      cityId: g.cityId,
      shopId: g.shopId,
      workshopId: g.workshopId,
    })),
    permissions: [...permissionsOf(grants)].sort(),
    trade: { status: trade },
  };
}

export function meRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/me', authenticate(deps, cache));
  app.use(
    '/me',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  return app
    .openapi(getMe, async (c) => {
      const auth = c.get('auth');
      return c.json(toMe(auth, (await getTradeProfile(deps.db, auth.user.id)).status), 200);
    })
    .openapi(patchMe, async (c) => {
      const auth = c.get('auth');
      const { version, ...patch } = c.req.valid('json');
      const user = await updateProfile(deps.db, { userId: auth.user.id, expectedVersion: version, patch });
      cache.invalidateUser(user.id);
      return c.json(toMe({ ...auth, user }, (await getTradeProfile(deps.db, user.id)).status), 200);
    });
}
