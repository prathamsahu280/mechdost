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
import { cancelMyOrder, ensureUser } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { setLogSink } from '../src/logger';
import type { RazorpayGateway, RazorpayPayment } from '../src/payments/razorpay';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const skuOf = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? '';
const BATTERY = skuOf('exide-xltz4a-2w-battery');
// Two shops serve this cart: one order group, two sub-orders.
const TWO_SHOP_CART = [
  { sku: skuOf('castrol-activ-4t-20w40-900ml'), qty: 1 },
  { sku: skuOf('scooter-tubeless-tyre-90-90-12'), qty: 1 },
];
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
  /** Runs once while the next Razorpay order is being created (to race a cancel against it). */
  duringCreate: (() => Promise<void>) | null = null;
  async createOrder(input: { amountPaise: number }) {
    this.ordersCreated += 1;
    const hook = this.duringCreate;
    this.duringCreate = null;
    if (hook) await hook();
    return {
      id: `order_Fake${String(this.ordersCreated).padStart(6, '0')}`,
      amountPaise: input.amountPaise,
      currency: 'INR' as const,
    };
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

async function placeOnline(
  headers: Record<string, string>,
  key?: string,
  lines: { sku: string; qty: number }[] = [{ sku: BATTERY, qty: 1 }],
) {
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
      orders: { code: string; totalPaise: number }[];
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
  // These tests cancel as the customer, which is off by default (Q25: cancel through support only).
  await ctx.db.insert(s.settings).values({ key: 'orders.customer_self_cancel', value: true });
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

describe('final review 2026-11-12', () => {
  it('after one part is cancelled, paying asks only for what is left, with a new Razorpay order', async () => {
    const key = 'payments-api-partial-00001';
    const meera = await person('03');
    const first = await placeOnline(meera, key, TWO_SHOP_CART);
    expect(first.status).toBe(201);
    expect(first.body.orders).toHaveLength(2);
    const [gone, kept] = first.body.orders;
    const sub = (await ctx.db.select().from(s.orders)).find((o) => o.code === gone!.code);
    const user = (await ctx.db.select().from(s.users)).find((u) => u.firebaseUid === 'pay-03');
    await cancelMyOrder(ctx.db, {
      userId: user!.id,
      code: gone!.code,
      reasonCode: 'changed_mind',
      expectedVersion: sub!.version,
    });
    const again = await placeOnline(meera, key, TWO_SHOP_CART);
    expect(again.status).toBe(200);
    expect(again.body.razorpay?.amountPaise).toBe(kept!.totalPaise);
    expect(again.body.razorpay?.orderId).not.toBe(first.body.razorpay?.orderId);
  });

  it('the checkout callback logs money that needs a refund, like the webhook does', async () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    try {
      const placed = await placeOnline(asha);
      const orderId = placed.body.razorpay!.orderId;
      for (const id of ['pay_FirstApi0001', 'pay_SecondApi001']) {
        razorpay.payments.set(id, {
          id,
          orderId,
          status: 'captured',
          amountPaise: placed.body.totalPaise,
          currency: 'INR',
          method: 'upi',
        });
      }
      await verify(asha, orderId, 'pay_FirstApi0001', sign(orderId, 'pay_FirstApi0001'));
      const res = await verify(asha, orderId, 'pay_SecondApi001', sign(orderId, 'pay_SecondApi001'));
      expect(((await res.json()) as { outcome: string }).outcome).toBe('needs_refund');
      expect(
        lines.some((l) => l.includes('"severity":"ERROR"') && l.includes('razorpay_verify_needs_refund')),
      ).toBe(true);
    } finally {
      setLogSink(() => undefined);
    }
  });

  it('a part cancelled while Razorpay creates the order is never charged (security review 2026-11-12)', async () => {
    const dev = await person('04');
    const user = (await ctx.db.select().from(s.users)).find((u) => u.firebaseUid === 'pay-04');
    razorpay.duringCreate = async () => {
      const groups = (await ctx.db.select().from(s.orderGroups)).filter((g) => g.userId === user!.id);
      const subs = (await ctx.db.select().from(s.orders)).filter((o) => o.groupId === groups[0]!.id);
      const first = subs.sort((a, b) => a.code.localeCompare(b.code))[0]!;
      await cancelMyOrder(ctx.db, {
        userId: user!.id,
        code: first.code,
        reasonCode: 'changed_mind',
        expectedVersion: first.version,
      });
    };
    const placed = await placeOnline(dev, 'payments-api-race-000001', TWO_SHOP_CART);
    expect(placed.status).toBe(201);
    const kept = [...placed.body.orders].sort((a, b) => a.code.localeCompare(b.code))[1]!;
    expect(placed.body.razorpay?.amountPaise).toBe(kept.totalPaise);
    const group = (await ctx.db.select().from(s.orderGroups)).find((g) => g.code === placed.body.code);
    const stored = (await ctx.db.select().from(s.payments)).filter((p) => p.groupId === group!.id);
    expect(stored.map((p) => p.amountPaise)).toEqual([kept.totalPaise]);
  });
});
