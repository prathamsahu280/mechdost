/**
 * Paying an accepted bulk quote online (spec 19 "Online payment", spec 03; razorpay-payments skill). Accepting with
 * `paymentMethod: 'online'` places the normal unpaid online order at the negotiated prices and returns the Razorpay
 * handle; the existing verify route and webhook settle it (amount asserted, monotonic, deduped). A fake gateway stands
 * in for Razorpay and payloads are signed locally: no real call is ever made.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { QuoteAcceptedDto, QuoteDetailDto, QuotePageDto, QuotePayDto } from '@mechdost/shared/quote-api';
import type { RazorpayGateway, RazorpayPayment } from '../src/payments/razorpay';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

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
      id: `order_QFake${String(this.ordersCreated).padStart(6, '0')}`,
      amountPaise: input.amountPaise,
      currency: 'INR' as const,
    });
  }
  fetchPayment(id: string) {
    const p = this.payments.get(id);
    return p ? Promise.resolve(p) : Promise.reject(new Error('unknown payment'));
  }
  createRefund(): Promise<never> {
    return Promise.reject(new Error('refunds are not part of these tests'));
  }
  findRefund(): Promise<null> {
    return Promise.resolve(null);
  }
}

let ctx: Awaited<ReturnType<typeof buildApp>>;
let razorpay: FakeRazorpay;
let ops: Record<string, string>;
let ravi: Record<string, string>;
let asha: Record<string, string>;
let n = 0;
const key = () => ({ 'idempotency-key': `quote-pay-key-${String(++n).padStart(6, '0')}` });

async function person(id: string, role?: string) {
  const identity = {
    firebaseUid: `quote-pay-${id}`,
    phone: `+9198444444${id}`,
    email: `quote-pay-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-quote-pay-0000${id}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: null, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const call = async (
  headers: Record<string, string>,
  method: string,
  path: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...headers, ...extra },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

/** A quote of 10 oils (₹400 each, ₹4,000: above a ₹3,000 cash ceiling) with an active offer; returns its code. */
async function offeredQuote(customer = ravi, unitPaise = 40_000): Promise<string> {
  const made = await call(
    customer,
    'POST',
    '/quotes',
    {
      lines: [{ slug: 'castrol-activ-4t-20w40-900ml', qty: 10 }],
      address: {
        contactName: 'Ravi Sahu',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        pincode: '492004',
      },
      note: 'For my garage',
      locale: 'en',
    },
    key(),
  );
  const code = String(made.body.code);
  const q = QuoteDetailDto.parse((await call(ops, 'GET', `/admin/quotes/${code}`)).body);
  const offer = await call(ops, 'POST', `/admin/quotes/${code}/offer`, {
    version: q.version,
    lines: q.lineItems.map((l) => ({ lineNo: l.lineNo, unitPaise })),
    deliveryPaise: 0,
    validDays: 3,
    confirmLowPrices: true,
  });
  expect(offer.status).toBe(200);
  return code;
}

const accept = (code: string, method: 'cod' | 'online' | undefined, k = key(), who = ravi) =>
  call(
    who,
    'POST',
    `/quotes/${code}/accept`,
    { offerVersion: 1, ...(method ? { paymentMethod: method } : {}) },
    k,
  );

const sign = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

const verify = (who: Record<string, string>, orderId: string, paymentId: string, signature: string) =>
  call(who, 'POST', '/payments/razorpay/verify', {
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature,
  });

const paymentStatus = async (who: Record<string, string>, orderCode: string) =>
  String((await call(who, 'GET', `/orders/${orderCode}`)).body.paymentStatus);

beforeAll(async () => {
  razorpay = new FakeRazorpay();
  ctx = await buildApp({ env: ENV, razorpay });
  await seedRaipurDemo(ctx.db, fixture);
  await ctx.db.insert(s.settings).values({ key: 'quotes.cod_cap_paise', value: 300_000 });
  // Each online accept holds 10 units for the payment window: plenty of stock for the whole file.
  await ctx.db.update(s.shopInventory).set({ onHand: 500 });
  ops = await person('01', 'ops_manager');
  ravi = await person('02');
  asha = await person('03');
});

describe('accepting a quote offer online', () => {
  it('places the unpaid online order, returns the Razorpay handle and reuses it for the same key', async () => {
    const code = await offeredQuote();
    const k = key();
    const before = razorpay.ordersCreated;
    const first = await accept(code, 'online', k);
    expect(first.status).toBe(201);
    const body = QuoteAcceptedDto.parse(first.body);
    expect(body).toMatchObject({ paymentMethod: 'online', totalPaise: 400_000, replayed: false });
    expect(body.razorpay).toMatchObject({
      keyId: ENV.RAZORPAY_KEY_ID,
      amountPaise: 400_000,
      currency: 'INR',
    });
    expect(await paymentStatus(ravi, body.orderCode)).toBe('created');

    const again = await accept(code, 'online', k);
    expect(again.status).toBe(200);
    expect(QuoteAcceptedDto.parse(again.body).razorpay?.orderId).toBe(body.razorpay?.orderId);
    expect(razorpay.ordersCreated).toBe(before + 1); // one Razorpay order for the group, ever
  });

  it('cash on delivery above the ceiling stays refused, and it is the default method', async () => {
    const code = await offeredQuote();
    const cod = await accept(code, undefined);
    expect(cod.status).toBe(422);
    expect(cod.body.error.code).toBe('QUOTE_COD_CAP');
    const detail = QuoteDetailDto.parse((await call(ravi, 'GET', `/quotes/${code}`)).body);
    expect(detail.status).toBe('offered');
    await call(ravi, 'POST', `/quotes/${code}/decline`, { reasonCode: 'no_longer_needed' });
  });

  it('a captured payment of the right amount marks the order paid through the existing verify route', async () => {
    const code = await offeredQuote();
    const body = QuoteAcceptedDto.parse((await accept(code, 'online')).body);
    const orderId = body.razorpay!.orderId;
    razorpay.payments.set('pay_QGood000001', {
      id: 'pay_QGood000001',
      orderId,
      status: 'captured',
      amountPaise: 400_000,
      currency: 'INR',
      method: 'upi',
    });
    const res = await verify(ravi, orderId, 'pay_QGood000001', sign(orderId, 'pay_QGood000001'));
    expect(res.body).toEqual({ orderCode: body.orderCode, outcome: 'paid' });
    expect(await paymentStatus(ravi, body.orderCode)).toBe('paid');
  });

  it('a captured payment of another amount never marks it paid; another customer gets 404', async () => {
    const code = await offeredQuote();
    const body = QuoteAcceptedDto.parse((await accept(code, 'online')).body);
    const orderId = body.razorpay!.orderId;
    razorpay.payments.set('pay_QShort00001', {
      id: 'pay_QShort00001',
      orderId,
      status: 'captured',
      amountPaise: 300_000,
      currency: 'INR',
      method: 'upi',
    });
    const res = await verify(ravi, orderId, 'pay_QShort00001', sign(orderId, 'pay_QShort00001'));
    expect(res.body.outcome).toBe('mismatch');
    expect(await paymentStatus(ravi, body.orderCode)).toBe('created');
    const theft = await verify(asha, orderId, 'pay_QShort00001', sign(orderId, 'pay_QShort00001'));
    expect(theft.status).toBe(404);
  });

  it('the Razorpay webhook settles it too, once however often it is delivered', async () => {
    const code = await offeredQuote();
    const body = QuoteAcceptedDto.parse((await accept(code, 'online')).body);
    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_QHook000001',
            order_id: body.razorpay!.orderId,
            status: 'captured',
            amount: 400_000,
            currency: 'INR',
            method: 'card',
          },
        },
      },
    });
    const hook = () =>
      ctx.app.request('/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'x-razorpay-event-id': 'evt_quote_0001',
          'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
        },
        body: raw,
      });
    expect((await hook()).status).toBe(200);
    expect((await hook()).status).toBe(200);
    expect(await paymentStatus(ravi, body.orderCode)).toBe('paid');
  });

  it('"Pay now" after a closed window reuses the same Razorpay order; other customers get 404, cash orders 409', async () => {
    const code = await offeredQuote();
    const body = QuoteAcceptedDto.parse((await accept(code, 'online')).body);
    const before = razorpay.ordersCreated;
    const pay = await call(ravi, 'POST', `/quotes/${code}/pay`);
    expect(pay.status).toBe(200);
    expect(QuotePayDto.parse(pay.body)).toMatchObject({
      orderCode: body.orderCode,
      razorpay: { orderId: body.razorpay?.orderId, amountPaise: 400_000 },
    });
    expect(razorpay.ordersCreated).toBe(before);
    expect((await call(asha, 'POST', `/quotes/${code}/pay`)).status).toBe(404);
    const detail = QuoteDetailDto.parse((await call(ravi, 'GET', `/quotes/${code}`)).body);
    expect(detail.orderPayment).toEqual({ method: 'online', status: 'created' });

    // A quote accepted for cash on delivery has nothing to pay online.
    const cash = await offeredQuote(ravi, 20_000); // ₹2,000: within the cash ceiling
    await accept(cash, 'cod');
    const refused = await call(ravi, 'POST', `/quotes/${cash}/pay`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('QUOTE_NOT_PAYABLE');
  });

  it('is refused with 422 and changes nothing when online payment is not set up', async () => {
    const off = await buildApp({});
    await seedRaipurDemo(off.db, fixture);
    const id = {
      firebaseUid: 'quote-pay-off',
      phone: '+919844444499',
      email: 'off@example.com',
      emailVerified: true,
    };
    const token = off.verifier.add('token-quote-pay-off-00', id);
    const user = await ensureUser(off.db, id);
    await grantRole(off.db, { userId: user.id, role: 'ops_manager', cityId: null, grantedBy: null });
    const h = { ...bearer(token), 'content-type': 'application/json' };
    const res = (path: string, method: string, payload?: unknown, extra: Record<string, string> = {}) =>
      off.app.request(`/v1${path}`, {
        method,
        headers: { ...h, ...extra },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    const made = (await (
      await res(
        '/quotes',
        'POST',
        {
          lines: [{ slug: 'castrol-activ-4t-20w40-900ml', qty: 10 }],
          address: {
            contactName: 'Ravi',
            contactPhone: '+919876543210',
            line1: 'House 12, Pandri',
            pincode: '492004',
          },
          locale: 'en',
        },
        key(),
      )
    ).json()) as { code: string };
    const q = QuoteDetailDto.parse(await (await res(`/admin/quotes/${made.code}`, 'GET')).json());
    await res(`/admin/quotes/${made.code}/offer`, 'POST', {
      version: q.version,
      lines: q.lineItems.map((l) => ({ lineNo: l.lineNo, unitPaise: 40_000 })),
      deliveryPaise: 0,
      validDays: 3,
      confirmLowPrices: true,
    });
    const r = await res(
      `/quotes/${made.code}/accept`,
      'POST',
      { offerVersion: 1, paymentMethod: 'online' },
      key(),
    );
    expect(r.status).toBe(422);
    expect(((await r.json()) as ErrorJson).error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const page = QuotePageDto.parse(await (await res('/quotes', 'GET')).json());
    expect(page.items.find((x) => x.code === made.code)?.status).toBe('offered');
  });
});
