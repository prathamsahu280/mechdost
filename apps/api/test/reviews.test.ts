/**
 * Reviews over HTTP (spec 02 § Reviews, spec 13): a customer who received the product writes one review per
 * purchase (pending); others' orders are 404, unbought products 422, a second review 409; strict bodies (no mass
 * assignment, no status from the client); staff with `reviews:moderate` (verified) approve or hide with a reason,
 * compare-and-set on version; the public list shows approved reviews only, cached briefly; answers match the
 * shared response schemas the website validates with.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole, updateProfile } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import {
  AdminReviewsDto,
  PublicReviewsDto,
  ReviewCreatedDto,
  ReviewModeratedDto,
  ReviewTargetsDto,
} from '@mechdost/shared/reviews-api';
import { REVIEW_WRITE_RATE } from '../src/routes/reviews';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const F: Record<string, string> = {};

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, opts: { role?: string; verified?: boolean; name?: string } = {}) {
  const identity = {
    firebaseUid: `rv-api-${n}`,
    phone: `+9198333333${n}`,
    email: `rv-api-${n}@example.com`,
    emailVerified: opts.verified ?? true,
  };
  const token = ctx.verifier.add(`token-rv-api-000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.name)
    await updateProfile(ctx.db, {
      userId: user.id,
      expectedVersion: user.version,
      patch: { name: opts.name },
    });
  if (opts.role) await grantRole(ctx.db, { userId: user.id, role: opts.role, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } } satisfies Person;
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? {},
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

let n = 0;
async function deliveredOrder(userId: string, status = 'delivered'): Promise<string> {
  n += 1;
  const code = `MD-RPR-2026-AP${String(n).padStart(4, '0')}`;
  const [g] = await ctx.db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: F.city!,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `review-api-order-${String(n).padStart(6, '0')}`,
    })
    .returning();
  const [o] = await ctx.db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId,
      cityId: F.city!,
      status,
      shopId: F.shop!,
      shippingAddress: { line1: 'Sarona', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 50000,
      totalPaise: 50000,
    })
    .returning();
  await ctx.db.insert(s.orderItems).values({
    orderId: o!.id,
    variantId: F.variant!,
    title: 'Activ 4T',
    sku: 'CAS-1000',
    hsn: '2710',
    gstRateBp: 1800,
    unitPaise: 50000,
    qty: 1,
    taxablePaise: 50000,
    totalPaise: 50000,
  });
  return code;
}

let customer: Person;
let other: Person;
let moderator: Person;
let agent: Person;
let unverifiedModerator: Person;

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  F.city = city!.id;
  await ctx.db
    .insert(s.pincodes)
    .values({ pincode: '492001', stateId: state!.id, cityId: F.city, centroid: { lng: 81.63, lat: 21.25 } });
  const [shop] = await ctx.db
    .insert(s.shops)
    .values({
      name: 'Near Auto',
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: F.city,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  F.shop = shop!.id;
  const [cat] = await ctx.db
    .insert(s.categories)
    .values({ slug: 'lubricants', name: 'Lubricants', sort: 1 })
    .returning();
  const [brand] = await ctx.db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning();
  const [p] = await ctx.db
    .insert(s.products)
    .values({
      slug: 'castrol-activ',
      name: 'Activ 4T 20W40',
      nameHi: 'एक्टिव 4T 20W40',
      brandId: brand!.id,
      categoryId: cat!.id,
      hsn: '2710',
      gstRateBp: 1800,
      status: 'live',
    })
    .returning();
  const [v] = await ctx.db
    .insert(s.productVariants)
    .values({ productId: p!.id, sku: 'CAS-1000', mrpPaise: 60000 })
    .returning();
  F.variant = v!.id;
  customer = await person('01', { name: 'Ravi Kumar' });
  other = await person('02');
  moderator = await person('03', { role: 'marketing' });
  agent = await person('04', { role: 'support_agent' });
  unverifiedModerator = await person('05', { role: 'marketing', verified: false });
});

describe('reviews API', () => {
  it('a buyer sees what they can review and writes one pending review; a second is 409', async () => {
    const code = await deliveredOrder(customer.id);
    const targets = await call(customer, 'GET', `/my-reviews/eligible?order=${code}&locale=hi`);
    expect(targets.status).toBe(200);
    expect(ReviewTargetsDto.parse(targets.body).targets).toEqual([
      { targetType: 'product', slug: 'castrol-activ', name: 'एक्टिव 4T 20W40', review: null },
    ]);

    const payload = {
      orderCode: code,
      targetType: 'product',
      targetSlug: 'castrol-activ',
      rating: 5,
      body: 'Smooth',
    };
    const created = await call(customer, 'POST', '/my-reviews', payload);
    expect(created.status).toBe(201);
    expect(ReviewCreatedDto.parse(created.body).status).toBe('pending');
    const again = await call(customer, 'POST', '/my-reviews', payload);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REVIEW_EXISTS');

    // Pending is not public.
    const pub = await call(null, 'GET', '/reviews/product/castrol-activ');
    expect(pub.status).toBe(200);
    expect(PublicReviewsDto.parse(pub.body).summary.count).toBe(0);
  });

  it('someone else’s order is 404; an undelivered order is 422; anonymous is 401', async () => {
    const code = await deliveredOrder(customer.id);
    const payload = { orderCode: code, targetType: 'product', targetSlug: 'castrol-activ', rating: 4 };
    expect((await call(other, 'POST', '/my-reviews', payload)).status).toBe(404);
    expect((await call(other, 'GET', `/my-reviews/eligible?order=${code}`)).status).toBe(404);
    const shipped = await deliveredOrder(customer.id, 'shipped');
    const notYet = await call(customer, 'POST', '/my-reviews', { ...payload, orderCode: shipped });
    expect(notYet.status).toBe(422);
    expect(notYet.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
    expect((await call(null, 'POST', '/my-reviews', payload)).status).toBe(401);
  });

  it('strict bodies: no status from the client, no HTML-length bombs, one purchase reference', async () => {
    const code = await deliveredOrder(customer.id);
    const base = { orderCode: code, targetType: 'product', targetSlug: 'castrol-activ', rating: 4 };
    expect((await call(customer, 'POST', '/my-reviews', { ...base, status: 'approved' })).status).toBe(400);
    expect((await call(customer, 'POST', '/my-reviews', { ...base, rating: 0 })).status).toBe(400);
    expect((await call(customer, 'POST', '/my-reviews', { ...base, body: 'x'.repeat(1001) })).status).toBe(
      400,
    );
    expect(
      (await call(customer, 'POST', '/my-reviews', { ...base, serviceCode: 'SR-RPR-2026-7K3Q9X' })).status,
    ).toBe(400);
    const { orderCode: _drop, ...noPurchase } = base;
    expect((await call(customer, 'POST', '/my-reviews', noPurchase)).status).toBe(400);
  });

  it('moderation needs verified staff with reviews:moderate; approve publishes; stale version is 409', async () => {
    expect((await call(customer, 'GET', '/admin/reviews?status=pending')).status).toBe(403);
    expect((await call(agent, 'GET', '/admin/reviews?status=pending')).status).toBe(403);
    const unverified = await call(unverifiedModerator, 'GET', '/admin/reviews?status=pending');
    expect(unverified.body.error.code).toBe('VERIFICATION_REQUIRED');

    const queue = await call(moderator, 'GET', '/admin/reviews?status=pending');
    expect(queue.status).toBe(200);
    const list = AdminReviewsDto.parse(queue.body).reviews;
    const first = list[0]!;
    expect(first).toMatchObject({ targetSlug: 'castrol-activ', author: 'Ravi K.', status: 'pending' });

    const hideNoReason = await call(moderator, 'POST', `/admin/reviews/${first.id}/moderate`, {
      to: 'hidden',
      version: first.version,
    });
    expect(hideNoReason.status).toBe(422);
    const ok = await call(moderator, 'POST', `/admin/reviews/${first.id}/moderate`, {
      to: 'approved',
      version: first.version,
    });
    expect(ok.status).toBe(200);
    expect(ReviewModeratedDto.parse(ok.body)).toEqual({ status: 'approved', version: first.version + 1 });
    const stale = await call(moderator, 'POST', `/admin/reviews/${first.id}/moderate`, {
      to: 'hidden',
      reasonCode: 'spam',
      version: first.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVIEW');

    const unknown = await call(
      moderator,
      'POST',
      '/admin/reviews/01a1da9d-0000-7000-8000-000000000000/moderate',
      {
        to: 'approved',
        version: 1,
      },
    );
    expect(unknown.status).toBe(404);

    const pub = await call(null, 'GET', '/reviews/product/castrol-activ');
    const parsed = PublicReviewsDto.parse(pub.body);
    expect(parsed.summary).toEqual({ avg: 5, count: 1, distribution: [1, 0, 0, 0, 0] });
    expect(parsed.reviews[0]).toMatchObject({ rating: 5, body: 'Smooth', author: 'Ravi K.' });
    expect(pub.headers.get('cache-control')).toMatch(/public, max-age=60/);
  });

  it('caps review attempts per hour with 429 and Retry-After (spec 13)', async () => {
    const spammer = await person('06');
    const body = { orderCode: 'MD-RPR-2026-ZZZZZZ', targetType: 'product', targetSlug: 'x', rating: 9 };
    for (let i = 0; i < REVIEW_WRITE_RATE.limit; i++)
      expect((await call(spammer, 'POST', '/my-reviews', body)).status).toBe(400);
    const limited = await call(spammer, 'POST', '/my-reviews', body);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('public reads: unknown target 404, bad target type 400', async () => {
    expect((await call(null, 'GET', '/reviews/product/no-such-thing')).status).toBe(404);
    expect((await call(null, 'GET', '/reviews/shop/castrol-activ')).status).toBe(400);
  });
});
