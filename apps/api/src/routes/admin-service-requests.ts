import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityScopeFrom,
  getAdminServiceRequest,
  listAdminServiceRequests,
  overrideArrival,
  reassignServiceRequest,
  rejectServiceRequest,
} from '@mechdost/db/repo';
import {
  ArrivalOverrideSchema,
  ReassignSchema,
  RejectServiceRequestSchema,
} from '@mechdost/shared/service-requests';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import {
  body,
  Changed,
  conflict,
  json,
  Locale,
  RequestCode,
  RequestDetail,
  RequestPage,
  toDetailJson,
  toSummaryJson,
} from './service-schemas';

/**
 * Staff routing of service requests (spec 06): verified staff, city-scoped by the grant of each permission
 * (`service:read` to see, `service:route` to reassign or reject). A request goes only to an eligible workshop
 * (bookable, same city, serves the vehicle type); foreign-city codes are 404.
 */
const list = createRoute({
  method: 'get',
  path: '/admin/service-requests',
  tags: ['admin'],
  summary: 'Service requests in your cities: needs routing, awaiting a workshop, active or closed',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      view: z.enum(['needs_routing', 'awaiting', 'active', 'closed']).default('needs_routing'),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      locale: Locale,
    }),
  },
  responses: { 200: json(RequestPage, 'Requests'), ...errorResponses },
});

const detail = createRoute({
  method: 'get',
  path: '/admin/service-requests/{code}',
  tags: ['admin'],
  summary: 'One request with proposal, estimate, bill and the full timeline',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: RequestCode }), query: z.object({ locale: Locale }) },
  responses: { 200: json(RequestDetail, 'Request'), ...conflict, ...errorResponses },
});

const reassign = createRoute({
  method: 'post',
  path: '/admin/service-requests/{code}/reassign',
  tags: ['admin'],
  summary: 'Send to an eligible workshop (from needs routing, awaiting a workshop or proposed)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(ReassignSchema.openapi('ReassignServiceRequest')),
  },
  responses: { 200: json(Changed, 'Sent'), ...conflict, ...errorResponses },
});

const reject = createRoute({
  method: 'post',
  path: '/admin/service-requests/{code}/reject',
  tags: ['admin'],
  summary: 'Reject a request nobody can take, with a reason code and a message for the customer',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(RejectServiceRequestSchema.openapi('RejectServiceRequest')),
  },
  responses: { 200: json(Changed, 'Rejected'), ...conflict, ...errorResponses },
});

const arrival = createRoute({
  method: 'post',
  path: '/admin/service-requests/{code}/arrival-override',
  tags: ['admin'],
  summary:
    "Confirm a home visit's arrival without the customer's code (reason and odometer required; audited)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(ArrivalOverrideSchema.openapi('ArrivalOverride')),
  },
  responses: { 200: json(Changed, 'Arrived'), ...conflict, ...errorResponses },
});

export function adminServiceRequestRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/admin/service-requests/*', authenticate(deps, cache));
  app.use(
    '/admin/service-requests/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/service-requests/*', requireVerified);
  app.use('/admin/service-requests/*', requirePermission('service:read'));
  app.on('POST', '/admin/service-requests/*', requirePermission('service:route'));

  return app
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      const page = await listAdminServiceRequests(
        deps.db,
        cityScopeFrom(c.get('auth').grants, 'service:read'),
        q.view,
        { cursor: q.cursor ?? null, limit: q.limit },
        q.locale,
      );
      return c.json({ items: page.items.map(toSummaryJson), nextCursor: page.nextCursor }, 200);
    })
    .openapi(detail, async (c) => {
      const v = await getAdminServiceRequest(
        deps.db,
        cityScopeFrom(c.get('auth').grants, 'service:read'),
        c.req.valid('param').code,
        c.req.valid('query').locale,
      );
      return c.json(toDetailJson(v), 200);
    })
    .openapi(reassign, async (c) => {
      const b = c.req.valid('json');
      const r = await reassignServiceRequest(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'service:route'),
        code: c.req.valid('param').code,
        workshopId: b.workshopId,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(arrival, async (c) => {
      const b = c.req.valid('json');
      const r = await overrideArrival(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'service:route'),
        code: c.req.valid('param').code,
        reason: b.reason,
        odometerKm: b.odometerKm,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(reject, async (c) => {
      const b = c.req.valid('json');
      const r = await rejectServiceRequest(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'service:route'),
        code: c.req.valid('param').code,
        reasonCode: b.reasonCode,
        message: b.message,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    });
}
