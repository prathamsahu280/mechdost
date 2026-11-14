import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { listAudit } from '@mechdost/db/repo';
import { AuditPageDto } from '@mechdost/shared/admin-people-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { requireAllCities } from './city-scope';
import { errorResponses } from './schemas';

/**
 * Audit log viewer (design 2026-11-15, spec 13): verified staff with an all-cities `audit:read` grant (super admin,
 * finance). Read-only; filters on indexed columns; keyset paging; contact details inside before/after are always
 * masked (the repository redacts them).
 */
const Query = z
  .object({
    entity: z.string().max(80).optional(),
    entityId: z.string().max(80).optional(),
    code: z.string().max(40).optional(),
    actor: z.string().max(40).optional(),
    action: z.string().max(80).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    cursor: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const list = createRoute({
  method: 'get',
  path: '/admin/audit',
  tags: ['admin'],
  summary: 'Audit log, newest first (filters: entity, entity id or code, actor, action, IST days)',
  security: [{ bearerAuth: [] }],
  request: { query: Query },
  responses: {
    200: { description: 'A page of audit rows', content: { 'application/json': { schema: AuditPageDto } } },
    ...errorResponses,
  },
});

export function adminAuditRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const path = '/admin/audit';
  app.use(path, authenticate(deps, cache));
  app.use(
    path,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(path, requireVerified);
  app.use(path, requirePermission('audit:read'));
  app.use(path, requireAllCities('audit:read'));
  app.use(
    path,
    rateLimit(deps.rateLimiter, RATE_RULES.adminSearch, (c) => c.get('auth').user.id),
  );

  return app.openapi(list, async (c) => {
    const q = c.req.valid('query');
    const page = await listAudit(deps.db, {
      entity: q.entity,
      entityId: q.entityId,
      code: q.code,
      actorUserId: q.actor,
      action: q.action,
      fromDay: q.from,
      toDay: q.to,
      cursor: q.cursor,
      limit: q.limit,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      { rows: page.rows.map((r) => ({ ...r, at: r.at.toISOString() })), nextCursor: page.nextCursor },
      200,
    );
  });
}
