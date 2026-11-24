import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cancelUnpaidRsa,
  createRsaRequest,
  getCustomerRsa,
  getRsaAvailability,
  listCustomerRsa,
} from '@mechdost/db/repo';
import { PINCODE_RE } from '@mechdost/shared/geo';
import { CreateRsaRequestBody, RsaCodeParam } from '@mechdost/shared/rsa-api';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate, requirePermission } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { ensureRsaRazorpayOrder } from '../payments/service';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

/**
 * Customer roadside assistance (spec 22). Signed in with a phone code; a verified email is NOT required (user ruling
 * 2026-11-24). `Idempotency-Key` makes a retried request return the same one (201 first, 200 on replay). The advance and
 * the balance are paid through Razorpay with the amount read from the database. A customer reaches only their own
 * requests (foreign codes 404). The public availability check is IP rate limited and returns no request data.
 */
export const RSA_CREATE_RATE: RateRule = { name: 'rsa_create_user', limit: 6, windowSeconds: 600 };
export const RSA_PAY_RATE: RateRule = { name: 'rsa_pay_user', limit: 20, windowSeconds: 600 };
export const RSA_AVAILABILITY_RATE: RateRule = { name: 'rsa_availability_ip', limit: 60, windowSeconds: 60 };

const Anything = z.any();
const Created = z
  .object({ code: z.string(), status: z.string(), version: z.number().int(), advancePaise: z.number().int() })
  .openapi('RsaCreated');
const Checkout = z
  .object({
    keyId: z.string(),
    orderId: z.string(),
    amountPaise: z.number().int(),
    currency: z.literal('INR'),
  })
  .openapi('RsaCheckout');
const code = z.object({ code: RsaCodeParam.shape.code });

const availability = createRoute({
  method: 'get',
  path: '/roadside/availability',
  tags: ['roadside'],
  summary: 'Is roadside help available for this PIN code now, and at what advance (no sign-in)',
  request: { query: z.object({ pincode: z.string().regex(PINCODE_RE) }) },
  responses: { 200: json(Anything, 'Availability'), ...errorResponses },
});
const create = createRoute({
  method: 'post',
  path: '/roadside/requests',
  tags: ['roadside'],
  summary: 'Ask for roadside help (location, vehicle, optional problem); Idempotency-Key required',
  security: [{ bearerAuth: [] }],
  request: {
    headers: z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }),
    body: body(CreateRsaRequestBody.openapi('CreateRsaRequest')),
  },
  responses: { 201: json(Created, 'Created'), 200: json(Created, 'Replay'), ...conflict, ...errorResponses },
});
const list = createRoute({
  method: 'get',
  path: '/roadside/requests',
  tags: ['roadside'],
  summary: 'Your roadside requests, newest first',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(Anything, 'Requests'), ...errorResponses },
});
const detail = createRoute({
  method: 'get',
  path: '/roadside/requests/{code}',
  tags: ['roadside'],
  summary: 'One of your requests: status, responder, arrival code, bill and refunds',
  security: [{ bearerAuth: [] }],
  request: { params: code },
  responses: { 200: json(Anything, 'Request'), ...conflict, ...errorResponses },
});
const payAdvance = createRoute({
  method: 'post',
  path: '/roadside/requests/{code}/pay-advance',
  tags: ['roadside'],
  summary: 'The Razorpay order for the advance (amount from the request snapshot)',
  security: [{ bearerAuth: [] }],
  request: { params: code },
  responses: { 200: json(Checkout, 'Razorpay order'), ...conflict, ...errorResponses },
});
const payBalance = createRoute({
  method: 'post',
  path: '/roadside/requests/{code}/pay-balance',
  tags: ['roadside'],
  summary: 'The Razorpay order for the balance after the work (total minus the advance)',
  security: [{ bearerAuth: [] }],
  request: { params: code },
  responses: { 200: json(Checkout, 'Razorpay order'), ...conflict, ...errorResponses },
});
const cancelUnpaid = createRoute({
  method: 'post',
  path: '/roadside/requests/{code}/cancel',
  tags: ['roadside'],
  summary: 'Drop a request whose advance was never paid (the only customer cancellation at launch)',
  security: [{ bearerAuth: [] }],
  request: { params: code },
  responses: { 200: json(z.object({ ok: z.literal(true) }), 'Cancelled'), ...conflict, ...errorResponses },
});

export function roadsideRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/roadside/availability',
    rateLimit(deps.rateLimiter, RSA_AVAILABILITY_RATE, (c) => c.get('clientIp')),
  );
  app.use('/roadside/requests/*', authenticate(deps, cache));
  app.use('/roadside/requests', authenticate(deps, cache));
  for (const path of ['/roadside/requests', '/roadside/requests/*'])
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  app.on('POST', ['/roadside/requests', '/roadside/requests/*'], requirePermission('roadside:request'));
  app.on(
    'POST',
    '/roadside/requests',
    rateLimit(deps.rateLimiter, RSA_CREATE_RATE, (c) => c.get('auth').user.id),
  );
  for (const p of ['pay-advance', 'pay-balance'])
    app.on(
      'POST',
      `/roadside/requests/:code/${p}`,
      rateLimit(deps.rateLimiter, RSA_PAY_RATE, (c) => c.get('auth').user.id),
    );

  const payment = async (userId: string, codeValue: string, purpose: 'rsa_advance' | 'rsa_balance') => {
    const gateway = deps.razorpay;
    if (!gateway)
      throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Online payment is not available yet');
    return ensureRsaRazorpayOrder(deps.db, gateway, { userId, code: codeValue, purpose });
  };

  return app
    .openapi(availability, async (c) => {
      const out = await getRsaAvailability(deps.db, { pincode: c.req.valid('query').pincode });
      c.header('Cache-Control', 'public, max-age=30');
      return c.json(out, 200);
    })
    .openapi(create, async (c) => {
      const r = await createRsaRequest(deps.db, {
        userId: c.get('auth').user.id,
        idemKey: c.req.valid('header')['idempotency-key'],
        request: c.req.valid('json'),
      });
      const out = { code: r.code, status: r.status, version: r.version, advancePaise: r.advancePaise };
      return r.replayed ? c.json(out, 200) : c.json(out, 201);
    })
    .openapi(list, async (c) => c.json(await listCustomerRsa(deps.db, c.get('auth').user.id), 200))
    .openapi(detail, async (c) =>
      c.json(
        await getCustomerRsa(deps.db, {
          userId: c.get('auth').user.id,
          code: c.req.valid('param').code,
          keyring: deps.keyring ?? null,
        }),
        200,
      ),
    )
    .openapi(payAdvance, async (c) =>
      c.json(await payment(c.get('auth').user.id, c.req.valid('param').code, 'rsa_advance'), 200),
    )
    .openapi(payBalance, async (c) =>
      c.json(await payment(c.get('auth').user.id, c.req.valid('param').code, 'rsa_balance'), 200),
    )
    .openapi(cancelUnpaid, async (c) => {
      await cancelUnpaidRsa(deps.db, { userId: c.get('auth').user.id, code: c.req.valid('param').code });
      return c.json({ ok: true as const }, 200);
    });
}
