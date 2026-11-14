/**
 * Customer reviews (spec 02 § Reviews): verified purchases only (delivered sub-order / paid service), one per
 * customer, target and purchase, a daily limit, pending until staff approve, public reads show approved only,
 * moderation is compare-and-set and city-scoped, and a workshop's rating follows its approved reviews.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { REVIEW_DAILY_LIMIT } from '@mechdost/shared/reviews';
import { rowsOf } from '../src/repo/sql-rows';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  listPublicReviews,
  listReviewQueue,
  moderateReview,
  myReviewTargets,
  submitReview,
  type CityScope,
  type Tx,
} from '../src/repo';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
const P: Record<string, string> = {};
let workshop: { id: string; slug: string };
let n = 0;

/** An order of `userId` with one sub-order in `status` containing `variantId`. */
async function order(userId: string, variantId: string, status: string): Promise<string> {
  n += 1;
  const code = `MD-RPR-2026-RV${String(n).padStart(4, '0')}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: f.raipur,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `review-order-${String(n).padStart(8, '0')}`,
    })
    .returning();
  const [o] = await db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId,
      cityId: f.raipur,
      status,
      shopId: P.shop,
      shippingAddress: { line1: 'Sarona', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 50000,
      totalPaise: 50000,
    })
    .returning();
  await db.insert(s.orderItems).values({
    orderId: o!.id,
    variantId,
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

async function service(userId: string, status: string, workshopId: string): Promise<string> {
  n += 1;
  const code = `SR-RPR-2026-RV${String(n).padStart(4, '0')}`;
  await db.insert(s.serviceRequests).values({
    code,
    userId,
    cityId: f.raipur,
    workshopId,
    routingMode: 'chosen',
    vehicleType: '2W',
    vehicleText: 'Honda Activa 6G',
    vehicleKey: 'honda activa 6g',
    services: [],
    pincode: '492001',
    preferredDate: '2026-11-20',
    preferredSlot: 'morning',
    status,
    odometerKm: 12_400,
    receivedAt: new Date(),
    idempotencyKey: `review-service-${String(n).padStart(8, '0')}`,
  });
  return code;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  const [state] = await db.select().from(s.states).limit(1);
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Near Auto',
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: f.raipur,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  P.shop = shop!.id;
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'lubricants', name: 'Lubricants', sort: 1 })
    .returning();
  const [brand] = await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning();
  const product = async (slug: string, status: string) => {
    const [p] = await db
      .insert(s.products)
      .values({
        slug,
        name: `Product ${slug}`,
        nameHi: `उत्पाद ${slug}`,
        brandId: brand!.id,
        categoryId: cat!.id,
        hsn: '2710',
        gstRateBp: 1800,
        status,
      })
      .returning();
    const [v] = await db
      .insert(s.productVariants)
      .values({ productId: p!.id, sku: `SKU-${slug}`, mrpPaise: 60000 })
      .returning();
    return { product: p!.id, variant: v!.id };
  };
  const a = await product('castrol-activ', 'live');
  const b = await product('castrol-power', 'live');
  P.product = a.product;
  P.variant = a.variant;
  P.other = b.variant;
  workshop = await addWorkshop(db, f);
});

afterAll(async () => {
  await client.close();
});

describe('writing reviews', () => {
  it('lists what a delivered order lets the customer review, in their language', async () => {
    const code = await order(f.customer, P.variant!, 'delivered');
    const targets = await myReviewTargets(t(), {
      userId: f.customer,
      purchase: { orderCode: code },
      locale: 'hi',
    });
    expect(targets).toEqual([
      { targetType: 'product', slug: 'castrol-activ', name: 'उत्पाद castrol-activ', review: null },
    ]);
  });

  it('refuses a customer who did not buy it: foreign order 404, undelivered or other product 422', async () => {
    const code = await order(f.customer, P.variant!, 'delivered');
    await expect(
      submitReview(t(), {
        userId: f.other,
        purchase: { orderCode: code },
        targetType: 'product',
        targetSlug: 'castrol-activ',
        rating: 5,
        body: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const shipped = await order(f.customer, P.variant!, 'shipped');
    await expect(
      submitReview(t(), {
        userId: f.customer,
        purchase: { orderCode: shipped },
        targetType: 'product',
        targetSlug: 'castrol-activ',
        rating: 5,
        body: null,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_ELIGIBLE' });
    await expect(
      submitReview(t(), {
        userId: f.customer,
        purchase: { orderCode: code },
        targetType: 'product',
        targetSlug: 'castrol-power',
        rating: 5,
        body: null,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_ELIGIBLE' });
  });

  it('accepts one review per purchase (pending, cleaned text, audited, event); a second is 409', async () => {
    const code = await order(f.customer, P.variant!, 'delivered');
    const input = {
      userId: f.customer,
      purchase: { orderCode: code },
      targetType: 'product' as const,
      targetSlug: 'castrol-activ',
      rating: 4,
      body: '  Good oil,\u0000 smooth engine  ',
    };
    const created = await submitReview(t(), input);
    expect(created.status).toBe('pending');
    const [row] = await db.select().from(s.reviews).where(eq(s.reviews.id, created.id));
    expect(row).toMatchObject({ body: 'Good oil, smooth engine', cityId: f.raipur, status: 'pending' });
    await expect(submitReview(t(), input)).rejects.toMatchObject({ code: 'REVIEW_EXISTS', status: 409 });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, created.id));
    expect(audit.map((a) => a.action)).toEqual(['review.submitted']);
    const ev = await db.execute(
      sql`select props from events where event = 'review_submitted' and props->>'reviewId' = ${created.id}`,
    );
    expect(JSON.stringify(ev)).not.toContain('smooth engine');
    // The target list now carries the customer's own (pending) review.
    const targets = await myReviewTargets(t(), {
      userId: f.customer,
      purchase: { orderCode: code },
      locale: 'en',
    });
    expect(targets[0]?.review).toMatchObject({ rating: 4, status: 'pending' });
  });

  it('one review per product per purchase even when it came in two parts delivered at different times (review finding)', async () => {
    const code = await order(f.customer, P.variant!, 'packed');
    const [g] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, code));
    const [second] = await db
      .insert(s.orders)
      .values({
        groupId: g!.id,
        subNo: 2,
        code: `${code}-2`,
        userId: f.customer,
        cityId: f.raipur,
        status: 'delivered',
        shopId: P.shop,
        shippingAddress: { line1: 'Sarona', pincode: '492001' },
        pincode: '492001',
        subtotalPaise: 50000,
        totalPaise: 50000,
      })
      .returning();
    await db.insert(s.orderItems).values({
      orderId: second!.id,
      variantId: P.variant!,
      title: 'Activ 4T',
      sku: 'CAS-1000',
      hsn: '2710',
      gstRateBp: 1800,
      unitPaise: 50000,
      qty: 1,
      taxablePaise: 50000,
      totalPaise: 50000,
    });
    const input = {
      userId: f.customer,
      purchase: { orderCode: code },
      targetType: 'product' as const,
      targetSlug: 'castrol-activ',
      rating: 5,
      body: null,
    };
    await submitReview(t(), input);
    // The first part arrives later: the product must not become reviewable a second time.
    await db
      .update(s.orders)
      .set({ status: 'delivered' })
      .where(eq(s.orders.code, `${code}-1`));
    await expect(submitReview(t(), input)).rejects.toMatchObject({ code: 'REVIEW_EXISTS', status: 409 });
    const targets = await myReviewTargets(t(), {
      userId: f.customer,
      purchase: { orderCode: code },
      locale: 'en',
    });
    expect(targets.filter((x) => x.slug === 'castrol-activ')).toHaveLength(1);
    expect(targets.find((x) => x.slug === 'castrol-activ')?.review).toMatchObject({ rating: 5 });
  });

  it('refuses a bad rating', async () => {
    const code = await order(f.customer, P.variant!, 'delivered');
    await expect(
      submitReview(t(), {
        userId: f.customer,
        purchase: { orderCode: code },
        targetType: 'product',
        targetSlug: 'castrol-activ',
        rating: 6,
        body: null,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_RATING' });
  });

  it('a workshop is reviewable only after the service is paid; foreign request 404', async () => {
    const open = await service(f.customer, 'in_progress', workshop.id);
    expect(
      await myReviewTargets(t(), { userId: f.customer, purchase: { serviceCode: open }, locale: 'en' }),
    ).toEqual([]);
    const paid = await service(f.customer, 'paid', workshop.id);
    await expect(
      myReviewTargets(t(), { userId: f.other, purchase: { serviceCode: paid }, locale: 'en' }),
    ).rejects.toMatchObject({ status: 404 });
    const r = await submitReview(t(), {
      userId: f.customer,
      purchase: { serviceCode: paid },
      targetType: 'workshop',
      targetSlug: workshop.slug,
      rating: 5,
      body: 'Quick and honest',
    });
    expect(r.status).toBe('pending');
  });

  it(`stops at ${String(REVIEW_DAILY_LIMIT)} reviews a day`, async () => {
    const [u] = await db
      .insert(s.users)
      .values({ firebaseUid: 'rv-busy', phone: '+919811100099', name: 'Busy Buyer' })
      .returning();
    for (let i = 0; i < REVIEW_DAILY_LIMIT; i++) {
      const code = await order(u!.id, P.variant!, 'delivered');
      await submitReview(t(), {
        userId: u!.id,
        purchase: { orderCode: code },
        targetType: 'product',
        targetSlug: 'castrol-activ',
        rating: 3,
        body: null,
      });
    }
    const code = await order(u!.id, P.variant!, 'delivered');
    await expect(
      submitReview(t(), {
        userId: u!.id,
        purchase: { orderCode: code },
        targetType: 'product',
        targetSlug: 'castrol-activ',
        rating: 3,
        body: null,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_DAILY_LIMIT' });
  });
});

describe('moderation and public reads', () => {
  it('pending reviews are not public; approving publishes and updates the workshop rating', async () => {
    const before = await listPublicReviews(t(), { targetType: 'workshop', slug: workshop.slug });
    expect(before.reviews).toHaveLength(0);
    expect(before.summary).toEqual({ avg: null, count: 0, distribution: [0, 0, 0, 0, 0] });

    const queue = await listReviewQueue(t(), ALL, { status: 'pending' });
    const pending = queue.reviews.find((r) => r.targetType === 'workshop');
    expect(pending).toMatchObject({ targetSlug: workshop.slug, author: 'Ravi', body: 'Quick and honest' });

    const done = await moderateReview(t(), ALL, {
      staffUserId: f.staff,
      id: pending!.id,
      to: 'approved',
      reasonCode: null,
      note: null,
      expectedVersion: pending!.version,
    });
    expect(done.status).toBe('approved');
    const after = await listPublicReviews(t(), { targetType: 'workshop', slug: workshop.slug });
    expect(after.summary).toEqual({ avg: 5, count: 1, distribution: [1, 0, 0, 0, 0] });
    expect(after.reviews[0]).toMatchObject({ rating: 5, body: 'Quick and honest', author: 'Ravi' });
    const [w] = await db.select().from(s.workshops).where(eq(s.workshops.id, workshop.id));
    expect(w).toMatchObject({ ratingCount: 1 });
    expect(Number(w!.ratingAvg)).toBe(5);

    // Hiding needs a reason, takes it out of the public list and the rating.
    await expect(
      moderateReview(t(), ALL, {
        staffUserId: f.staff,
        id: pending!.id,
        to: 'hidden',
        reasonCode: null,
        note: null,
        expectedVersion: done.version,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_REASON_REQUIRED' });
    await moderateReview(t(), ALL, {
      staffUserId: f.staff,
      id: pending!.id,
      to: 'hidden',
      reasonCode: 'personal_data',
      note: 'Phone number in the text',
      expectedVersion: done.version,
    });
    const hidden = await listPublicReviews(t(), { targetType: 'workshop', slug: workshop.slug });
    expect(hidden.summary.count).toBe(0);
    const [w2] = await db.select().from(s.workshops).where(eq(s.workshops.id, workshop.id));
    expect(w2).toMatchObject({ ratingCount: 0, ratingAvg: null });

    // Spec 13 "audit row per mutation" and spec 12 "server event exactly once": one of each per moderation.
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, pending!.id));
    expect(audit.map((a) => [a.action, a.reason])).toEqual([
      ['review.submitted', null],
      ['review.moderated', null],
      ['review.moderated', 'personal_data'],
    ]);
    const events = rowsOf<{ event: string; props: { to?: string } }>(
      await db.execute(
        sql`select event, props from events where props->>'reviewId' = ${pending!.id} order by occurred_at, id`,
      ),
    );
    expect(events.map((e) => [e.event, e.props.to ?? null])).toEqual([
      ['review_submitted', null],
      ['admin_review_moderated', 'approved'],
      ['admin_review_moderated', 'hidden'],
    ]);
    const [stored] = await db.select().from(s.reviews).where(eq(s.reviews.id, pending!.id));
    expect(stored).toMatchObject({
      hiddenReason: 'personal_data',
      moderationNote: 'Phone number in the text',
    });
  });

  it('a stale version is a conflict; an illegal move is refused; another city is 404', async () => {
    const code = await order(f.customer, P.other!, 'delivered');
    const r = await submitReview(t(), {
      userId: f.customer,
      purchase: { orderCode: code },
      targetType: 'product',
      targetSlug: 'castrol-power',
      rating: 2,
      body: null,
    });
    const ok = await moderateReview(t(), ALL, {
      staffUserId: f.staff,
      id: r.id,
      to: 'approved',
      reasonCode: null,
      note: null,
      expectedVersion: 1,
    });
    expect(ok.version).toBe(2);
    await expect(
      moderateReview(t(), ALL, {
        staffUserId: f.staff,
        id: r.id,
        to: 'hidden',
        reasonCode: 'spam',
        note: null,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_REVIEW', status: 409 });
    await expect(
      moderateReview(t(), ALL, {
        staffUserId: f.staff,
        id: r.id,
        to: 'pending',
        reasonCode: null,
        note: null,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    const bhilaiOnly: CityScope = { all: false, cityIds: [f.bhilai] };
    await expect(
      moderateReview(t(), bhilaiOnly, {
        staffUserId: f.staff,
        id: r.id,
        to: 'hidden',
        reasonCode: 'spam',
        note: null,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await listReviewQueue(t(), bhilaiOnly, { status: 'approved' })).reviews).toHaveLength(0);
    const pub = await listPublicReviews(t(), { targetType: 'product', slug: 'castrol-power' });
    expect(pub.summary).toMatchObject({ count: 1, avg: 2 });
  });

  it('pages the public list with a cursor; an unknown product is 404', async () => {
    const pending = await listReviewQueue(t(), ALL, { status: 'pending', limit: 50 });
    for (const r of pending.reviews.filter((x) => x.targetSlug === 'castrol-activ').slice(0, 3))
      await moderateReview(t(), ALL, {
        staffUserId: f.staff,
        id: r.id,
        to: 'approved',
        reasonCode: null,
        note: null,
        expectedVersion: r.version,
      });
    const first = await listPublicReviews(t(), { targetType: 'product', slug: 'castrol-activ', limit: 2 });
    expect(first.reviews).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listPublicReviews(t(), {
      targetType: 'product',
      slug: 'castrol-activ',
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.reviews).toHaveLength(1);
    expect(second.reviews[0]!.id).not.toBe(first.reviews[0]!.id);
    await expect(listPublicReviews(t(), { targetType: 'product', slug: 'nope' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('the database refuses a review without a matching purchase or an unreasoned hide', async () => {
    await expect(
      db.insert(s.reviews).values({
        userId: f.customer,
        cityId: f.raipur,
        targetType: 'product',
        targetId: P.product!,
        rating: 5,
        serviceRequestId: null,
        orderId: null,
      }),
    ).rejects.toThrow();
    const [row] = await db.select().from(s.reviews).limit(1);
    await expect(
      db.execute(sql`update reviews set status = 'hidden', moderated_at = now() where id = ${row!.id}`),
    ).rejects.toThrow();
  });
});
