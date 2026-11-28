import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  listUserSessions,
  revokeCurrentUserSession,
  revokeOtherUserSessions,
  revokeUserSession,
} from '@mechdost/db/repo';
import { DEVICE_LIST_CAP, DevicesDto, DevicesSignedOutDto } from '@mechdost/shared/devices';
import type { SessionCache } from '../auth/session-cache';
import { authenticate } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { ErrorSchema, errorResponses } from './schemas';

/**
 * "Where you're signed in" (spec 01 § Devices, decision 2026-11-28): the signed-in person's own password sign-ins.
 * Every answer is `private, no-store`. The list holds at most `DEVICE_LIST_CAP` (50) live sign-ins, newest activity
 * first, with the current one flagged by the token's own session claim; the session key hash is never returned.
 * Another person's id is 404, the current device cannot be ended here (409 CURRENT_DEVICE; the normal sign-out does
 * that). Ending a device reaches it within the session-cache period (about a minute). Sign-ins without a row
 * (phone-code sessions, sign-ins from before the device list) are not listed and not reachable here.
 */
export const DEVICE_WRITE_RATE: RateRule = { name: 'device_write', limit: 60, windowSeconds: 3600 };
const NO_STORE = 'private, no-store';
const tags = ['me'];
const security = [{ bearerAuth: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const IdParam = z.object({ id: z.uuid() });

const listRoute = createRoute({
  method: 'get',
  path: '/me/devices',
  tags,
  summary: `Your live sign-ins (at most ${String(DEVICE_LIST_CAP)}), newest activity first`,
  security,
  responses: { 200: json(DevicesDto, 'Devices'), ...errorResponses },
});
// Registered before `/:id/sign-out` so "current" never reads as an id.
const currentRoute = createRoute({
  method: 'post',
  path: '/me/devices/current/sign-out',
  tags,
  summary: 'End this device’s own row (the normal sign-out calls this, best effort)',
  security,
  responses: { 200: json(DevicesSignedOutDto, 'Ended (0 when there was nothing to end)'), ...errorResponses },
});
const othersRoute = createRoute({
  method: 'post',
  path: '/me/devices/sign-out-others',
  tags,
  summary: 'Sign out of every other device that is in the list',
  security,
  responses: { 200: json(DevicesSignedOutDto, 'How many ended'), ...errorResponses },
});
const oneRoute = createRoute({
  method: 'post',
  path: '/me/devices/{id}/sign-out',
  tags,
  summary: 'Sign out one other device (404 for an id that is not yours, 409 for this device)',
  security,
  request: { params: IdParam },
  responses: {
    200: json(DevicesSignedOutDto, 'Ended'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'This device'),
    ...errorResponses,
  },
});

export function deviceRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/me/devices', '/me/devices/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.on(
      'POST',
      path,
      rateLimit(deps.rateLimiter, DEVICE_WRITE_RATE, (c) => c.get('auth').user.id),
    );
  }

  return app
    .openapi(listRoute, async (c) => {
      const { user, sessionId } = c.get('auth');
      c.header('Cache-Control', NO_STORE);
      return c.json(
        { devices: await listUserSessions(deps.db, user.id, sessionId), cap: DEVICE_LIST_CAP },
        200,
      );
    })
    .openapi(currentRoute, async (c) => {
      const { user, sessionId } = c.get('auth');
      c.header('Cache-Control', NO_STORE);
      const ended = sessionId
        ? await revokeCurrentUserSession(deps.db, { userId: user.id, sessionId })
        : false;
      return c.json({ signedOut: ended ? 1 : 0 }, 200);
    })
    .openapi(othersRoute, async (c) => {
      const { user, sessionId } = c.get('auth');
      c.header('Cache-Control', NO_STORE);
      const signedOut = await revokeOtherUserSessions(deps.db, {
        userId: user.id,
        currentSessionId: sessionId,
      });
      return c.json({ signedOut }, 200);
    })
    .openapi(oneRoute, async (c) => {
      const { user, sessionId } = c.get('auth');
      const { id } = c.req.valid('param');
      c.header('Cache-Control', NO_STORE);
      await revokeUserSession(deps.db, { userId: user.id, sessionId: id, currentSessionId: sessionId });
      return c.json({ signedOut: 1 }, 200);
    });
}
