/**
 * Razorpay Standard Checkout over HTTP (plan 2026-11-12): placing an online order returns a stored Razorpay order
 * (a retried place reuses it); the checkout callback is verified against OUR order id and then fetched from
 * Razorpay before anything is marked paid; the webhook checks the raw-body signature and applies each event once.
 * A fake gateway stands in for Razorpay; payloads are signed locally (never a real call in tests).
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser } from '@mechdost/db/repo';
import type { RazorpayGateway, RazorpayPayment } from '../src/payments/razorpay';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const BATTERY = fixture.products.find((p) => p.slug === 'exide-xltz4a-2w-battery')?.sku ?? '';
const KEY_SECRET = 'test_key_secret_0123456789';
const WEBHOOK_SECRET = 'test_webhook_secret_01';
const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_Fake0123456789',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

class FakeRazorpay implements RazorpayGateway {
  keyId = ENV.RAZORPAY_KEY_ID;
  ordersCreated = 0;
  payments = new Map<string, RazorpayPayment>();
  createOrder(input: { amountPaise: number }) {
    this.ordersCreated += 1;
    return Promise.resolve({
      id: `order_Fake${String(this.ordersCreated).padStart(6, '0')}`,
      amountPaise: input.amountPaise,
      currency: 'INR',
    });
  }
  fetchPayment(id: string) {
    const p = this.payments.get(id);
    return p ? Promise.resolve(p) : Promise.reject(new Error('unknown payment'));
  }
}

let ctx: Awaited<ReturnType<typeof buildApp>>;
let razorpay: FakeRazorpay;
let ravi: Record<string, string>;
let asha: Record<string, string>;
let keyN = 0;

async function person(n: string) {
  const phone = `+9198333333${n}`;
  const token = ctx.verifier.add(`token-payments-0000${n}`, {
    firebaseUid: `pay-${n}`,
    phone,
    email: `pay-${n}@example.com`,
    emailVerified: true,
  });
  await ensureUser(ctx.db, {
    firebaseUid: `pay-${n}`,
    phone,
    email: `pay-${n}@example.com`,
    emailVerified: true,
  });
  return { ...bearer(token), 'content-type': 'application/json' };
}

async function placeOnline(headers: Record<string, string>, key?: string) {
  const lines = [{ sku: BATTERY, qty: 1 }];
  const q = (await (
    await ctx.app.request('/v1/checkout/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pincode: '492004', lines }),
    })
  ).json()) as { onlineTotalPaise: number };
  keyN += 1;
  const res = await ctx.app.request('/v1/orders', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': key ?? `payments-api-key-${String(keyN).padStart(6, '0')}` },
    body: JSON.stringify({
      address: {
        contactName: 'Ravi Sahu',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        pincode: '492004',
      },
      lines,
      expectedTotalPaise: q.onlineTotalPaise,
      paymentMethod: 'online',
      locale: 'en',
    }),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      code: string;
      totalPaise: number;
      paymentStatus: string;
      razorpay: { keyId: string; orderId: string; amountPaise: number; currency: string } | null;
    },
  };
}

const sign = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

const verify = (headers: Record<string, string>, orderId: string, paymentId: string, signature: string) =>
  ctx.app.request('/v1/payments/razorpay/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    }),
  });

const orderStatus = async (headers: Record<string, string>, code: string) =>
  ((await (await ctx.app.request(`/v1/orders/${code}`, { headers })).json()) as { paymentStatus: string })
    .paymentStatus;

beforeAll(async () => {
  razorpay = new FakeRazorpay();
  ctx = await buildApp({ env: ENV, razorpay });
  await seedRaipurDemo(ctx.db, fixture);
  ravi = await person('01');
  asha = await person('02');
});

describe('placing an order paid online', () => {
  it('returns a stored Razorpay order; a retried place reuses it', async () => {
    const before = razorpay.ordersCreated;
    const first = await placeOnline(ravi, 'payments-api-retry-000001');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ paymentStatus: 'created' });
    expect(first.body.razorpay).toMatchObject({
      keyId: ENV.RAZORPAY_KEY_ID,
      amountPaise: first.body.totalPaise,
      currency: 'INR',
    });
    const again = await placeOnline(ravi, 'payments-api-retry-000001');
    expect(again.status).toBe(200);
    expect(again.body.razorpay?.orderId).toBe(first.body.razorpay?.orderId);
    expect(razorpay.ordersCreated).toBe(before + 1);
  });
});

describe('the checkout callback', () => {
  it('a valid signature plus a captured payment marks the order paid', async () => {
    const { body } = await placeOnline(ravi);
    const orderId = body.razorpay!.orderId;
    razorpay.payments.set('pay_Good000001', {
      id: 'pay_Good000001',
      orderId,
      status: 'captured',
      amountPaise: body.totalPaise,
      currency: 'INR',
      method: 'upi',
    });
    const res = await verify(ravi, orderId, 'pay_Good000001', sign(orderId, 'pay_Good000001'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderCode: body.code, outcome: 'paid' });
    expect(await orderStatus(ravi, body.code)).toBe('paid');
  });

  it('a wrong signature is refused and changes nothing', async () => {
    const { body } = await placeOnline(ravi);
    const orderId = body.razorpay!.orderId;
    const res = await verify(ravi, orderId, 'pay_Forged00001', sign(orderId, 'pay_Other00001'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorJson).error.code).toBe('SIGNATURE_INVALID');
    expect(await orderStatus(ravi, body.code)).toBe('created');
  });

  it("someone else's order is 404", async () => {
    const { body } = await placeOnline(ravi);
    const orderId = body.razorpay!.orderId;
    const res = await verify(asha, orderId, 'pay_Theft000001', sign(orderId, 'pay_Theft000001'));
    expect(res.status).toBe(404);
  });

  it('a valid signature alone does not mark paid while Razorpay has not captured', async () => {
    const { body } = await placeOnline(ravi);
    const orderId = body.razorpay!.orderId;
    razorpay.payments.set('pay_Pending0001', {
      id: 'pay_Pending0001',
      orderId,
      status: 'created',
      amountPaise: body.totalPaise,
      currency: 'INR',
      method: null,
    });
    const res = await verify(ravi, orderId, 'pay_Pending0001', sign(orderId, 'pay_Pending0001'));
    expect(await res.json()).toEqual({ orderCode: body.code, outcome: 'unchanged' });
    expect(await orderStatus(ravi, body.code)).toBe('created');
  });
});

describe('the webhook', () => {
  const event = (orderId: string, amountPaise: number, paymentId: string, name = 'payment.captured') =>
    JSON.stringify({
      event: name,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            status: 'captured',
            amount: amountPaise,
            currency: 'INR',
            method: 'card',
          },
        },
      },
    });
  const post = (raw: string, eventId: string, signature?: string) =>
    ctx.app.request('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-event-id': eventId,
        'x-razorpay-signature': signature ?? createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
      },
      body: raw,
    });

  it('refuses a bad signature', async () => {
    const { body } = await placeOnline(ravi);
    const raw = event(body.razorpay!.orderId, body.totalPaise, 'pay_Hook000001');
    expect((await post(raw, 'evt_bad000001', 'ab'.repeat(32))).status).toBe(400);
    expect(await orderStatus(ravi, body.code)).toBe('created');
  });

  it('applies a captured payment once, however often it is delivered', async () => {
    const { body } = await placeOnline(ravi);
    const raw = event(body.razorpay!.orderId, body.totalPaise, 'pay_Hook000002');
    expect((await post(raw, 'evt_once000001')).status).toBe(200);
    expect((await post(raw, 'evt_once000001')).status).toBe(200);
    expect(await orderStatus(ravi, body.code)).toBe('paid');
  });

  it('never marks paid for a different amount', async () => {
    const { body } = await placeOnline(ravi);
    const raw = event(body.razorpay!.orderId, body.totalPaise - 100, 'pay_Hook000003');
    expect((await post(raw, 'evt_amount00001')).status).toBe(200);
    expect(await orderStatus(ravi, body.code)).toBe('created');
  });

  it('is off (404) until the webhook secret is set', async () => {
    const off = await buildApp({
      env: { RAZORPAY_KEY_ID: ENV.RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET },
      razorpay: new FakeRazorpay(),
    });
    const res = await off.app.request('/webhooks/razorpay', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });
});
