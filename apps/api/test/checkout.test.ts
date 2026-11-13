/**
 * Checkout API (spec 03): public quotes; placing needs a signed-in, verified customer and an Idempotency-Key;
 * replays return the same order (200), price changes 409, unavailable lines 422 with details, online payment
 * 422 until Razorpay.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser } from '@mechdost/db/repo';
import { orderGroups } from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let verified: Record<string, string>;
let unverified: Record<string, string>;

async function person(n: string, emailVerified: boolean) {
  const phone = `+9198444444${n}`;
  const token = ctx.verifier.add(`token-checkout-0000${n}`, {
    firebaseUid: `co-${n}`,
    phone,
    email: `co-${n}@example.com`,
    emailVerified,
  });
  await ensureUser(ctx.db, { firebaseUid: `co-${n}`, phone, email: `co-${n}@example.com`, emailVerified });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const address = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  pincode: '492004',
};

async function quoteTotal(lines: { sku: string; qty: number }[]) {
  const res = await ctx.app.request('/v1/checkout/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pincode: '492004', lines }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { totalPaise: number }).totalPaise;
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  verified = await person('01', true);
  unverified = await person('02', false);
});

describe('checkout API', () => {
  it('quotes a cart without sign-in and validates it strictly', async () => {
    const res = await ctx.app.request('/v1/checkout/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pincode: '492004', lines: [{ sku: OIL, qty: 2 }], locale: 'hi' }),
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      subtotalPaise: 88000,
      groups: [{ seller: 'शर्मा ऑटो पार्ट्स' }],
    });
    for (const body of [
      { pincode: '492004', lines: [] },
      { pincode: '492004', lines: [{ sku: OIL, qty: 100 }] },
      {
        pincode: '492004',
        lines: [
          { sku: OIL, qty: 1 },
          { sku: OIL, qty: 1 },
        ],
      },
      { pincode: '492004', lines: [{ sku: OIL, qty: 1, pricePaise: 1 }] },
    ]) {
      const bad = await ctx.app.request('/v1/checkout/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(bad.status).toBe(400);
    }
  });

  it('places a COD order once per key; guards sign-in, verification, payment method and price', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const expectedTotalPaise = await quoteTotal(lines);
    const body = JSON.stringify({ address, lines, expectedTotalPaise, paymentMethod: 'cod' });
    const send = (headers: Record<string, string>, payload = body) =>
      ctx.app.request('/v1/orders', { method: 'POST', headers, body: payload });
    const keyed = (h: Record<string, string>, k = 'order-key-0000000001') => ({ ...h, 'idempotency-key': k });

    expect(
      (await send({ 'content-type': 'application/json', 'idempotency-key': 'order-key-0000000001' })).status,
    ).toBe(401);
    const blocked = await send(keyed(unverified));
    expect(((await blocked.json()) as ErrorJson).error.code).toBe('VERIFICATION_REQUIRED');
    expect((await send(verified)).status).toBe(400); // no Idempotency-Key

    const online = await send(
      keyed(verified),
      JSON.stringify({ address, lines, expectedTotalPaise, paymentMethod: 'online' }),
    );
    expect(((await online.json()) as ErrorJson).error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');

    const first = await send(keyed(verified));
    expect(first.status).toBe(201);
    const placed = (await first.json()) as { code: string; replayed: boolean };
    const again = await send(keyed(verified));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { code: string }).code).toBe(placed.code);

    const changed = await send(
      keyed(verified, 'order-key-0000000002'),
      JSON.stringify({ address, lines, expectedTotalPaise: expectedTotalPaise + 1, paymentMethod: 'cod' }),
    );
    expect(changed.status).toBe(409);
    expect(((await changed.json()) as ErrorJson).error.code).toBe('PRICE_CHANGED');

    const tooMany = await send(
      keyed(verified, 'order-key-0000000003'),
      JSON.stringify({ address, lines: [{ sku: OIL, qty: 99 }], expectedTotalPaise, paymentMethod: 'cod' }),
    );
    expect(tooMany.status).toBe(422);
    expect(((await tooMany.json()) as ErrorJson).error).toMatchObject({
      code: 'CHECKOUT_UNAVAILABLE',
      details: { lines: [{ sku: OIL, issue: 'insufficient_stock' }] },
    });
  });
});

describe('business purchase with a GSTIN (plan 2026-11-13 buyer GSTIN)', () => {
  it('places with a business GSTIN; refuses a bad checksum or half the pair; the quote names the delivery state', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const expectedTotalPaise = await quoteTotal(lines);
    const send = (k: string, business: unknown) =>
      ctx.app.request('/v1/orders', {
        method: 'POST',
        headers: { ...verified, 'idempotency-key': k },
        body: JSON.stringify({ address, lines, expectedTotalPaise, paymentMethod: 'cod', business }),
      });

    const ok = await send('order-key-biz-0000001', { gstin: '22abvcs4888h1zl', businessName: 'Sahu Motors' });
    expect(ok.status).toBe(201);
    const { code } = (await ok.json()) as { code: string };
    const group = (await ctx.db.select().from(orderGroups)).find((g) => g.code === code);
    expect(group).toMatchObject({ gstin: '22ABVCS4888H1ZL', businessName: 'Sahu Motors' });
    const detail = await ctx.app.request(`/v1/orders/${code}?locale=en`, { headers: verified });
    expect(((await detail.json()) as { business: unknown }).business).toEqual({
      gstin: '22ABVCS4888H1ZL',
      businessName: 'Sahu Motors',
    });

    const bad = await send('order-key-biz-0000002', {
      gstin: '22ABVCS4888H1ZM',
      businessName: 'Sahu Motors',
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as ErrorJson).error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'business.gstin' })]),
    );
    expect((await send('order-key-biz-0000003', { gstin: '22ABVCS4888H1ZL' })).status).toBe(400);

    const quote = await ctx.app.request('/v1/checkout/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pincode: '492004', lines }),
    });
    expect(((await quote.json()) as { deliveryStateCode: string }).deliveryStateCode).toBe('22');
  });
});
