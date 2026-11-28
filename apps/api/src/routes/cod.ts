import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityScopeFrom,
  codStatusFor,
  decideCodRequest,
  listCodRequests,
  myCodRequests,
  requestCod,
  revokeCodApproval,
  withdrawCodRequest,
  type CodRequestView,
} from '@mechdost/db/repo';
import {
  COD_DECISION_REASONS,
  COD_REQUEST_REASONS,
  COD_REQUEST_STATES,
  COD_REVOKE_REASONS,
} from '@mechdost/shared/cod-eligibility';
import {
  AdminCodRequestsDto,
  CodDecisionDto,
  CodRequestCreatedDto,
  MyCodDto,
} from '@mechdost/shared/cod-api';
import { can } from '@mechdost/shared/rbac';
import type { SessionCache } from '../auth/session-cache';
import {
  authenticate,
  forbidSellers,
  requireCustomerVerified,
  requirePermission,
  requireVerified,
} from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Cash on delivery on request (founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility, spec 08 "COD
 * requests"). Customers: `GET /me/cod` (their state for a PIN and their requests), `POST /me/cod/requests` (phone
 * verified, 5 a day), withdraw. Staff with `customers:cod_approve`: the queue and approve / reject / revoke, limited
 * to the cities of their grant (another city's request is a 404). The checkout quote and `POST /orders` apply the
 * same rule; nothing here trusts the client.
 */
export const COD_DECIDE_RATE: RateRule = { name: 'cod_decide_staff', limit: 120, windowSeconds: 3_600 };

const Pincode = z.string().regex(/^[1-9][0-9]{5}$/);
const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const Version = z.number().int().min(1);
const StaffNote = z.string().trim().max(500).nullable().optional();

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);
function requestDto(r: CodRequestView) {
  return {
    id: r.id,
    pincode: r.pincode,
    status: r.status,
    reasonCode: r.reasonCode,
    note: r.note,
    decisionReasonCode: r.decisionReasonCode,
    revokeReasonCode: r.revokeReasonCode,
    capPaise: r.capPaise,
    expiresAt: iso(r.expiresAt),
    decidedAt: iso(r.decidedAt),
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

const myCod = createRoute({
  method: 'get',
  path: '/me/cod',
  tags: ['checkout'],
  summary: 'Your cash-on-delivery state for a PIN code and your requests',
  security: [{ bearerAuth: [] }],
  request: { query: z.object({ pincode: Pincode }) },
  responses: { 200: json(MyCodDto, 'State'), 422: json(ErrorSchema, 'PIN not served'), ...errorResponses },
});

const createRequest = createRoute({
  method: 'post',
  path: '/me/cod/requests',
  tags: ['checkout'],
  summary: 'Ask for cash on delivery (one pending request at a time)',
  description:
    'COD_ALREADY_AVAILABLE, COD_REQUEST_PENDING, COD_REQUEST_TOO_SOON (409); COD_REQUESTS_CLOSED, PINCODE_NOT_SERVICEABLE (422).',
  security: [{ bearerAuth: [] }],
  request: body(
    z
      .object({
        pincode: Pincode,
        reasonCode: z.enum(COD_REQUEST_REASONS),
        note: z.string().trim().max(300).nullable().optional(),
      })
      .strict()
      .openapi('CodRequestCreate'),
  ),
  responses: {
    201: json(CodRequestCreatedDto, 'Request sent'),
    409: json(ErrorSchema, 'Already available, pending or too soon'),
    422: json(ErrorSchema, 'Closed here or PIN not served'),
    ...errorResponses,
  },
});

const withdraw = createRoute({
  method: 'post',
  path: '/me/cod/requests/{id}/withdraw',
  tags: ['checkout'],
  summary: 'Take back your pending cash-on-delivery request',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: Id }), ...body(z.object({ version: Version }).strict()) },
  responses: {
    200: json(z.object({ version: z.number().int() }), 'Withdrawn'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'Changed meanwhile'),
    ...errorResponses,
  },
});

const queue = createRoute({
  method: 'get',
  path: '/admin/cod-requests',
  tags: ['admin'],
  summary: 'Cash-on-delivery requests in your cities (pending oldest first; decided newest first)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.enum(COD_REQUEST_STATES).default('pending'),
      cursor: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  },
  responses: { 200: json(AdminCodRequestsDto, 'Queue'), ...errorResponses },
});

const decision = (path: string, summary: string, schema: z.ZodType) =>
  createRoute({
    method: 'post',
    path,
    tags: ['admin'],
    summary,
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: Id }), ...body(schema) },
    responses: {
      200: json(CodDecisionDto, 'Decided'),
      404: json(ErrorSchema, 'Not found (or another city)'),
      409: json(ErrorSchema, 'Changed meanwhile or already approved'),
      422: json(ErrorSchema, 'Invalid'),
      ...errorResponses,
    },
  });

const ApproveBody = z
  .object({
    version: Version,
    capPaise: z.number().int().min(100).max(10_000_000).nullable().optional(),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    staffNote: StaffNote,
  })
  .strict()
  .openapi('CodApprove');
const RejectBody = z
  .object({ version: Version, reasonCode: z.enum(COD_DECISION_REASONS), staffNote: StaffNote })
  .strict()
  .openapi('CodReject');
const RevokeBody = z
  .object({ version: Version, reasonCode: z.enum(COD_REVOKE_REASONS), staffNote: StaffNote })
  .strict()
  .openapi('CodRevoke');

const approve = decision('/admin/cod-requests/{id}/approve', 'Approve cash on delivery', ApproveBody);
const reject = decision(
  '/admin/cod-requests/{id}/reject',
  'Turn a cash-on-delivery request down',
  RejectBody,
);
const revoke = decision('/admin/cod-requests/{id}/revoke', 'Take an approval back', RevokeBody);

export function codRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // Customers.
  app.use('/me/cod', authenticate(deps, cache));
  app.use('/me/cod/*', authenticate(deps, cache));
  for (const path of ['/me/cod', '/me/cod/*']) {
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, forbidSellers);
  }
  app.on('POST', '/me/cod/requests', requireCustomerVerified(deps));
  // The 5-a-day request limit is counted in `requestCod` on created requests only (DC-F3), not here.
  // Staff.
  app.use('/admin/cod-requests', authenticate(deps, cache));
  app.use('/admin/cod-requests/*', authenticate(deps, cache));
  for (const path of ['/admin/cod-requests', '/admin/cod-requests/*']) {
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
    app.use(path, requirePermission('customers:cod_approve'));
  }
  app.on(
    'POST',
    '/admin/cod-requests/*',
    rateLimit(deps.rateLimiter, COD_DECIDE_RATE, (c) => c.get('auth').user.id),
  );
  const scopeOf = (grants: Parameters<typeof cityScopeFrom>[0]) =>
    cityScopeFrom(grants, 'customers:cod_approve');

  return app
    .openapi(myCod, async (c) => {
      const userId = c.get('auth').user.id;
      const { pincode } = c.req.valid('query');
      const status = await codStatusFor(deps.db, { userId, pincode });
      const requests = await myCodRequests(deps.db, userId);
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          cityCode: status.cityCode,
          eligibility: { ...status.eligibility, askAgainAt: status.askAgainAt?.toISOString() ?? null },
          minOrderPaise: status.rules.minOrderPaise,
          minItems: status.rules.minItems,
          requests: requests.map(requestDto),
        },
        200,
      );
    })
    .openapi(createRequest, async (c) => {
      const b = c.req.valid('json');
      const row = await requestCod(deps.db, {
        userId: c.get('auth').user.id,
        pincode: b.pincode,
        reasonCode: b.reasonCode,
        note: b.note ?? null,
      });
      return c.json(row, 201);
    })
    .openapi(withdraw, async (c) => {
      const out = await withdrawCodRequest(deps.db, {
        userId: c.get('auth').user.id,
        requestId: c.req.valid('param').id,
        expectedVersion: c.req.valid('json').version,
      });
      return c.json(out, 200);
    })
    .openapi(queue, async (c) => {
      const q = c.req.valid('query');
      const { grants } = c.get('auth');
      const page = await listCodRequests(deps.db, {
        scope: scopeOf(grants),
        status: q.status,
        cursor: q.cursor ?? null,
        limit: q.limit,
        canReadPii: can(grants, 'customers:read_pii'),
      });
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          items: page.items.map((i) => ({
            ...requestDto(i),
            customerId: i.customerId,
            customerName: i.customerName,
            customerPhone: i.customerPhone,
            cityCode: i.cityCode,
            deliveredOrders: i.deliveredOrders,
            cancelledOrders: i.cancelledOrders,
            ustaadVerified: i.ustaadVerified,
          })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    })
    .openapi(approve, async (c) => {
      const b = ApproveBody.parse(c.req.valid('json'));
      const out = await decideCodRequest(deps.db, {
        decision: 'approve',
        requestId: c.req.valid('param').id,
        expectedVersion: b.version,
        capPaise: b.capPaise ?? null,
        expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
        staffNote: b.staffNote ?? null,
        staffUserId: c.get('auth').user.id,
        scope: scopeOf(c.get('auth').grants),
      });
      return c.json(out, 200);
    })
    .openapi(reject, async (c) => {
      const b = RejectBody.parse(c.req.valid('json'));
      const out = await decideCodRequest(deps.db, {
        decision: 'reject',
        requestId: c.req.valid('param').id,
        expectedVersion: b.version,
        reasonCode: b.reasonCode,
        staffNote: b.staffNote ?? null,
        staffUserId: c.get('auth').user.id,
        scope: scopeOf(c.get('auth').grants),
      });
      return c.json(out, 200);
    })
    .openapi(revoke, async (c) => {
      const b = RevokeBody.parse(c.req.valid('json'));
      const out = await revokeCodApproval(deps.db, {
        requestId: c.req.valid('param').id,
        expectedVersion: b.version,
        reasonCode: b.reasonCode,
        staffNote: b.staffNote ?? null,
        staffUserId: c.get('auth').user.id,
        scope: scopeOf(c.get('auth').grants),
      });
      return c.json({ status: 'revoked' as const, version: out.version }, 200);
    });
}
