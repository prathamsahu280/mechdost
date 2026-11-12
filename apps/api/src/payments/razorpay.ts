import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Razorpay Standard Checkout, server side (plan 2026-11-12; razorpay-payments skill). Two REST calls with HTTP Basic
 * auth — create an order, fetch a payment — so no SDK (dependency policy, docs/research/security-vulnerabilities.md).
 * Docs (verified 2026-11-12): https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
 */
export interface RazorpayOrder {
  id: string;
  amountPaise: number;
  currency: string;
}

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  /** `created` | `authorized` | `captured` | `refunded` | `failed` */
  status: string;
  amountPaise: number;
  currency: string;
  method: string | null;
}

export interface RazorpayGateway {
  /** Public key id the browser needs to open Checkout. */
  keyId: string;
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
}

export class RazorpayError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

const OrderJson = z.object({ id: z.string().min(1).max(64), amount: z.number().int(), currency: z.string() });
const PaymentJson = z.object({
  id: z.string().min(1).max(64),
  order_id: z.string().max(64).nullable().optional(),
  status: z.string().max(30),
  amount: z.number().int(),
  currency: z.string(),
  method: z.string().max(30).nullable().optional(),
});

/** The real gateway (fetch with an 8 s timeout). Errors carry Razorpay's HTTP status, never the response body. */
export function httpRazorpay(keyId: string, keySecret: string): RazorpayGateway {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  async function call(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: { authorization: auth, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
      throw new RazorpayError(
        res.status,
        `Razorpay ${path.split('/')[1] ?? ''} failed (${String(res.status)})`,
      );
    return res.json();
  }
  return {
    keyId,
    async createOrder(input) {
      const body = OrderJson.parse(
        await call('/orders', {
          method: 'POST',
          body: JSON.stringify({
            amount: input.amountPaise,
            currency: 'INR',
            receipt: input.receipt,
            notes: input.notes,
          }),
        }),
      );
      return { id: body.id, amountPaise: body.amount, currency: body.currency };
    },
    async fetchPayment(paymentId) {
      if (!/^pay_[A-Za-z0-9]{1,40}$/.test(paymentId)) throw new RazorpayError(400, 'Invalid payment id');
      return toPayment(PaymentJson.parse(await call(`/payments/${paymentId}`, { method: 'GET' })));
    },
  };
}

function toPayment(p: z.infer<typeof PaymentJson>): RazorpayPayment {
  return {
    id: p.id,
    orderId: p.order_id ?? null,
    status: p.status,
    amountPaise: p.amount,
    currency: p.currency,
    method: p.method ?? null,
  };
}

function safeEqualHex(givenHex: string, expected: Buffer): boolean {
  if (!/^[0-9a-f]+$/i.test(givenHex)) return false;
  const given = Buffer.from(givenHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Checkout callback: HMAC_SHA256(our order id + "|" + payment id, key secret), constant-time compare. */
export function checkoutSignatureValid(input: {
  providerOrderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const expected = createHmac('sha256', input.keySecret)
    .update(`${input.providerOrderId}|${input.paymentId}`)
    .digest();
  return safeEqualHex(input.signature, expected);
}

/** Webhook: `X-Razorpay-Signature` = HMAC_SHA256(raw body, webhook secret), checked before parsing. */
export function webhookSignatureValid(raw: Uint8Array, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  return safeEqualHex(header, createHmac('sha256', secret).update(raw).digest());
}

/** The payment entity inside a webhook (`payment.captured`, `payment.failed`, `order.paid`). */
export const WebhookPayload = z.object({
  event: z.string().max(60),
  payload: z.object({ payment: z.object({ entity: PaymentJson }).optional() }),
});

export function paymentFromWebhook(body: z.infer<typeof WebhookPayload>): RazorpayPayment | null {
  const entity = body.payload.payment?.entity;
  return entity ? toPayment(entity) : null;
}
