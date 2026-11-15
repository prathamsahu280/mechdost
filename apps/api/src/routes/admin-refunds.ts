import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  approveRefund,
  cityScopeFrom,
  createStaffRefund,
  getAdminRefund,
  listAdminRefunds,
  markRefundPaid,
  rejectRefund,
  revealRefundDestination,
  settleUnsureRefund,
} from '@mechdost/db/repo';
import {
  ADMIN_REFUND_VIEWS,
  AdminRefundDto,
  AdminRefundPageDto,
  ApproveRefundBody,
  CreateRefundBody,
  MarkRefundPaidBody,
  RefundDestinationDto,
  RejectRefundBody,
  SettleRefundBody,
} from '@mechdost/shared/refunds-api';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { dispatchRefund } from '../payments/refunds';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin refund queue (spec 05; decision 2026-11-15 "All need approval"). Verified staff only: `refunds:read` to see,
 * `refunds:initiate` to ask for a refund, `refunds:approve` (finance, super admin) to approve, decline, pay by hand, settle an unsure
 * refund by hand and see a payout destination. City-scoped by the grant of each permission; foreign-city refunds are 404. The approver
 * cannot be the requester (four-eyes, 403 `FOUR_EYES`). Approving an online refund sends it to Razorpay at once; if that
 * fails for now, the worker retries (the refund stays `approved`).
 */
const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const IdempotencyHeader = z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,56}$/) });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = {
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Changed meanwhile / not allowed now'),
};
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
});
const secured = [{ bearerAuth: [] }];

const list = createRoute({
  method: 'get',
  path: '/admin/refunds',
  tags: ['admin'],
  summary: 'Refund requests in your cities: waiting, overdue, in progress, closed',
  security: secured,
  request: {
    query: z.object({
      view: z.enum(ADMIN_REFUND_VIEWS).default('waiting'),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: { 200: json(AdminRefundPageDto, 'Queue'), ...errorResponses },
});

const detail = createRoute({
  method: 'get',
  path: '/admin/refunds/{id}',
  tags: ['admin'],
  summary: 'One refund request',
  security: secured,
  request: { params: z.object({ id: Id }) },
  responses: { 200: json(AdminRefundDto, 'Refund'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const create = createRoute({
  method: 'post',
  path: '/admin/refunds',
  tags: ['admin'],
  summary: 'Ask for a refund (support claim, part refund, order not fulfilled); it waits for approval',
  security: secured,
  request: { headers: IdempotencyHeader, body: body(CreateRefundBody) },
  responses: {
    201: json(AdminRefundDto, 'Requested'),
    200: json(AdminRefundDto, 'Replay of an earlier request with the same key'),
    ...conflict,
    ...errorResponses,
  },
});

const approve = createRoute({
  method: 'post',
  path: '/admin/refunds/{id}/approve',
  tags: ['admin'],
  summary: 'Approve a refund request (not your own); an online refund goes to Razorpay now',
  security: secured,
  request: { params: z.object({ id: Id }), body: body(ApproveRefundBody) },
  responses: { 200: json(AdminRefundDto, 'Approved'), ...conflict, ...errorResponses },
});

const reject = createRoute({
  method: 'post',
  path: '/admin/refunds/{id}/reject',
  tags: ['admin'],
  summary: 'Decline a refund request with a reason code; the customer is told',
  security: secured,
  request: { params: z.object({ id: Id }), body: body(RejectRefundBody) },
  responses: { 200: json(AdminRefundDto, 'Declined'), ...conflict, ...errorResponses },
});

const markPaid = createRoute({
  method: 'post',
  path: '/admin/refunds/{id}/mark-paid',
  tags: ['admin'],
  summary: 'Record the UTR of a cash-on-delivery refund finance paid by hand',
  security: secured,
  request: { params: z.object({ id: Id }), body: body(MarkRefundPaidBody) },
  responses: { 200: json(AdminRefundDto, 'Paid'), ...conflict, ...errorResponses },
});

const settle = createRoute({
  method: 'post',
  path: '/admin/refunds/{id}/settle',
  tags: ['admin'],
  summary:
    'Settle a refund that needs checking by hand, after looking at Razorpay (not your own request; reason code and note required)',
  security: secured,
  request: { params: z.object({ id: Id }), body: body(SettleRefundBody) },
  responses: { 200: json(AdminRefundDto, 'Settled'), ...conflict, ...errorResponses },
});

const destination = createRoute({
  method: 'get',
  path: '/admin/refunds/{id}/destination',
  tags: ['admin'],
  summary: 'The full UPI id or bank account of an approved cash-on-delivery refund (audited)',
  security: secured,
  request: { params: z.object({ id: Id }) },
  responses: { 200: json(RefundDestinationDto, 'Destination'), ...conflict, ...errorResponses },
});

export function adminRefundRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern only: '/admin/refunds/*' also matches '/admin/refunds' (see admin-orders.ts).
  app.use('/admin/refunds/*', authenticate(deps, cache));
  app.use(
    '/admin/refunds/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/refunds/*', requireVerified);
  app.use('/admin/refunds/*', requirePermission('refunds:read'));
  app.on('POST', '/admin/refunds', requirePermission('refunds:initiate'));
  app.on('POST', '/admin/refunds/:id/approve', requirePermission('refunds:approve'));
  app.on('POST', '/admin/refunds/:id/reject', requirePermission('refunds:approve'));
  app.on('POST', '/admin/refunds/:id/mark-paid', requirePermission('refunds:approve'));
  app.on('POST', '/admin/refunds/:id/settle', requirePermission('refunds:approve'));
  app.on('GET', '/admin/refunds/:id/destination', requirePermission('refunds:approve'));

  const keyring = () => deps.keyring ?? undefined;

  return app
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      return c.json(
        await listAdminRefunds(deps.db, cityScopeFrom(c.get('auth').grants, 'refunds:read'), {
          view: q.view,
          cursor: q.cursor ?? null,
          ...(q.limit ? { limit: q.limit } : {}),
          staffUserId: c.get('auth').user.id,
          ...(keyring() ? { keyring: keyring() } : {}),
        }),
        200,
      );
    })
    .openapi(detail, async (c) =>
      c.json(
        await getAdminRefund(
          deps.db,
          cityScopeFrom(c.get('auth').grants, 'refunds:read'),
          c.get('auth').user.id,
          c.req.valid('param').id,
          keyring(),
        ),
        200,
      ),
    )
    .openapi(create, async (c) => {
      const b = c.req.valid('json');
      if (b.destination && !deps.keyring)
        throw new ApiError(503, 'ENCRYPTION_UNAVAILABLE', 'Payout details cannot be stored right now');
      const r = await createStaffRefund(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'refunds:initiate'),
        staffUserId: c.get('auth').user.id,
        orderCode: b.orderCode,
        amountPaise: b.amountPaise,
        source: b.source,
        reasonCode: b.reasonCode,
        note: b.note,
        destination: b.destination,
        keyring: keyring(),
        idempotencyKey: c.req.valid('header')['idempotency-key'],
      });
      return c.json(r.refund, r.replay ? 200 : 201);
    })
    .openapi(approve, async (c) => {
      const scope = cityScopeFrom(c.get('auth').grants, 'refunds:approve');
      const staffUserId = c.get('auth').user.id;
      const id = c.req.valid('param').id;
      const approved = await approveRefund(deps.db, {
        scope,
        staffUserId,
        refundId: id,
        expectedVersion: c.req.valid('json').version,
      });
      // Online refunds go to Razorpay now. A failure here is not the approver's problem: the worker retries.
      if (approved.mode === 'source' && deps.razorpay) await dispatchRefund(deps.db, deps.razorpay, id);
      return c.json(await getAdminRefund(deps.db, scope, staffUserId, id, keyring()), 200);
    })
    .openapi(reject, async (c) => {
      const b = c.req.valid('json');
      const r = await rejectRefund(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'refunds:approve'),
        staffUserId: c.get('auth').user.id,
        refundId: c.req.valid('param').id,
        expectedVersion: b.version,
        reasonCode: b.reasonCode,
        note: b.note,
      });
      return c.json(r, 200);
    })
    .openapi(markPaid, async (c) => {
      const b = c.req.valid('json');
      const r = await markRefundPaid(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'refunds:approve'),
        staffUserId: c.get('auth').user.id,
        refundId: c.req.valid('param').id,
        expectedVersion: b.version,
        reference: b.reference,
        ...(keyring() ? { keyring: keyring() } : {}),
      });
      return c.json(r, 200);
    })
    .openapi(settle, async (c) => {
      const b = c.req.valid('json');
      const r = await settleUnsureRefund(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'refunds:approve'),
        staffUserId: c.get('auth').user.id,
        refundId: c.req.valid('param').id,
        expectedVersion: b.version,
        outcome: b.outcome,
        reasonCode: b.reasonCode,
        note: b.note,
        providerRefundId: b.providerRefundId,
        providerAmountPaise: b.providerAmountPaise,
        ...(keyring() ? { keyring: keyring() } : {}),
      });
      return c.json(r, 200);
    })
    .openapi(destination, async (c) => {
      if (!deps.keyring)
        throw new ApiError(503, 'ENCRYPTION_UNAVAILABLE', 'Payout details cannot be read right now');
      const d = await revealRefundDestination(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'refunds:approve'),
        staffUserId: c.get('auth').user.id,
        refundId: c.req.valid('param').id,
        keyring: deps.keyring,
      });
      return c.json({ destination: d }, 200);
    });
}
