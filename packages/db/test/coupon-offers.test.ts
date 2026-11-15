/**
 * Coupon follow-ups (2026-11-16, plan docs/superpowers/plans/2026-11-16-coupon-followups.md): the public offers list,
 * usage reports, the whole-order refund that gives the use back, and automatic offers (never stacked with a code: the
 * larger discount wins, a tie goes to the typed code; priced on the server only, snapshot on the order). Runs on the
 * Raipur demo catalogue.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { CouponInput } from '@mechdost/shared/coupon-api';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  approveRefund,
  cityIdByCode,
  countExportRows,
  couponUsageReport,
  createCoupon,
  createStaffRefund,
  exportPages,
  listPublicOffers,
  markRefundPaid,
  placeOrder,
  previewCoupon,
  quoteCheckout,
  setCouponPaused,
  transitionOrder,
  type ShippingAddress,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
let ravi = '';
let asha = '';
let staff = '';
let staff2 = '';
let rpr = '';
let n = 0;

const OIL = 'CAS-ACT4T-0900'; // 440 rupees, first shop
const sku = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? slug;
const TYRE = () => sku('scooter-tubeless-tyre-90-90-12');
const address = (): ShippingAddress => ({
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  line2: null,
  landmark: null,
  pincode: '492004',
});
const key = () => `offer-key-${String((n += 1)).padStart(8, '0')}`;
const code = () => `OFFR${String((n += 1)).padStart(5, '0')}`;

const input = (over: Partial<CouponInput> = {}): CouponInput => ({
  code: code(),
  title: 'Test offer',
  titleHi: 'टेस्ट ऑफ़र',
  terms: null,
  termsHi: null,
  kind: 'percent',
  value: 10,
  minSubtotalPaise: 0,
  maxDiscountPaise: null,
  startsAtIst: '2020-01-01T00:00',
  endsAtIst: null,
  usageLimitTotal: null,
  usageLimitPerUser: 5,
  firstOrderOnly: false,
  city: null,
  funder: 'mechdost',
  shopId: null,
  isPublic: false,
  autoApply: false,
  categorySlug: null,
  ...over,
});
const make = (over: Partial<CouponInput> = {}) =>
  createCoupon(t(), { staffUserId: staff, scope: ALL, coupon: input(over) });
/** Take an automatic offer out of play so the next test starts clean. */
const retire = (id: string) =>
  db.update(s.coupons).set({ active: false, pausedReason: 'test over' }).where(eq(s.coupons.id, id));

async function newUser(tag: string) {
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `fb-offers-${tag}-${String((n += 1))}` })
    .returning();
  if (!u) throw new Error('user');
  return u.id;
}

/** Place a COD order the way the checkout does: preview (with or without a typed code), then place for that total. */
async function place(
  lines: { sku: string; qty: number }[],
  couponCode: string | null,
  opts: { userId?: string; expectedDelta?: number } = {},
) {
  const userId = opts.userId ?? ravi;
  const p = await previewCoupon(t(), { userId, code: couponCode, pincode: '492004', lines, locale: 'en' });
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  const total = (p.ok ? p.totalPaise : q.totalPaise) + (opts.expectedDelta ?? 0);
  return placeOrder(t(), {
    method: 'cod',
    userId,
    idempotencyKey: key(),
    address: address(),
    lines,
    expectedTotalPaise: total,
    note: null,
    locale: 'en',
    couponCode,
  });
}

async function groupOf(orderCode: string) {
  const [g] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, orderCode));
  if (!g) throw new Error('group');
  const subs = await db.select().from(s.orders).where(eq(s.orders.groupId, g.id)).orderBy(s.orders.subNo);
  const items = await db
    .select()
    .from(s.orderItems)
    .where(sql`${s.orderItems.orderId} in (select id from orders where group_id = ${g.id})`);
  return { g, subs, items };
}
const couponRow = async (id: string) => {
  const [c] = await db.select().from(s.coupons).where(eq(s.coupons.id, id));
  if (!c) throw new Error('coupon');
  return c;
};

async function step(
  orderId: string,
  from: string,
  to: string,
  actor: 'system' | 'shop' | 'admin',
  patch = {},
) {
  const [o] = await db.select({ version: s.orders.version }).from(s.orders).where(eq(s.orders.id, orderId));
  await db.transaction((tx) =>
    transitionOrder(tx as unknown as Tx, {
      orderId,
      from: from as never,
      to: to as never,
      expectedVersion: o?.version ?? 0,
      actor: { type: actor, userId: actor === 'admin' ? staff : null },
      patch,
    }),
  );
}
async function deliver(orderId: string) {
  const [o] = await db
    .select({ shop: s.orders.suggestedShopId })
    .from(s.orders)
    .where(eq(s.orders.id, orderId));
  await step(orderId, 'placed', 'awaiting_shop', 'system');
  await step(orderId, 'awaiting_shop', 'confirmed', 'shop', {
    shopId: o?.shop ?? '',
    confirmedAt: new Date(),
  });
  await step(orderId, 'confirmed', 'packed', 'shop');
  await step(orderId, 'packed', 'shipped', 'shop');
  await step(orderId, 'shipped', 'delivered', 'system', { deliveredAt: new Date() });
}
async function cancel(orderId: string) {
  const [o] = await db.select({ status: s.orders.status }).from(s.orders).where(eq(s.orders.id, orderId));
  await step(orderId, o?.status ?? 'placed', 'cancelled', 'admin', { statusReasonCode: 'other' });
}
const categoryOf = async (skuCode: string) => {
  const [r] = await db
    .select({ slug: s.categories.slug })
    .from(s.productVariants)
    .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
    .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
    .where(eq(s.productVariants.sku, skuCode));
  if (!r) throw new Error('category');
  return r.slug;
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  [ravi, asha, staff, staff2] = await Promise.all([
    newUser('ravi'),
    newUser('asha'),
    newUser('staff'),
    newUser('staff2'),
  ]);
  rpr = await cityIdByCode(t(), 'RPR');
});

afterAll(async () => {
  await client.close();
});

describe('public offers list', () => {
  it('lists only live offers the admin made public, in the page language, with no usage numbers', async () => {
    const live = await make({
      isPublic: true,
      title: 'Public live',
      titleHi: 'सार्वजनिक ऑफ़र',
      terms: 'Terms',
      termsHi: 'शर्तें',
    });
    const hidden = await make({ isPublic: false });
    const paused = await make({ isPublic: true });
    await setCouponPaused(t(), {
      couponId: paused.id,
      paused: true,
      reason: 'testing',
      expectedVersion: paused.version,
      staffUserId: staff,
      scope: ALL,
    });
    const ended = await make({
      isPublic: true,
      startsAtIst: '2020-01-01T00:00',
      endsAtIst: '2020-02-01T00:00',
    });
    const future = await make({ isPublic: true, startsAtIst: '2099-01-01T00:00' });
    const used = await make({ isPublic: true, usageLimitTotal: 1 });
    await db.update(s.coupons).set({ usedCount: 1 }).where(eq(s.coupons.id, used.id));

    const en = await listPublicOffers(t(), { cityId: rpr, locale: 'en' });
    const ids = en.map((o) => o.id);
    expect(ids).toContain(live.id);
    for (const gone of [hidden, paused, ended, future, used]) expect(ids).not.toContain(gone.id);
    const mine = en.find((o) => o.id === live.id);
    expect(mine).toMatchObject({ code: live.code, title: 'Public live', terms: 'Terms', automatic: false });
    // Nothing about usage or who funds it beyond the label leaks.
    expect(Object.keys(mine ?? {}).sort()).toEqual(
      [
        'automatic',
        'categoryName',
        'code',
        'endsAt',
        'firstOrderOnly',
        'funder',
        'id',
        'kind',
        'maxDiscountPaise',
        'minSubtotalPaise',
        'shopName',
        'terms',
        'title',
        'value',
      ].sort(),
    );
    const hi = await listPublicOffers(t(), { cityId: rpr, locale: 'hi' });
    expect(hi.find((o) => o.id === live.id)).toMatchObject({ title: 'सार्वजनिक ऑफ़र', terms: 'शर्तें' });
  });

  it('is city scoped, hides a shop offer until its shop accepted, and never prints an automatic offer code', async () => {
    const elsewhere = await make({ isPublic: true, city: 'RPR' });
    const otherCity = '00000000-0000-7000-8000-000000000000';
    expect((await listPublicOffers(t(), { cityId: otherCity, locale: 'en' })).map((o) => o.id)).not.toContain(
      elsewhere.id,
    );
    expect((await listPublicOffers(t(), { cityId: rpr, locale: 'en' })).map((o) => o.id)).toContain(
      elsewhere.id,
    );

    const shopId = (
      await db.select({ id: s.shops.id }).from(s.shops).where(eq(s.shops.status, 'approved')).limit(1)
    )[0]?.id;
    const shopOffer = await make({
      isPublic: true,
      funder: 'shop',
      shopId: shopId ?? null,
      kind: 'flat',
      value: 1_000,
    });
    expect((await listPublicOffers(t(), { cityId: rpr, locale: 'en' })).map((o) => o.id)).not.toContain(
      shopOffer.id,
    );

    const auto = await make({ isPublic: true, autoApply: true, kind: 'flat', value: 100 });
    const listed = (await listPublicOffers(t(), { cityId: rpr, locale: 'en' })).find((o) => o.id === auto.id);
    expect(listed).toMatchObject({ code: null, automatic: true });
    await retire(auto.id);
  });
});

describe('usage report', () => {
  it('counts orders, released uses, discount given, unique customers and days; a closed order is released', async () => {
    const c = await make({ kind: 'flat', value: 4_000 });
    const a = await place([{ sku: OIL, qty: 1 }], c.code, { userId: ravi });
    await place([{ sku: OIL, qty: 1 }], c.code, { userId: ravi });
    const third = await place([{ sku: OIL, qty: 1 }], c.code, { userId: asha });
    await cancel((await groupOf(third.code)).subs[0]?.id ?? '');
    expect(a.couponDiscountPaise).toBe(4_000);

    const r = await couponUsageReport(t(), { scope: ALL, couponId: c.id });
    expect(r.totals).toEqual({ orders: 3, released: 1, uses: 2, discountPaise: 8_000, uniqueCustomers: 1 });
    expect(r.totals.uses).toBe((await couponRow(c.id)).usedCount);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({ orders: 3, released: 1, discountPaise: 8_000, uniqueCustomers: 1 });
    expect(r.days[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.nextCursor).toBeNull();
  });

  it('pages the days with a cursor, newest first, using IST days', async () => {
    const c = await make({ kind: 'flat', value: 1_000 });
    for (let i = 0; i < 3; i += 1) await place([{ sku: OIL, qty: 1 }], c.code, { userId: ravi });
    const rows = await db.select().from(s.couponRedemptions).where(eq(s.couponRedemptions.couponId, c.id));
    // 2026-11-10 23:30 UTC is 2026-11-11 05:00 IST: the IST day is the 11th.
    const stamps = ['2026-11-10T23:30:00Z', '2026-11-12T10:00:00Z', '2026-11-13T10:00:00Z'];
    for (const [i, row] of rows.entries())
      await db
        .update(s.couponRedemptions)
        .set({ createdAt: new Date(stamps[i] ?? stamps[0] ?? '') })
        .where(eq(s.couponRedemptions.id, row.id));
    const p1 = await couponUsageReport(t(), { scope: ALL, couponId: c.id, limit: 2 });
    expect(p1.days.map((d) => d.day)).toEqual(['2026-11-13', '2026-11-12']);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await couponUsageReport(t(), { scope: ALL, couponId: c.id, limit: 2, cursor: p1.nextCursor });
    expect(p2.days.map((d) => d.day)).toEqual(['2026-11-11']);
    expect(p2.nextCursor).toBeNull();
    expect(p2.totals.orders).toBe(3);
  });

  it("is a 404 for a coupon outside the staff member's cities, and for an unknown id", async () => {
    const c = await make({ city: 'RPR' });
    await expect(
      couponUsageReport(t(), { scope: { all: false, cityIds: [] }, couponId: c.id }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      couponUsageReport(t(), { scope: ALL, couponId: '00000000-0000-7000-8000-000000000001' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('exports one row per use as the coupon_usage dataset, city scoped, with no personal data', async () => {
    const c = await make({ kind: 'flat', value: 2_000 });
    await place([{ sku: OIL, qty: 1 }], c.code, { userId: ravi });
    const q = {
      dataset: 'coupon_usage' as const,
      from: '2020-01-01',
      to: '2026-12-31',
      cityIds: null,
      maskContacts: true,
    };
    const rows: string[][] = [];
    for await (const page of exportPages(t(), q)) rows.push(...page);
    const mine = rows.filter((r) => r[0] === c.code);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual(expect.arrayContaining([c.code, '20.00', '2000']));
    expect(mine[0]?.join(',')).not.toContain(ravi);
    expect(await countExportRows(t(), { ...q, cityIds: [] })).toBe(0);
  });
});

describe('a whole-order refund after delivery gives the use back', () => {
  const k = () => randomBytes(32).toString('base64');
  const keyring = loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${k()}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: k(),
  });
  const upi = { kind: 'upi', upiId: 'ravi.kumar@okhdfcbank' } as const;

  async function refund(orderCode: string, amountPaise: number) {
    const { refund: r } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: staff,
      orderCode,
      amountPaise,
      source: 'support_claim',
      reasonCode: 'faulty',
      destination: upi,
      keyring,
      idempotencyKey: `req-${String((n += 1))}-cod`,
    });
    const approved = await approveRefund(t(), {
      scope: ALL,
      staffUserId: staff2,
      refundId: r.id,
      expectedVersion: r.version,
    });
    return markRefundPaid(t(), {
      scope: ALL,
      staffUserId: staff2,
      refundId: r.id,
      expectedVersion: approved.version,
      reference: `41234567${String(n).padStart(4, '0')}`,
    });
  }

  it('keeps the use after a partial refund, gives it back once the delivered order is refunded in full, once', async () => {
    const buyer = await newUser('refunded');
    const c = await make({ kind: 'flat', value: 4_000, usageLimitTotal: 5 });
    const placed = await place([{ sku: OIL, qty: 1 }], c.code, { userId: buyer });
    const { subs } = await groupOf(placed.code);
    const sub = subs[0];
    if (!sub) throw new Error('sub');
    await deliver(sub.id);
    expect((await couponRow(c.id)).usedCount).toBe(1);

    await refund(sub.code, 2_000);
    expect((await couponRow(c.id)).usedCount).toBe(1); // partial: the use stays
    await refund(sub.code, sub.totalPaise - 2_000);

    expect((await couponRow(c.id)).usedCount).toBe(0);
    const [usage] = await db
      .select()
      .from(s.couponUserUsage)
      .where(and(eq(s.couponUserUsage.couponId, c.id), eq(s.couponUserUsage.userId, buyer)));
    expect(usage?.uses).toBe(0);
    const [red] = await db.select().from(s.couponRedemptions).where(eq(s.couponRedemptions.couponId, c.id));
    expect(red?.releasedAt).not.toBeNull();
    const report = await couponUsageReport(t(), { scope: ALL, couponId: c.id });
    expect(report.totals).toMatchObject({ orders: 1, released: 1, uses: 0, discountPaise: 0 });
    const ev = await db.execute(
      sql`select props from events where event = 'coupon_released' and user_id = ${buyer}`,
    );
    expect(JSON.stringify(ev.rows)).toContain('order_refunded');

    // The customer can use it again, and the counters stay exact if the release runs again (idempotent).
    const again = await place([{ sku: OIL, qty: 1 }], c.code, { userId: buyer });
    expect(again.couponDiscountPaise).toBe(4_000);
    expect((await couponRow(c.id)).usedCount).toBe(1);
  });
});

describe('automatic offers (no code, never stacked)', () => {
  it('applies at checkout without a code, is re-priced on the server and keeps a snapshot; counters move', async () => {
    const buyer = await newUser('auto1');
    const a = await make({
      autoApply: true,
      kind: 'flat',
      value: 5_000,
      title: 'Welcome',
      titleHi: 'स्वागत',
    });
    const lines = [{ sku: OIL, qty: 1 }];
    const p = await previewCoupon(t(), { userId: buyer, code: null, pincode: '492004', lines, locale: 'en' });
    if (!p.ok) throw new Error('expected the automatic offer');
    expect(p).toMatchObject({ source: 'automatic', discountPaise: 5_000, beaten: null });
    expect(p.coupon.title).toBe('Welcome');

    // A client that forgets the offer (a stale total) is refused: the server prices it.
    await expect(place(lines, null, { userId: buyer, expectedDelta: 5_000 })).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
    });
    const placed = await place(lines, null, { userId: buyer });
    expect(placed.couponDiscountPaise).toBe(5_000);
    const { g, subs } = await groupOf(placed.code);
    expect(g.couponId).toBe(a.id);
    expect(g.couponSnapshot).toMatchObject({ code: a.code, automatic: true, discountPaise: 5_000 });
    expect(subs[0]?.couponDiscountPaise).toBe(5_000);
    expect((await couponRow(a.id)).usedCount).toBe(1);
    await retire(a.id);
  });

  it('first order only: gone after the first order; a typed auto code is just "not valid"', async () => {
    const buyer = await newUser('auto2');
    const a = await make({
      autoApply: true,
      kind: 'flat',
      value: 3_000,
      firstOrderOnly: true,
      usageLimitPerUser: 1,
    });
    const lines = [{ sku: OIL, qty: 1 }];
    expect((await place(lines, null, { userId: buyer })).couponDiscountPaise).toBe(3_000);
    const next = await previewCoupon(t(), {
      userId: buyer,
      code: null,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(next.ok).toBe(false);
    const typed = await previewCoupon(t(), {
      userId: ravi,
      code: a.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(typed).toMatchObject({ ok: false, reason: 'not_found' });
    await retire(a.id);
  });

  it('never stacks: the larger discount wins, a tie goes to the typed code, the loser is shown', async () => {
    const buyer = await newUser('auto3');
    const lines = [{ sku: OIL, qty: 1 }]; // 440 rupees
    const auto = await make({ autoApply: true, kind: 'flat', value: 5_000 });
    const small = await make({ kind: 'flat', value: 2_000 });
    const big = await make({ kind: 'flat', value: 9_000 });
    const tie = await make({ kind: 'flat', value: 5_000 });

    const pSmall = await previewCoupon(t(), {
      userId: buyer,
      code: small.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(pSmall).toMatchObject({ ok: true, source: 'automatic', discountPaise: 5_000 });
    if (pSmall.ok) expect(pSmall.beaten).toMatchObject({ source: 'code', discountPaise: 2_000 });

    const pBig = await previewCoupon(t(), {
      userId: buyer,
      code: big.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(pBig).toMatchObject({ ok: true, source: 'code', discountPaise: 9_000 });
    if (pBig.ok) expect(pBig.beaten).toMatchObject({ source: 'automatic', discountPaise: 5_000 });

    const pTie = await previewCoupon(t(), {
      userId: buyer,
      code: tie.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(pTie).toMatchObject({ ok: true, source: 'code', discountPaise: 5_000 });

    // Placing counts exactly one use: the winner's. The loser is untouched.
    const placedSmall = await place(lines, small.code, { userId: buyer });
    expect(placedSmall.couponDiscountPaise).toBe(5_000);
    expect((await couponRow(auto.id)).usedCount).toBe(1);
    expect((await couponRow(small.id)).usedCount).toBe(0);
    const placedBig = await place(lines, big.code, { userId: buyer });
    expect(placedBig.couponDiscountPaise).toBe(9_000);
    expect((await couponRow(big.id)).usedCount).toBe(1);
    expect((await couponRow(auto.id)).usedCount).toBe(1);

    // A bad typed code is still refused even when an automatic offer exists (the customer typed it on purpose).
    await expect(place(lines, 'NOPE1234', { userId: buyer })).rejects.toMatchObject({
      code: 'COUPON_INVALID',
    });
    await retire(auto.id);
  });

  it('a category offer takes its percent from that category only, with an exact per-line allocation', async () => {
    const buyer = await newUser('auto4');
    const category = await categoryOf(OIL);
    const a = await make({ autoApply: true, kind: 'percent', value: 10, categorySlug: category });
    expect(a.category?.slug).toBe(category);
    await expect(make({ categorySlug: 'no-such-category' })).rejects.toMatchObject({
      code: 'COUPON_CATEGORY',
    });
    const lines = [
      { sku: OIL, qty: 2 },
      { sku: TYRE(), qty: 1 },
    ];
    const oilTotal = (
      await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 2 }], locale: 'en' })
    ).subtotalPaise;
    const placed = await place(lines, null, { userId: buyer });
    expect(placed.couponDiscountPaise).toBe(Math.floor(oilTotal / 10));
    const { items } = await groupOf(placed.code);
    const tyreLine = items.find((i) => i.sku === TYRE());
    expect(tyreLine?.lineDiscountPaise).toBe(0);
    expect(items.reduce((sum, i) => sum + i.lineDiscountPaise, 0)).toBe(placed.couponDiscountPaise);
    await retire(a.id);
  });

  it('a minimum order and a paused offer keep it from applying; a shop cannot fund an automatic offer', async () => {
    const buyer = await newUser('auto5');
    const lines = [{ sku: OIL, qty: 1 }];
    const a = await make({ autoApply: true, kind: 'flat', value: 1_000, minSubtotalPaise: 9_000_000 });
    expect(
      (await previewCoupon(t(), { userId: buyer, code: null, pincode: '492004', lines, locale: 'en' })).ok,
    ).toBe(false);
    await retire(a.id);
    await expect(
      make({ autoApply: true, funder: 'shop', shopId: '00000000-0000-7000-8000-000000000002' }),
    ).rejects.toBeTruthy();
  });
});
