import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { Hono } from 'hono';
import { recordAndApplyRazorpayEvent } from '@mechdost/db/repo';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { log } from '../logger';
import { authenticate, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { paymentFromWebhook, WebhookPayload, webhookSignatureValid } from '../payments/razorpay';
import { paymentFact, verifyCheckout } from '../payments/service';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/**
 * Razorpay Standard Checkout (plan 2026-11-12; spec 03):
 * - `POST /v1/payments/razorpay/verify` — the checkout callback. Signed-in owner only; HMAC over OUR stored order id;
 *   then the payment is fetched from Razorpay and applied (amount + currency checked, monotonic state).
 * - `POST /v1/webhooks/razorpay` — raw-body HMAC (`X-Razorpay-Signature`, webhook secret) checked before parsing,
 *   each event recorded once (`x-razorpay-event-id`), payment facts applied. 404 until the webhook secret is set.
 */
const VerifyBody = z
  .object({
    razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]{1,40}$/),
    razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,40}$/),
    razorpaySignature: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .openapi('VerifyRazorpayPayment');

const verify = createRoute({
  method: 'post',
  path: '/payments/razorpay/verify',
  tags: ['checkout'],
  summary: 'Verify a Razorpay Checkout payment (signature, then a server fetch) and record it',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: VerifyBody } } } },
  responses: {
    200: {
      description: 'Recorded; `paid` once Razorpay confirms the capture',
      content: {
        'application/json': {
          schema: z.object({
            orderCode: z.string(),
            outcome: z.enum([
              'paid',
              'attempted',
              'failed',
              'unchanged',
              'mismatch',
              'unknown_order',
              'needs_refund',
            ]),
          }),
        },
      },
    },
    ...errorResponses,
  },
});

export function paymentRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/payments/*', authenticate(deps, cache));
  app.use(
    '/payments/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/payments/*', requireVerified);
  return app.openapi(verify, async (c) => {
    const gateway = deps.razorpay;
    const secret = deps.config.razorpay?.keySecret;
    if (!gateway || !secret)
      throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Online payment is not available yet');
    const body = c.req.valid('json');
    const result = await verifyCheckout(deps.db, gateway, secret, {
      userId: c.get('auth').user.id,
      providerOrderId: body.razorpayOrderId,
      paymentId: body.razorpayPaymentId,
      signature: body.razorpaySignature,
    });
    return c.json(result, 200);
  });
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAYMENT_EVENTS = new Set(['payment.captured', 'payment.authorized', 'payment.failed', 'order.paid']);

export function razorpayWebhookRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.post(
    '/webhooks/razorpay',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerIp, (c) => c.get('clientIp')),
    async (c) => {
      const secret = deps.config.razorpay?.webhookSecret;
      if (!secret) return c.notFound();
      const raw = new Uint8Array(await c.req.arrayBuffer());
      if (!webhookSignatureValid(raw, c.req.header('x-razorpay-signature'), secret)) {
        log('warn', 'razorpay_webhook_bad_signature', { requestId: c.get('requestId') });
        return c.text('invalid signature', 400);
      }
      const eventId = c.req.header('x-razorpay-event-id') ?? '';
      if (!EVENT_ID.test(eventId)) return c.text('missing event id', 400);
      let body: z.infer<typeof WebhookPayload>;
      try {
        body = WebhookPayload.parse(JSON.parse(new TextDecoder().decode(raw)));
      } catch {
        // Signed by Razorpay but a shape we do not handle: acknowledge so it is not retried.
        log('warn', 'razorpay_webhook_unparsed', { requestId: c.get('requestId') });
        return c.text('ok', 200);
      }
      const payment = paymentFromWebhook(body);
      const fact =
        PAYMENT_EVENTS.has(body.event) && payment?.orderId ? paymentFact(payment, payment.orderId) : null;
      // Recorded once and applied in the same transaction (a failed apply leaves the event unseen for the retry).
      const { outcome } = await recordAndApplyRazorpayEvent(deps.db, {
        eventId: `rzp:${eventId}`,
        type: body.event,
        payload: payment ? { orderId: payment.orderId, paymentId: payment.id, status: payment.status } : {},
        fact,
      });
      if (outcome === 'mismatch' || outcome === 'unknown_order' || outcome === 'needs_refund')
        log('error', `razorpay_webhook_${outcome}`, { requestId: c.get('requestId'), event: body.event });
      return c.text('ok', 200);
    },
  );
  return app;
}
