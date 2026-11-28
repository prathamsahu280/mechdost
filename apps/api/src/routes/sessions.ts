import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { recordSessionsRevoked, revokeAllUserSessions } from '@mechdost/db/repo';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Sessions of the signed-in person (founder 2026-11-28; spec 01 "Sessions", spec 13). "Sign out of all devices" ends
 * every Firebase session of the caller (`revokeRefreshTokens`, never per device, never another user's) and drops the
 * caller's cached session on this instance; other instances catch up when their 60 s cache expires and the next
 * session load checks revocation. A few a day is plenty: it is a "lost my phone" button, not a loop.
 */
export const SESSIONS_REVOKE_ALL_RATE: RateRule = {
  name: 'sessions_revoke_all',
  limit: 5,
  windowSeconds: 3600,
};

const Revoked = z.object({ revoked: z.literal(true) }).openapi('SessionsRevoked');

const revokeAll = createRoute({
  method: 'post',
  path: '/me/sessions/revoke-all',
  tags: ['account'],
  summary: 'Sign out of all devices: ends every session of your own account (this device too)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Every session ended', content: { 'application/json': { schema: Revoked } } },
    503: {
      description: 'Not available on this deployment',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    ...errorResponses,
  },
});

export function sessionRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/me/sessions/*', authenticate(deps, cache, { checkRevoked: true }));
  app.use(
    '/me/sessions/*',
    rateLimit(deps.rateLimiter, SESSIONS_REVOKE_ALL_RATE, (c) => c.get('auth').user.id),
  );
  return app.openapi(revokeAll, async (c) => {
    const auth = c.get('auth');
    const revoke = deps.passwordAuth?.revokeSessions?.bind(deps.passwordAuth);
    if (!revoke)
      throw new ApiError(503, 'UNAVAILABLE', 'Signing out of all devices is not available right now');
    await revoke(auth.user.firebaseUid);
    // The device list marks every row of the caller ended too (reason self_all); Firebase ended the tokens above.
    await revokeAllUserSessions(deps.db, auth.user.id, 'self_all');
    cache.invalidateUser(auth.user.id);
    await recordSessionsRevoked(deps.db, {
      userId: auth.user.id,
      actorRole: auth.grants[0]?.role ?? 'customer',
    });
    return c.json({ revoked: true as const }, 200);
  });
}
