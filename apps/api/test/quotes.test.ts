/**
 * Bulk quotes over HTTP (spec 19 acceptance tests): a verified customer asks for a bulk price (idempotent, ≥10
 * units → else 400, 3 open at most), city staff with `quotes:negotiate` reply and send versioned offers, the customer
 * accepts exactly the latest unexpired offer into a normal COD order with the negotiated prices (once), or closes the
 * quote. Refusals: signed out (401), unverified (403), customers on admin routes (403), other customers and other
 * cities (404), strict bodies (400), stale/expired offers (409).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { QuoteDetailDto, QuotePageDto, QuoteRulesDto } from '@mechdost/shared/quote-api';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(
  n: string,
  opts: { role?: string; cityId?: string; verified?: boolean } = {},
): Promise<Person> {
  const identity = {
    firebaseUid: `quote-api-${n}`,
    phone: `+9198333333${n}`,
    email: `quote-api-${n}@example.com`,
    emailVerified: opts.verified ?? true,
  };
  const token = ctx.verifier.add(`token-quote-api-0000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.role)
    await grantRole(ctx.db, {
      userId: user.id,
      role: opts.role,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

let n = 0;
const key = () => ({ 'idempotency-key': `quote-api-key-${String(++n).padStart(6, '0')}` });

const call = async (
  p: Person | null,
  method: string,
  path: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(p?.headers ?? { 'content-type': 'application/json' }), ...extra },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const REQUEST = {
  lines: [
    { slug: 'castrol-activ-4t-20w40-900ml', qty: 10 },
    { slug: 'spark-plug-iridium', sku: 'PRT-SPK-IR', qty: 2 },
  ],
  address: {
    contactName: 'Ravi Sahu',
    contactPhone: '+919876543210',
    line1: 'House 12, Pandri',
    pincode: '492004',
  },
  note: 'For my garage, delivery by Friday please',
  locale: 'en',
};

let ops: Person;
let customer: Person;
let other: Person;
let unverified: Person;
let elsewhere: Person;

async function request(p: Person = customer, body: unknown = REQUEST) {
  return call(p, 'POST', '/quotes', body, key());
}

async function adminDetail(code: string) {
  const r = await call(ops, 'GET', `/admin/quotes/${code}`);
  return QuoteDetailDto.parse(r.body);
}

async function sendOffer(code: string, unitPaise: number, deliveryPaise = 0) {
  const q = await adminDetail(code);
  return call(ops, 'POST', `/admin/quotes/${code}/offer`, {
    version: q.version,
    lines: q.lineItems.map((l) => ({ lineNo: l.lineNo, unitPaise })),
    deliveryPaise,
    validDays: 3,
    terms: 'Cash on delivery',
    // Below the shop price on purpose in these tests: staff confirm it (review I2).
    confirmLowPrices: true,
  });
}

async function closeAll(p: Person) {
  const page = QuotePageDto.parse((await call(p, 'GET', '/quotes')).body);
  for (const q of page.items)
    if (['open', 'negotiating', 'offered'].includes(q.status))
      await call(p, 'POST', `/quotes/${q.code}/decline`, { reasonCode: 'no_longer_needed' });
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  const [state] = await ctx.db.select().from(s.states);
  const [bls] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'BLS', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
    .returning();
  ops = await person('01', { role: 'ops_manager' });
  customer = await person('02');
  other = await person('03');
  unverified = await person('04', { verified: false });
  elsewhere = await person('05', { role: 'city_manager', cityId: bls!.id });
});

describe('customer quote routes', () => {
  it('refuses signed-out, unverified and malformed requests', async () => {
    expect((await call(null, 'POST', '/quotes', REQUEST, key())).status).toBe(401);
    expect((await request(unverified)).status).toBe(403);
    expect((await call(customer, 'POST', '/quotes', REQUEST)).status).toBe(400); // no Idempotency-Key
    expect((await request(customer, { ...REQUEST, price: 1 })).status).toBe(400);
  });

  it('refuses a quote below the minimum of 10 units with 400 (spec 19)', async () => {
    const r = await request(customer, {
      ...REQUEST,
      lines: [{ slug: 'castrol-activ-4t-20w40-900ml', qty: 9 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUOTE_MIN_UNITS');
  });

  it('creates a quote (201), replays it for the same key (200) and lists it', async () => {
    const k = key();
    const first = await call(customer, 'POST', '/quotes', REQUEST, k);
    expect(first.status).toBe(201);
    const again = await call(customer, 'POST', '/quotes', REQUEST, k);
    expect(again.status).toBe(200);
    expect(again.body.code).toBe(first.body.code);
    const page = QuotePageDto.parse((await call(customer, 'GET', '/quotes')).body);
    expect(page.items.map((q) => q.code)).toContain(first.body.code);
    const rules = QuoteRulesDto.parse((await call(customer, 'GET', '/quotes/rules')).body);
    expect(rules).toMatchObject({ minUnits: 10, openLimit: 3, open: 1 });
    const detail = QuoteDetailDto.parse(
      (await call(customer, 'GET', `/quotes/${String(first.body.code)}`)).body,
    );
    expect(detail.lineItems).toHaveLength(2);
    expect(detail.messages[0]?.body).toBe(REQUEST.note);
    await closeAll(customer);
  });

  it("answers 404 for another customer's quote", async () => {
    const { body } = await request();
    const code = String(body.code);
    expect((await call(other, 'GET', `/quotes/${code}`)).status).toBe(404);
    expect((await call(other, 'POST', `/quotes/${code}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await call(other, 'POST', `/quotes/${code}/decline`, { reasonCode: 'other' })).status).toBe(404);
    expect((await call(other, 'POST', `/quotes/${code}/accept`, { offerVersion: 1 }, key())).status).toBe(
      404,
    );
    await closeAll(customer);
  });
});

describe('staff quote desk', () => {
  it('is for staff with quote permissions in the quote city only', async () => {
    const { body } = await request();
    const code = String(body.code);
    expect((await call(customer, 'GET', '/admin/quotes')).status).toBe(403);
    expect((await call(elsewhere, 'GET', `/admin/quotes/${code}`)).status).toBe(404);
    const waiting = QuotePageDto.parse((await call(ops, 'GET', '/admin/quotes?view=waiting')).body);
    expect(waiting.items.map((q) => q.code)).toContain(code);
    const detail = await adminDetail(code);
    expect(detail.address.contactPhone).toBe('••••3210');
    await closeAll(customer);
  });

  it('replies, offers, revises; the customer accepts only the latest offer, once', async () => {
    const { body } = await request();
    const code = String(body.code);
    const reply = await call(ops, 'POST', `/admin/quotes/${code}/messages`, { body: 'We can do this.' });
    expect(reply.status).toBe(200);
    expect(reply.body.status).toBe('negotiating');

    expect((await sendOffer(code, 42_000)).body).toMatchObject({ status: 'offered', offerVersion: 1 });
    expect((await sendOffer(code, 40_000, 3_000)).body).toMatchObject({ offerVersion: 2 });

    const stale = await call(customer, 'POST', `/quotes/${code}/accept`, { offerVersion: 1 }, key());
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('QUOTE_OFFER_STALE');

    const k = key();
    const accepted = await call(customer, 'POST', `/quotes/${code}/accept`, { offerVersion: 2 }, k);
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ totalPaise: 12 * 40_000 + 3_000, replayed: false });
    const replay = await call(customer, 'POST', `/quotes/${code}/accept`, { offerVersion: 2 }, k);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ orderCode: accepted.body.orderCode, replayed: true });
    const second = await call(customer, 'POST', `/quotes/${code}/accept`, { offerVersion: 2 }, key());
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('QUOTE_CLOSED');

    // The order lines carry the negotiated prices.
    const order = await call(customer, 'GET', `/orders/${String(accepted.body.orderCode)}`);
    expect(order.status).toBe(200);
    const detail = QuoteDetailDto.parse((await call(customer, 'GET', `/quotes/${code}`)).body);
    expect(detail).toMatchObject({ status: 'accepted', orderCode: accepted.body.orderCode });
  });

  it('refuses an expired offer with 409', async () => {
    const { body } = await request();
    const code = String(body.code);
    await sendOffer(code, 41_000);
    // Every offer so far ran out (the earlier quotes are closed already).
    await ctx.db
      .update(s.quoteOffers)
      .set({ createdAt: new Date(Date.now() - 4 * 86_400_000), validUntil: new Date(Date.now() - 60_000) });
    const r = await call(customer, 'POST', `/quotes/${code}/accept`, { offerVersion: 1 }, key());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QUOTE_OFFER_EXPIRED');
    await closeAll(customer);
  });

  it('withdraws with a reason and a message; the customer can no longer write', async () => {
    const { body } = await request();
    const code = String(body.code);
    const q = await adminDetail(code);
    expect(
      (
        await call(ops, 'POST', `/admin/quotes/${code}/withdraw`, {
          version: q.version,
          reasonCode: 'nope',
          message: 'x',
        })
      ).status,
    ).toBe(400);
    const r = await call(ops, 'POST', `/admin/quotes/${code}/withdraw`, {
      version: q.version,
      reasonCode: 'cannot_supply',
      message: 'We cannot source these this month, sorry.',
    });
    expect(r.status).toBe(200);
    const msg = await call(customer, 'POST', `/quotes/${code}/messages`, { body: 'Why?' });
    expect(msg.status).toBe(409);
    expect(msg.body.error.code).toBe('QUOTE_CLOSED');
  });

  it('limits a customer to three open quotes (422)', async () => {
    await closeAll(customer);
    for (let i = 0; i < 3; i++) expect((await request()).status).toBe(201);
    const fourth = await request();
    expect(fourth.status).toBe(422);
    expect(fourth.body.error.code).toBe('QUOTE_OPEN_LIMIT');
    await closeAll(customer);
  });
});

describe('review fixes 2026-11-14', () => {
  it('refuses malformed offer prices (400) and asks to confirm prices below the shop price (422)', async () => {
    const { body } = await request();
    const code = String(body.code);
    const q = await adminDetail(code);
    // Earlier tests reserved Sharma's oil: the cheapest shop with 10 free is Gupta (₹453).
    expect(q.lineItems[0]).toMatchObject({ costPaise: 45_300, stock: 12 });
    const offerWith = (unitPaise: unknown, extra: Record<string, unknown> = {}) =>
      call(ops, 'POST', `/admin/quotes/${code}/offer`, {
        version: q.version,
        lines: q.lineItems.map((l) => ({ lineNo: l.lineNo, unitPaise })),
        deliveryPaise: 0,
        validDays: 3,
        ...extra,
      });
    for (const bad of [0, -1, 400.5, '40000', null]) expect((await offerWith(bad)).status).toBe(400);
    const low = await offerWith(40_000);
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('QUOTE_OFFER_CONFIRM_LOW');
    expect((await offerWith(40_000, { confirmLowPrices: true })).status).toBe(200);
    await closeAll(customer);
  });

  it('reads the minimum for a PIN code and hides shop prices from customers', async () => {
    const rules = QuoteRulesDto.parse((await call(customer, 'GET', '/quotes/rules?pincode=492004')).body);
    expect(rules.minUnits).toBe(10);
    expect((await call(customer, 'GET', '/quotes/rules?pincode=12')).status).toBe(400);
    const { body } = await request();
    const mine = QuoteDetailDto.parse((await call(customer, 'GET', `/quotes/${String(body.code)}`)).body);
    expect(mine.lineItems.every((l) => l.costPaise === null && l.stock === null)).toBe(true);
    await closeAll(customer);
  });
});
