/**
 * Admin → Ustaad → reported conversation (spec 23 § 3 SR-38; workstream D2). The ONLY staff path to message content:
 * a verified staff member in a staff session with `ustaad:moderate` (community manager, super admin), city scoped
 * through the report's city, names an open or in-review report on a message and a reason code; every read writes
 * `audit_log` (`ustaad.dm_read`). No report, a closed report, another city or a report on anything but a message:
 * 404. Phone numbers are never part of the answer.
 */
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { cityScopeFrom, staffReadUstaadThread } from '@mechdost/db/repo';
import { StaffThreadReadQueryDto, StaffThreadViewDto } from '@mechdost/shared/ustaad/dto/messages';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { json } from './service-schemas';

const PATH = '/admin/ustaad/threads/read';

const read = createRoute({
  method: 'get',
  path: PATH,
  tags: ['admin'],
  security: [{ bearerAuth: [] }],
  summary: 'Read a reported conversation (report code + reason code; audited)',
  request: { query: StaffThreadReadQueryDto },
  responses: { 200: json(StaffThreadViewDto, 'Conversation'), ...errorResponses },
});

export function adminUstaadThreadRoutes(deps: AppDeps, sessions: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(PATH, authenticate(deps, sessions));
  app.use(
    PATH,
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.staff, (c) => c.get('auth').user.id),
  );
  app.use(PATH, requireVerified);
  app.use(PATH, requirePermission('ustaad:moderate'));
  const staff = (c: Context<AppEnv>) => {
    const scope = cityScopeFrom(c.get('auth').grants, 'ustaad:moderate');
    return { userId: c.get('auth').user.id, cityIds: scope.all ? null : scope.cityIds };
  };
  return app.openapi(read, async (c) =>
    c.json(await staffReadUstaadThread(deps.db, staff(c), c.req.valid('query')), 200),
  );
}
