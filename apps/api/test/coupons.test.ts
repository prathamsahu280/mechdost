/**
 * Coupons over HTTP (spec 03 / 07 / 08, design 2026-11-15). Role-leak matrix: only staff with `coupons:write` manage
 * coupons (customer 403, anonymous 401, a city-scoped marketer cannot make an all-cities one); only a shop's owner reads
 * and decides its offers (staff of the shop 403, another shop's owner 404); a customer checks a code on their cart (rate
 * limited) and places with it (the server re-prices; a stale or refused coupon is a 409 / 422 with the reason).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import type { CouponInput } from '@mechdost/shared/coupon-api';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};
interface Who {
  id: string;
  headers: Record<string, string>;
}

async function person(
  n: string,
  role: string | null,
  opts: { shopId?: string; cityId?: string } = {},
): Promise<Who> {
  const phone = `+9198333333${n}`;
  const token = ctx.verifier.add(`token-coupons-api-00${n}`, {
    firebaseUid: `cp-${n}`,
    phone,
    email: `cp-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `cp-${n}`,
    phone,
    email: `cp-${n}@example.com`,
    emailVerified: true,
  });
  if (role)
    await grantRole(ctx.db, {
      userId: user.id,
      role,
      shopId: opts.shopId ?? null,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  if (role?.startsWith('seller_') && opts.shopId)
    await ctx.db
      .insert(s.shopUsers)
      .values({ shopId: opts.shopId, userId: user.id, role: role === 'seller_owner' ? 'owner' : 'staff' });
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
  code: `API${String((n += 1)).padStart(5, '0')}`,
  title: 'API offer',
  titleHi: 'एपीआई ऑफ़र',
  terms: 'Valid on products only.',
  termsHi: 'केवल उत्पादों पर मान्य।',
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
const idem = () => `coupon-api-key-${String((n += 1)).padStart(6, '0')}`;
const lines = [{ sku: OIL, qty: 1 }];
const address = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  pincode: '492004',
};

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
});

describe('admin coupons: who may', () => {
  it('marketing may create, edit with a version, pause; customer 403; anonymous 401; support 403', async () => {
    const marketing = await person('01', 'marketing');
    const customer = await person('02', null);
    const support = await person('03', 'support_agent');
    const body = input();
    expect((await call(null, 'POST', '/admin/coupons', body)).status).toBe(401);
    expect((await call(customer, 'POST', '/admin/coupons', body)).status).toBe(403);
    expect((await call(support, 'POST', '/admin/coupons', body)).status).toBe(403);
    expect((await call(customer, 'GET', '/admin/coupons')).status).toBe(403);

    const created = await call(marketing, 'POST', '/admin/coupons', body);
    expect(created.status).toBe(201);
    const c = (await created.json()) as { id: string; version: number; code: string; live: boolean };
    expect(c).toMatchObject({ code: body.code, live: true });

    const listed = (await (await call(marketing, 'GET', '/admin/coupons')).json()) as {
      coupons: { id: string }[];
    };
    expect(listed.coupons.map((x) => x.id)).toContain(c.id);

    const edited = await call(marketing, 'PUT', `/admin/coupons/${c.id}`, {
      version: c.version,
      coupon: { ...body, value: 2_500 },
    });
    expect(edited.status).toBe(200);
    const stale = await call(marketing, 'PUT', `/admin/coupons/${c.id}`, {
      version: c.version,
      coupon: { ...body, value: 3_000 },
    });
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe('STALE_COUPON');

    const next = (await edited.json()) as { version: number };
    const noReason = await call(marketing, 'POST', `/admin/coupons/${c.id}/pause`, {
      paused: true,
      reason: null,
      version: next.version,
    });
    expect(noReason.status).toBeGreaterThanOrEqual(400);
    const paused = await call(marketing, 'POST', `/admin/coupons/${c.id}/pause`, {
      paused: true,
      reason: 'Stopped for review',
      version: next.version,
    });
    expect(await paused.json()).toMatchObject({
      active: false,
      live: false,
      pausedReason: 'Stopped for review',
    });
    const dup = await call(marketing, 'POST', '/admin/coupons', body);
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe('COUPON_CODE_TAKEN');
  });

  it('refuses a bad form: Hindi missing, percent too big, free delivery with an amount, end before start, extra fields', async () => {
    const marketing = await person('01', 'marketing');
    const bad = async (over: Record<string, unknown>) =>
      (await call(marketing, 'POST', '/admin/coupons', { ...input(), ...over })).status;
    expect(await bad({ titleHi: '' })).toBeGreaterThanOrEqual(400);
    expect(await bad({ kind: 'percent', value: 95 })).toBeGreaterThanOrEqual(400);
    expect(await bad({ kind: 'free_shipping', value: 100 })).toBeGreaterThanOrEqual(400);
    expect(await bad({ endsAtIst: '2019-01-01T00:00' })).toBeGreaterThanOrEqual(400);
    expect(await bad({ funder: 'shop', shopId: null })).toBeGreaterThanOrEqual(400);
    expect(await bad({ terms: 'English only', termsHi: null })).toBeGreaterThanOrEqual(400);
    expect(await bad({ isAdmin: true })).toBeGreaterThanOrEqual(400);
  });

  it('a city manager has no coupon rights (only marketing and super admin hold coupons:write)', async () => {
    const [rpr] = await ctx.db.select().from(s.cities).limit(1);
    const local = await person('04', 'city_manager', { cityId: rpr?.id ?? '' });
    expect((await call(local, 'POST', '/admin/coupons', input({ city: rpr?.code ?? 'RPR' }))).status).toBe(
      403,
    );
    expect((await call(local, 'GET', '/admin/coupons')).status).toBe(403);
  });
});

describe('shop offers: who may', () => {
  it('owner reads and decides; same-shop staff 403; another shop’s owner 404; customer 403; anonymous 401', async () => {
    const marketing = await person('01', 'marketing');
    const sharma = shop['Sharma Auto Parts'] ?? '';
    const owner = await person('11', 'seller_owner', { shopId: sharma });
    const staff = await person('12', 'seller_staff', { shopId: sharma });
    const other = await person('13', 'seller_owner', { shopId: shop['Gupta Lubes & Spares'] ?? '' });
    const customer = await person('14', null);
    const made = await call(marketing, 'POST', '/admin/coupons', input({ funder: 'shop', shopId: sharma }));
    expect(made.status).toBe(201);
    const c = (await made.json()) as { id: string; shopTerms: string };
    expect(c.shopTerms).toBe('pending');

    expect((await call(null, 'GET', `/shop/offers/${sharma}`)).status).toBe(401);
    expect((await call(customer, 'GET', `/shop/offers/${sharma}`)).status).toBe(403);
    expect((await call(staff, 'GET', `/shop/offers/${sharma}`)).status).toBe(403);
    expect(await code(await call(staff, 'GET', `/shop/offers/${sharma}`))).toBe('OWNER_ONLY');
    expect((await call(other, 'GET', `/shop/offers/${sharma}`)).status).toBe(404);
    expect((await call(marketing, 'GET', `/shop/offers/${sharma}`)).status).toBe(403);

    const offers = (await (await call(owner, 'GET', `/shop/offers/${sharma}`)).json()) as {
      offers: { couponId: string; version: number; status: string }[];
    };
    const offer = offers.offers.find((o) => o.couponId === c.id);
    expect(offer).toMatchObject({ status: 'pending' });
    const decision = { decision: 'accept', version: offer?.version ?? 0 };
    expect((await call(other, 'POST', `/shop/offers/${sharma}/${c.id}/decision`, decision)).status).toBe(404);
    expect((await call(staff, 'POST', `/shop/offers/${sharma}/${c.id}/decision`, decision)).status).toBe(403);
    const ok = await call(owner, 'POST', `/shop/offers/${sharma}/${c.id}/decision`, decision);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'accepted' });
    // The same (now stale) version again is refused.
    const again = await call(owner, 'POST', `/shop/offers/${sharma}/${c.id}/decision`, decision);
    expect(again.status).toBe(409);
    expect(await code(again)).toBe('STALE_OFFER');
    // Another shop's offers list never shows it.
    const theirs = (await (
      await call(other, 'GET', `/shop/offers/${shop['Gupta Lubes & Spares']}`)
    ).json()) as {
      offers: { couponId: string }[];
    };
    expect(theirs.offers.map((o) => o.couponId)).not.toContain(c.id);
  });
});

describe('customer: check a code, then place with it', () => {
  it('needs sign-in; shows conditions and the saving; a refusal carries a reason; placing re-prices', async () => {
    const marketing = await person('01', 'marketing');
    const ravi = await person('21', null);
    const c = (await (
      await call(
        marketing,
        'POST',
        '/admin/coupons',
        input({ kind: 'flat', value: 3_000, minSubtotalPaise: 10_000 }),
      )
    ).json()) as { code: string };
    const check = (who: Who | null, codeText: string) =>
      call(who, 'POST', '/checkout/coupon', { code: codeText, pincode: '492004', lines, locale: 'en' });
    expect((await check(null, c.code)).status).toBe(401);
    const ok = await (await check(ravi, c.code.toLowerCase())).json();
    expect(ok).toMatchObject({
      ok: true,
      discountPaise: 3_000,
      coupon: { code: c.code, kind: 'flat', value: 3_000, minSubtotalPaise: 10_000, funder: 'mechdost' },
    });
    expect(await (await check(ravi, 'NOSUCHCODE')).json()).toMatchObject({ ok: false, reason: 'not_found' });

    const quote = (await (
      await call(null, 'POST', '/checkout/quote', { pincode: '492004', lines })
    ).json()) as {
      totalPaise: number;
    };
    const place = (expected: number, couponCode: string | null) =>
      call(
        ravi,
        'POST',
        '/orders',
        { address, lines, expectedTotalPaise: expected, paymentMethod: 'cod', couponCode },
        { 'idempotency-key': idem() },
      );
    // The old total (without the coupon) is a stale price: re-quote and confirm again.
    const stale = await place(quote.totalPaise, c.code);
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe('PRICE_CHANGED');
    const placed = await place(quote.totalPaise - 3_000, c.code);
    expect(placed.status).toBe(201);
    expect(await placed.json()).toMatchObject({
      couponDiscountPaise: 3_000,
      totalPaise: quote.totalPaise - 3_000,
    });
    const refused = await place(quote.totalPaise, 'NOSUCHCODE');
    expect(refused.status).toBe(422);
    const err = (await refused.json()) as ErrorJson;
    expect(err.error).toMatchObject({ code: 'COUPON_INVALID', details: { reason: 'not_found' } });
  });

  it('is rate limited per user so codes cannot be guessed', async () => {
    const guesser = await person('22', null);
    let last = 200;
    for (let i = 0; i < 32; i += 1)
      last = (
        await call(guesser, 'POST', '/checkout/coupon', {
          code: `GUESS${String(i)}ABC`,
          pincode: '492004',
          lines,
          locale: 'en',
        })
      ).status;
    expect(last).toBe(429);
  });
});
