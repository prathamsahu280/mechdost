import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { grantStaffRole, listStaff, revokeAllUserSessions, revokeStaffRole } from '@mechdost/db/repo';
import {
  StaffGrantBody,
  StaffGrantCreated,
  StaffListDto,
  StaffRevoked,
  StaffRevokeBody,
} from '@mechdost/shared/admin-people-api';
import type { SessionCache } from '../auth/session-cache';
import { log, safeError } from '../logger';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { requireAllCities } from './city-scope';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Staff and roles (design 2026-11-15, specs 08/13): verified staff with an all-cities `staff:manage` grant (the
 * super admin). The rules (only a super admin gives `super_admin`/`finance`, nobody changes their own roles, the last
 * super admin stays) live in the repository. After a change the person's cached session on this instance is dropped,
 * and a revoke also ends their Firebase sessions, so the new roles apply at once here and within a minute on other
 * instances. The CLI (`pnpm db:grant-role`) stays for the first admin.
 */
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const grantParam = z.object({ grantId: z.uuid().openapi({ param: { name: 'grantId', in: 'path' } }) });

const list = createRoute({
  method: 'get',
  path: '/admin/staff',
  tags: ['admin'],
  summary: 'Staff with their roles, city scope, last sign-in and phone-code state',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(StaffListDto, 'Staff'), ...errorResponses },
});

const grant = createRoute({
  method: 'post',
  path: '/admin/staff/grants',
  tags: ['admin'],
  summary: 'Give a staff role (reason needed; a city role needs a city)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: StaffGrantBody } } } },
  responses: {
    201: json(StaffGrantCreated, 'Granted'),
    404: json(ErrorSchema, 'No such account or city'),
    409: json(ErrorSchema, 'Already held'),
    ...errorResponses,
  },
});

const revoke = createRoute({
  method: 'post',
  path: '/admin/staff/grants/{grantId}/revoke',
  tags: ['admin'],
  summary: 'Remove a staff role (reason needed; never your own, never the last super admin)',
  security: [{ bearerAuth: [] }],
  request: {
    params: grantParam,
    body: { required: true, content: { 'application/json': { schema: StaffRevokeBody } } },
  },
  responses: {
    200: json(StaffRevoked, 'Revoked'),
    404: json(ErrorSchema, 'No such role'),
    409: json(ErrorSchema, 'Last super admin'),
    ...errorResponses,
  },
});

export function adminStaffRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // `/admin/staff/*` also matches `/admin/staff` itself.
  const path = '/admin/staff/*';
  app.use(path, authenticate(deps, cache));
  app.use(
    path,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(path, requireVerified);
  app.use(path, requirePermission('staff:manage'));
  app.use(path, requireAllCities('staff:manage'));

  /** A removed role must not linger in a session: end the person's Firebase sessions (best effort, logged). */
  async function endSessions(firebaseUid: string, userId: string) {
    // The device list marks the person's rows ended too (reason staff_role_removed); Firebase ends the tokens.
    try {
      await revokeAllUserSessions(deps.db, userId, 'staff_role_removed');
    } catch (err) {
      log('error', 'staff_revoke_session_rows_failed', safeError(err));
    }
    try {
      await deps.passwordAuth?.revokeSessions?.(firebaseUid);
    } catch (err) {
      log('error', 'staff_revoke_sessions_failed', safeError(err));
    }
  }

  return app
    .openapi(list, async (c) => {
      const data = await listStaff(deps.db, { viewerId: c.get('auth').user.id });
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          ...data,
          staff: data.staff.map((m) => ({
            ...m,
            lastSignInAt: m.lastSignInAt ? m.lastSignInAt.toISOString() : null,
            grants: m.grants.map((g) => ({ ...g, grantedAt: g.grantedAt.toISOString() })),
          })),
        },
        200,
      );
    })
    .openapi(grant, async (c) => {
      const body = c.req.valid('json');
      const out = await grantStaffRole(deps.db, {
        actorUserId: c.get('auth').user.id,
        phone: body.phone,
        role: body.role,
        cityId: body.cityId ?? null,
        reason: body.reason,
      });
      cache.invalidateUser(out.targetUserId);
      return c.json({ grantId: out.grantId }, 201);
    })
    .openapi(revoke, async (c) => {
      const out = await revokeStaffRole(deps.db, {
        actorUserId: c.get('auth').user.id,
        grantId: c.req.valid('param').grantId,
        reason: c.req.valid('json').reason,
      });
      cache.invalidateUser(out.targetUserId);
      await endSessions(out.targetFirebaseUid, out.targetUserId);
      return c.json({ revoked: true as const }, 200);
    });
}
