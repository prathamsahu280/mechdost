/**
 * Coupon follow-ups over HTTP (2026-11-16): the public offers list (anonymous, rate limited, no usage numbers, an
 * automatic offer never shows its code), the admin usage report (role-leak matrix, city scope, 404), and automatic
 * offers at the checkout (no code needed, re-priced on the server, the typed code of an automatic offer is "not valid",
 * never stacked).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import type { CouponInput } from '@mechdost/shared/coupon-api';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Who {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, role: string | null, opts: { cityId?: string } = {}): Promise<Who> {
  const phone = `+9198444444${n}`;
  const token = ctx.verifier.add(`token-offers-api-00${n}`, {
    firebaseUid: `of-${n}`,
    phone,
    email: `of-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `of-${n}`,
    phone,
    email: `of-${n}@example.com`,
    emailVerified: true,
  });
  if (role)
    await grantRole(ctx.db, {
      userId: user.id,
      role,
      shopId: null,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = (
  who: Who | null,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(who?.headers ?? { 'content-type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

let n = 0;
const input = (over: Partial<CouponInput> = {}): CouponInput => ({
  code: `OFA${String((n += 1)).padStart(5, '0')}`,
  title: 'API offer',
  titleHi: 'एपीआई ऑफ़र',
  terms: null,
  termsHi: null,
  kind: 'flat',
  value: 2_000,
  minSubtotalPaise: 0,
  maxDiscountPaise: null,
  startsAtIst: '2020-01-01T00:00',
  endsAtIst: null,
  usageLimitTotal: null,
  usageLimitPerUser: 3,
  firstOrderOnly: false,
  city: null,
  funder: 'mechdost',
  shopId: null,
  isPublic: false,
  autoApply: false,
  categorySlug: null,
  ...over,
});
const lines = [{ sku: OIL, qty: 1 }];
const address = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  pincode: '492004',
};
const idem = () => `offers-api-key-${String((n += 1)).padStart(6, '0')}`;

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

describe('public offers list', () => {
  it('is open without sign-in, lists only public live offers, and never leaks usage or an automatic code', async () => {
    const marketing = await person('01', 'marketing');
    const pub = (await (
      await call(marketing, 'POST', '/admin/coupons', input({ isPublic: true }))
    ).json()) as {
      id: string;
      code: string;
    };
    const hidden = (await (await call(marketing, 'POST', '/admin/coupons', input())).json()) as {
      id: string;
    };
    const auto = (await (
      await call(marketing, 'POST', '/admin/coupons', input({ isPublic: true, autoApply: true }))
    ).json()) as { id: string; code: string };

    const res = await call(null, 'GET', '/offers?city=RPR&locale=hi');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as { offers: { id: string; code: string | null; title: string }[] };
    const ids = body.offers.map((o) => o.id);
    expect(ids).toContain(pub.id);
    expect(ids).toContain(auto.id);
    expect(ids).not.toContain(hidden.id);
    expect(body.offers.find((o) => o.id === pub.id)).toMatchObject({ code: pub.code, title: 'एपीआई ऑफ़र' });
    expect(body.offers.find((o) => o.id === auto.id)?.code).toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain('usedCount');
    expect(text).not.toContain(auto.code);
  });

  it('refuses a bad or unknown city, and is rate limited per IP', async () => {
    expect((await call(null, 'GET', '/offers?city=rpr')).status).toBe(400);
    expect((await call(null, 'GET', '/offers?city=ZZZ')).status).toBe(404);
    let last = 200;
    for (let i = 0; i < 125; i += 1) last = (await call(null, 'GET', '/offers?city=RPR')).status;
    expect(last).toBe(429);
  });
});

describe('admin usage report: who may', () => {
  it('marketing reads it; customer 403; anonymous 401; support 403; another city 404; unknown id 404', async () => {
    const marketing = await person('02', 'marketing');
    const customer = await person('03', null);
    const support = await person('04', 'support_agent');
    const c = (await (await call(marketing, 'POST', '/admin/coupons', input({ city: 'RPR' }))).json()) as {
      id: string;
    };
    expect((await call(null, 'GET', `/admin/coupons/${c.id}/usage`)).status).toBe(401);
    expect((await call(customer, 'GET', `/admin/coupons/${c.id}/usage`)).status).toBe(403);
    expect((await call(support, 'GET', `/admin/coupons/${c.id}/usage`)).status).toBe(403);
    const ok = await call(marketing, 'GET', `/admin/coupons/${c.id}/usage`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      couponId: c.id,
      totals: { orders: 0, released: 0, uses: 0, discountPaise: 0, uniqueCustomers: 0 },
      days: [],
      nextCursor: null,
    });
    // (A coupon outside a staff member's cities is a 404 in the repository test: marketing holds global scope.)
    expect(
      (await call(marketing, 'GET', '/admin/coupons/00000000-0000-7000-8000-000000000009/usage')).status,
    ).toBe(404);
    expect((await call(marketing, 'GET', `/admin/coupons/${c.id}/usage?cursor=junk`)).status).toBe(422);
  });
});

describe('automatic offers at the checkout', () => {
  it('asks with no code, prices on the server, hides the code, refuses a stale total and a shop-funded automatic offer', async () => {
    const marketing = await person('02', 'marketing');
    const ravi = await person('21', null);
    const a = (await (
      await call(marketing, 'POST', '/admin/coupons', input({ autoApply: true, value: 4_000 }))
    ).json()) as { code: string };
    const check = (who: Who | null, codeText: string | null) =>
      call(who, 'POST', '/checkout/coupon', {
        ...(codeText ? { code: codeText } : {}),
        pincode: '492004',
        lines,
        locale: 'en',
      });
    expect((await check(null, null)).status).toBe(401);
    expect(await (await check(ravi, null)).json()).toMatchObject({
      ok: true,
      source: 'automatic',
      discountPaise: 4_000,
      beaten: null,
    });
    // Typing an automatic offer's internal code is "not valid" (nobody can guess what is automatic).
    expect(await (await check(ravi, a.code)).json()).toMatchObject({ ok: false, reason: 'not_found' });

    const quote = (await (
      await call(null, 'POST', '/checkout/quote', { pincode: '492004', lines })
    ).json()) as {
      totalPaise: number;
    };
    const place = (expected: number) =>
      call(
        ravi,
        'POST',
        '/orders',
        { address, lines, expectedTotalPaise: expected, paymentMethod: 'cod' },
        { 'idempotency-key': idem() },
      );
    const stale = await place(quote.totalPaise);
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe('PRICE_CHANGED');
    const placed = await place(quote.totalPaise - 4_000);
    expect(placed.status).toBe(201);
    expect(await placed.json()).toMatchObject({ couponDiscountPaise: 4_000 });

    const bad = await call(
      marketing,
      'POST',
      '/admin/coupons',
      input({ autoApply: true, funder: 'shop', shopId: '00000000-0000-7000-8000-000000000003' }),
    );
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const noCat = await call(
      marketing,
      'POST',
      '/admin/coupons',
      input({ categorySlug: 'no-such-category' }),
    );
    expect(noCat.status).toBe(422);
    expect(await code(noCat)).toBe('COUPON_CATEGORY');
  });
});
