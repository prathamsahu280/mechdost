/**
 * Security review 2026-11-15: the place path cannot be used to guess coupon codes. A refused coupon on `POST /orders`
 * is charged to the same per-user and per-IP limits as `POST /checkout/coupon` (own app, so the shared in-process IP
 * bucket of the other coupon tests is untouched), and codes the caller may not know about answer like unknown ones.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
const address = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  pincode: '492004',
};
let n = 0;

async function person(tag: string, role: string | null) {
  const token = ctx.verifier.add(`token-enum-${tag}-000000`, {
    firebaseUid: `enum-${tag}`,
    phone: `+9198444444${tag}`,
    email: `enum-${tag}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `enum-${tag}`,
    phone: `+9198444444${tag}`,
    email: `enum-${tag}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: null, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const call = (headers: Record<string, string>, method: string, path: string, body?: unknown, extra = {}) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

describe('coupon code enumeration through placing an order', () => {
  it('refused codes on POST /orders count against the check limits, and hidden reasons collapse', async () => {
    const marketing = await person('01', 'marketing');
    const guesser = await person('02', null);
    const made = (await (
      await call(marketing, 'POST', '/admin/coupons', {
        code: 'ENUMPAUSE',
        title: 'Enum',
        titleHi: 'एनम',
        terms: null,
        termsHi: null,
        kind: 'flat',
        value: 1_000,
        minSubtotalPaise: 0,
        maxDiscountPaise: null,
        startsAtIst: '2020-01-01T00:00',
        endsAtIst: null,
        usageLimitTotal: null,
        usageLimitPerUser: 1,
        firstOrderOnly: false,
        city: null,
        funder: 'mechdost',
        shopId: null,
      })
    ).json()) as { id: string; version: number };
    await call(marketing, 'POST', `/admin/coupons/${made.id}/pause`, {
      paused: true,
      reason: 'Hold on',
      version: made.version,
    });
    const quote = (await (
      await call({ 'content-type': 'application/json' }, 'POST', '/checkout/quote', {
        pincode: '492004',
        lines,
      })
    ).json()) as {
      totalPaise: number;
    };
    const place = (couponCode: string) =>
      call(
        guesser,
        'POST',
        '/orders',
        { address, lines, expectedTotalPaise: quote.totalPaise, paymentMethod: 'cod', couponCode },
        { 'idempotency-key': `enum-key-${String((n += 1)).padStart(8, '0')}` },
      );
    const reasonOf = async (r: Response) =>
      ((await r.json()) as { error: { details?: { reason?: string } } }).error.details?.reason;
    expect(await reasonOf(await place('NOSUCHCODE'))).toBe('not_found');
    expect(await reasonOf(await place('ENUMPAUSE'))).toBe('not_found');
    for (let i = 0; i < 6; i += 1) expect((await place(`GUESSX${String(i)}AB`)).status).toBe(422);
    // 8 refused codes so far; 22 checks bring the hour's total to the limit of 30 ...
    for (let i = 0; i < 22; i += 1) {
      const r = await call(guesser, 'POST', '/checkout/coupon', {
        code: `CHECKX${String(i)}AB`,
        pincode: '492004',
        lines,
        locale: 'en',
      });
      expect(r.status).toBe(200);
    }
    // ... so the next one is refused: the place attempts were charged to the same limiter.
    const over = await call(guesser, 'POST', '/checkout/coupon', {
      code: 'ONEMORECODE',
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(over.status).toBe(429);
  });

  it('over the limit, a request carrying a code is refused before the code is looked at', async () => {
    const marketing = await person('01', 'marketing');
    const user = await person('03', null);
    await call(marketing, 'POST', '/admin/coupons', {
      code: 'ENUMLIVE',
      title: 'Live',
      titleHi: 'लाइव',
      terms: null,
      termsHi: null,
      kind: 'flat',
      value: 1_000,
      minSubtotalPaise: 0,
      maxDiscountPaise: null,
      startsAtIst: '2020-01-01T00:00',
      endsAtIst: null,
      usageLimitTotal: null,
      usageLimitPerUser: 1,
      firstOrderOnly: false,
      city: null,
      funder: 'mechdost',
      shopId: null,
    });
    for (let i = 0; i < 30; i += 1)
      await call(user, 'POST', '/checkout/coupon', {
        code: `USEUPX${String(i)}AB`,
        pincode: '492004',
        lines,
        locale: 'en',
      });
    const quote = (await (
      await call({ 'content-type': 'application/json' }, 'POST', '/checkout/quote', {
        pincode: '492004',
        lines,
      })
    ).json()) as { totalPaise: number };
    // A valid code with the right total would be placed (201) if it were evaluated; it must be 429 instead.
    const r = await call(
      user,
      'POST',
      '/orders',
      {
        address,
        lines,
        expectedTotalPaise: quote.totalPaise - 1_000,
        paymentMethod: 'cod',
        couponCode: 'ENUMLIVE',
      },
      { 'idempotency-key': 'enum-key-over-limit-0001' },
    );
    expect(r.status).toBe(429);
  });
});
