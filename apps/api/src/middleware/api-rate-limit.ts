import { createMiddleware } from 'hono/factory';
import { BEARER } from './auth';
import { enforceRate } from './rate-limit';
import type { ApiLimitsProvider } from '../rate-limit/api-limits';
import type { AppDeps, AppEnv } from '../types';

/**
 * Global limit on every /v1 request (spec 13, decision 2026-11-16, Q195). Exactly one of:
 *  - `api_user:<account>`  when the request carries a token that verifies (counted per signed-in account), or
 *  - `api_guest:<ip>`      otherwise (no token, or one that does not verify: a forged token never picks its own key),
 * plus always `api_ip_flood:<ip>`, a ceiling over everything one address sends. The token is verified here once and
 * the result is handed to `authenticate` through the context. Limits come from admin settings (cached).
 */
export function apiRateLimit(deps: Pick<AppDeps, 'rateLimiter' | 'verifier'>, limits: ApiLimitsProvider) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = c.get('clientIp');
    const { signedInPerMinute, guestPerIpPerMinute, ipFloodPerMinute } = await limits.get();

    await enforceRate(
      c,
      deps.rateLimiter,
      { name: 'api_ip_flood', limit: ipFloodPerMinute, windowSeconds: 60 },
      ip,
    );

    const token = BEARER.exec(c.req.header('authorization') ?? '')?.[1];
    let uid: string | null = null;
    if (token) {
      try {
        const identity = await deps.verifier.verify(token, { checkRevoked: false });
        c.set('verifiedToken', { token, identity });
        uid = identity.firebaseUid;
      } catch {
        // Invalid, expired or the provider is unreachable: counted as a guest; authentication decides on its own.
      }
    }

    if (uid) {
      await enforceRate(
        c,
        deps.rateLimiter,
        { name: 'api_user', limit: signedInPerMinute, windowSeconds: 60 },
        uid,
      );
    } else {
      await enforceRate(
        c,
        deps.rateLimiter,
        { name: 'api_guest', limit: guestPerIpPerMinute, windowSeconds: 60 },
        ip,
      );
    }
    await next();
  });
}
