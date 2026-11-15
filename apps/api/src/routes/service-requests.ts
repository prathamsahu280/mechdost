import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  cancelMyServiceRequest,
  rescheduleMyServiceRequest,
  createServiceRequest,
  decideEstimate,
  decideMove,
  decideProposal,
  getMyServiceRequest,
  listMyServiceRequests,
} from '@mechdost/db/repo';
import {
  CancelServiceRequestSchema,
  RescheduleServiceRequestSchema,
  CreateServiceRequestSchema,
  EstimateDecisionSchema,
  MoveDecisionSchema,
  ProposalDecisionSchema,
} from '@mechdost/shared/service-requests';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requireCustomerVerified, requirePermission } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
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
 * Customer service requests (spec 06). Signed in; booking and every decision need phone + email verified. The
 * `Idempotency-Key` header makes a retried booking return the same request (201 first, 200 on replay). A customer
 * reaches only their own requests (foreign codes 404). Concern text is personal data: never logged.
 */
export const SERVICE_CREATE_RATE: RateRule = { name: 'service_create_user', limit: 10, windowSeconds: 600 };

const created = z
  .object({ code: z.string(), status: z.string(), version: z.number().int() })
  .openapi('ServiceRequestCreated');

const create = createRoute({
  method: 'post',
  path: '/service-requests',
  tags: ['services'],
  summary:
    'Book a workshop visit (or "Let MechDost choose" with workshopSlug null); Idempotency-Key required',
  security: [{ bearerAuth: [] }],
  request: {
    headers: z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }),
    body: body(CreateServiceRequestSchema.openapi('CreateServiceRequest')),
  },
  responses: {
    201: json(created, 'Booked'),
    200: json(created, 'Replay of an earlier booking with the same key'),
    ...conflict,
    ...errorResponses,
  },
});

const list = createRoute({
  method: 'get',
  path: '/service-requests',
  tags: ['services'],
  summary: 'Your service requests, newest first (keyset paged)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      locale: Locale,
    }),
  },
  responses: { 200: json(RequestPage, 'Requests'), ...errorResponses },
});

const detail = createRoute({
  method: 'get',
  path: '/service-requests/{code}',
  tags: ['services'],
  summary: 'One of your requests: proposal, current estimate, bill and timeline',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: RequestCode }), query: z.object({ locale: Locale }) },
  responses: { 200: json(RequestDetail, 'Request'), ...conflict, ...errorResponses },
});

const proposal = createRoute({
  method: 'post',
  path: '/service-requests/{code}/proposal',
  tags: ['services'],
  summary: "Accept the workshop's slot and expected cost (→ confirmed) or turn it down (→ it proposes again)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(ProposalDecisionSchema.openapi('ProposalDecision')),
  },
  responses: { 200: json(Changed, 'Decided'), ...conflict, ...errorResponses },
});

const move = createRoute({
  method: 'post',
  path: '/service-requests/{code}/move',
  tags: ['services'],
  summary:
    "Answer the workshop's offer to move a home job to its workshop (accept: it becomes a workshop job; decline: the visit fee is billed)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(MoveDecisionSchema.openapi('MoveDecision')),
  },
  responses: { 200: json(Changed, 'Answered'), ...conflict, ...errorResponses },
});

const cancel = createRoute({
  method: 'post',
  path: '/service-requests/{code}/cancel',
  tags: ['services'],
  summary: 'Cancel before the vehicle reaches the workshop, with a reason code',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(CancelServiceRequestSchema.openapi('CancelServiceRequest')),
  },
  responses: { 200: json(Changed, 'Cancelled'), ...conflict, ...errorResponses },
});

const reschedule = createRoute({
  method: 'post',
  path: '/service-requests/{code}/reschedule',
  tags: ['services'],
  summary:
    'Move the booking to another date and part of the day before the vehicle arrives (at most twice); the workshop answers the new time',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(RescheduleServiceRequestSchema.openapi('RescheduleServiceRequest')),
  },
  responses: { 200: json(Changed, 'Moved'), ...conflict, ...errorResponses },
});

const estimate = createRoute({
  method: 'post',
  path: '/service-requests/{code}/estimate',
  tags: ['services'],
  summary:
    'Approve or decline every line of the current estimate revision, with consent (≥1 approved → approved)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: RequestCode }),
    body: body(EstimateDecisionSchema.openapi('EstimateDecision')),
  },
  responses: { 200: json(Changed, 'Decided'), ...conflict, ...errorResponses },
});

export function serviceRequestRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern: '/service-requests/*' also matches '/service-requests'.
  app.use('/service-requests/*', authenticate(deps, cache));
  app.use(
    '/service-requests/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.on('POST', '/service-requests/*', requireCustomerVerified(deps), requirePermission('service:request'));
  app.on(
    'POST',
    '/service-requests',
    rateLimit(deps.rateLimiter, SERVICE_CREATE_RATE, (c) => c.get('auth').user.id),
  );
  const me = (c: Context<AppEnv>) => c.get('auth').user.id;

  return app
    .openapi(create, async (c) => {
      const r = await createServiceRequest(deps.db, {
        userId: me(c),
        idempotencyKey: c.req.valid('header')['idempotency-key'],
        request: c.req.valid('json'),
      });
      const out = { code: r.code, status: r.status, version: r.version };
      return r.replayed ? c.json(out, 200) : c.json(out, 201);
    })
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      const page = await listMyServiceRequests(
        deps.db,
        me(c),
        { cursor: q.cursor ?? null, limit: q.limit },
        q.locale,
      );
      return c.json({ items: page.items.map(toSummaryJson), nextCursor: page.nextCursor }, 200);
    })
    .openapi(detail, async (c) => {
      const v = await getMyServiceRequest(
        deps.db,
        me(c),
        c.req.valid('param').code,
        c.req.valid('query').locale,
        deps.keyring ?? null,
      );
      return c.json(toDetailJson(v), 200);
    })
    .openapi(proposal, async (c) => {
      const b = c.req.valid('json');
      const r = await decideProposal(deps.db, {
        userId: me(c),
        code: c.req.valid('param').code,
        accept: b.accept,
        expectedVersion: b.version,
        keyring: deps.keyring ?? null,
      });
      return c.json(r, 200);
    })
    .openapi(move, async (c) => {
      const b = c.req.valid('json');
      const r = await decideMove(deps.db, {
        userId: me(c),
        code: c.req.valid('param').code,
        accept: b.accept,
        expectedVersion: b.version,
      });
      return c.json(r, 200);
    })
    .openapi(cancel, async (c) => {
      const b = c.req.valid('json');
      const r = await cancelMyServiceRequest(deps.db, {
        userId: me(c),
        code: c.req.valid('param').code,
        reasonCode: b.reasonCode,
        expectedVersion: b.version,
      });
      return c.json(r, 200);
    })
    .openapi(reschedule, async (c) => {
      const b = c.req.valid('json');
      const r = await rescheduleMyServiceRequest(deps.db, {
        userId: me(c),
        code: c.req.valid('param').code,
        date: b.date,
        slot: b.slot,
        expectedVersion: b.version,
      });
      return c.json(r, 200);
    })
    .openapi(estimate, async (c) => {
      const r = await decideEstimate(deps.db, {
        userId: me(c),
        code: c.req.valid('param').code,
        decision: c.req.valid('json'),
      });
      return c.json(r, 200);
    });
}
