import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { updateProfile } from '@mechdost/db/repo';
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
  })
  .openapi('Me');

const ProfilePatch = z
  .object({
    version: z
      .number()
      .int()
      .min(1)
      .openapi({ description: 'The version you last read (optimistic locking)' }),
    name: z.string().trim().min(1).max(80).optional(),
    language: z.enum(['en', 'hi']).optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.language !== undefined, { message: 'Nothing to update' })
  .openapi('ProfilePatch');

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
  request: { body: { required: true, content: { 'application/json': { schema: ProfilePatch } } } },
  responses: {
    200: { description: 'Updated user', content: { 'application/json': { schema: Me } } },
    409: { description: 'Stale version', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

function toMe(auth: AuthContext): z.infer<typeof Me> {
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
    .openapi(getMe, (c) => c.json(toMe(c.get('auth')), 200))
    .openapi(patchMe, async (c) => {
      const auth = c.get('auth');
      const { version, ...patch } = c.req.valid('json');
      const user = await updateProfile(deps.db, { userId: auth.user.id, expectedVersion: version, patch });
      cache.invalidateUser(user.id);
      return c.json(toMe({ ...auth, user }), 200);
    });
}
