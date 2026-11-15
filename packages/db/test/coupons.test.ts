/**
 * Coupons on the real checkout (spec 03 "Coupons", design 2026-11-15): the server prices the coupon in the placing
 * transaction (coupon first, then coins, COD cap after both), the order keeps a snapshot and a per-line allocation that
 * adds up exactly, redemption is counted by conditional UPDATE (never oversold, per-customer limit in the database), a
 * cancelled or rejected order gives the use back (a partly cancelled one does not), a shop-funded coupon needs its
 * shop's acceptance and lowers that shop's payout while a MechDost-funded one does not, admin CRUD is audited and
 * city-scoped, and another shop's offers are a 404. Runs on the Raipur demo catalogue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { CouponInput } from '@mechdost/shared/coupon-api';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  createCoupon,
  decideShopOffer,
  earnCoins,
  listCoupons,
  listShopOffers,
  placeOrder,
  previewCoupon,
  quoteCheckout,
  quoteInternal,
  setCouponPaused,
  transitionOrder,
  updateCoupon,
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
let n = 0;

const OIL = 'CAS-ACT4T-0900'; // ₹440, first shop
const sku = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? slug;
const TYRE = () => sku('scooter-tubeless-tyre-90-90-12'); // second shop
const address = (): ShippingAddress => ({
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  line2: null,
  landmark: null,
  pincode: '492004',
});
const key = () => `coupon-key-${String((n += 1)).padStart(8, '0')}`;
const code = () => `TEST${String((n += 1)).padStart(5, '0')}`;
const later = new Date('2030-01-01T00:00:00Z');

const couponInput = (over: Partial<CouponInput> = {}): CouponInput => ({
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
  ...over,
});

const make = (over: Partial<CouponInput> = {}) =>
  createCoupon(t(), { staffUserId: staff, scope: ALL, coupon: couponInput(over) });

async function setSetting(k: string, value: number) {
  await db
    .insert(s.settings)
    .values({ key: k, value, cityId: null })
    .onConflictDoUpdate({ target: [s.settings.cityId, s.settings.key], set: { value } });
}

/** Place a COD order using a coupon; the expected total is the previewed one less the coins asked for. */
async function place(
  lines: { sku: string; qty: number }[],
  couponCode: string | null,
  opts: { userId?: string; coins?: number; method?: 'cod' | 'online'; key?: string } = {},
) {
  const userId = opts.userId ?? ravi;
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  let total = opts.method === 'online' ? q.onlineTotalPaise : q.totalPaise;
  if (couponCode) {
    const p = await previewCoupon(t(), { userId, code: couponCode, pincode: '492004', lines, locale: 'en' });
    if (p.ok) total = (opts.method === 'online' ? p.onlineTotalPaise : p.totalPaise) - 0;
  }
  return placeOrder(t(), {
    method: opts.method ?? 'cod',
    userId,
    idempotencyKey: opts.key ?? key(),
    address: address(),
    lines,
    expectedTotalPaise: total - (opts.coins ?? 0) * 100,
    note: null,
    locale: 'en',
    coins: opts.coins ?? 0,
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

const pricingShop = async (lines: { sku: string; qty: number }[]) =>
  (await quoteInternal(t(), { pincode: '492004', lines, locale: 'en' })).groupShops[0] ?? '';

const couponRow = async (id: string) => {
  const [c] = await db.select().from(s.coupons).where(eq(s.coupons.id, id));
  if (!c) throw new Error('coupon');
  return c;
};
const myUses = async (couponId: string, userId: string) => {
  const [u] = await db
    .select({ uses: s.couponUserUsage.uses })
    .from(s.couponUserUsage)
    .where(and(eq(s.couponUserUsage.couponId, couponId), eq(s.couponUserUsage.userId, userId)));
  return u?.uses ?? 0;
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

async function deliverBy(orderId: string, shopId: string) {
  await step(orderId, 'placed', 'awaiting_shop', 'system');
  await step(orderId, 'awaiting_shop', 'confirmed', 'shop', { shopId, confirmedAt: new Date() });
  await step(orderId, 'confirmed', 'packed', 'shop');
  await step(orderId, 'packed', 'shipped', 'shop');
  await step(orderId, 'shipped', 'delivered', 'system', { deliveredAt: new Date() });
}

async function cancel(orderId: string) {
  const [o] = await db.select({ status: s.orders.status }).from(s.orders).where(eq(s.orders.id, orderId));
  await step(orderId, o?.status ?? 'placed', 'cancelled', 'admin', { statusReasonCode: 'other' });
}

async function newUser(tag: string) {
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `fb-coupon-${tag}-${String((n += 1))}` })
    .returning();
  if (!u) throw new Error('user');
  return u.id;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  [ravi, asha, staff] = await Promise.all([newUser('ravi'), newUser('asha'), newUser('staff')]);
});

afterAll(async () => {
  await client.close();
});

describe('pricing a MechDost-funded coupon (spec 03)', () => {
  it('takes the discount off in the server price path; snapshot + allocation add up exactly; coins come after', async () => {
    const c = await make({ kind: 'percent', value: 15, maxDiscountPaise: 20_000 });
    const lines = [
      { sku: OIL, qty: 2 },
      { sku: TYRE(), qty: 1 },
    ];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const preview = await previewCoupon(t(), {
      userId: ravi,
      code: c.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    if (!preview.ok) throw new Error('expected a discount');
    const expected = Math.min(Math.floor((q.subtotalPaise * 15) / 100), 20_000);
    expect(preview.discountPaise).toBe(expected);
    expect(preview.coupon.funder).toBe('mechdost');
    // Coins on what is left: 10% of the net products, whole coins, ₹1 each.
    await earnCoins(t(), {
      userId: ravi,
      coins: 300,
      reason: 'test',
      idemKey: `earn:${key()}`,
      expiresAt: later,
    });
    const maxCoins = Math.floor(preview.netSubtotalPaise / 10 / 100);
    const placed = await place(lines, c.code.toLowerCase(), { coins: maxCoins });
    expect(placed.couponDiscountPaise).toBe(expected);
    expect(placed.totalPaise).toBe(q.totalPaise - expected - maxCoins * 100);
    const { g, subs, items } = await groupOf(placed.code);
    expect(g).toMatchObject({
      couponId: c.id,
      couponCode: c.code,
      couponDiscountPaise: expected,
      coinDiscountPaise: maxCoins * 100,
      discountPaise: expected + maxCoins * 100,
    });
    expect(subs.reduce((a, o) => a + o.couponDiscountPaise, 0)).toBe(expected);
    expect(subs.reduce((a, o) => a + o.totalPaise, 0)).toBe(g.totalPaise);
    for (const o of subs) {
      expect(o.discountPaise).toBe(o.couponDiscountPaise + o.coinDiscountPaise);
      expect(o.couponFunder).toBe('mechdost');
      const own = items.filter((i) => i.orderId === o.id);
      expect(own.reduce((a, i) => a + i.lineDiscountPaise, 0)).toBe(o.couponDiscountPaise);
    }
    expect(items.reduce((a, i) => a + i.lineDiscountPaise, 0)).toBe(expected);
    expect(g.couponSnapshot).toMatchObject({ code: c.code, kind: 'percent', value: 15, funder: 'mechdost' });
    expect(await myUses(c.id, ravi)).toBe(1);
    expect((await couponRow(c.id)).usedCount).toBe(1);
  });

  it('COD cap is checked after the coupon', async () => {
    const lines = [{ sku: OIL, qty: 3 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const c = await make({ kind: 'flat', value: 10_000 });
    await setSetting('checkout.cod_cap_paise', q.totalPaise - 1);
    try {
      await expect(place(lines, null)).rejects.toMatchObject({ code: 'COD_NOT_ALLOWED' });
      const placed = await place(lines, c.code);
      expect(placed.totalPaise).toBe(q.totalPaise - 10_000);
    } finally {
      await setSetting('checkout.cod_cap_paise', 500_000);
    }
  });

  it('free delivery takes the delivery charge only', async () => {
    const lines = [{ sku: TYRE(), qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const c = await make({ kind: 'free_shipping', value: 0 });
    const p = await previewCoupon(t(), {
      userId: ravi,
      code: c.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    if (q.shippingPaise === 0) {
      expect(p).toMatchObject({ ok: false, reason: 'not_for_cart' });
      return;
    }
    expect(p).toMatchObject({ ok: true, discountPaise: q.shippingPaise, productDiscountPaise: 0 });
    const placed = await place(lines, c.code);
    const { items } = await groupOf(placed.code);
    expect(items.every((i) => i.lineDiscountPaise === 0)).toBe(true);
  });

  it('a retry with the same key is the same order and counts one use', async () => {
    const c = await make({ kind: 'flat', value: 5_000 });
    const lines = [{ sku: OIL, qty: 1 }];
    const k = key();
    const a = await place(lines, c.code, { key: k });
    const b = await place(lines, c.code, { key: k });
    expect(b).toMatchObject({ code: a.code, replayed: true, couponDiscountPaise: 5_000 });
    expect((await couponRow(c.id)).usedCount).toBe(1);
  });

  it('refuses a coupon on a bulk quote order', async () => {
    const c = await make({ kind: 'flat', value: 5_000 });
    await expect(
      placeOrder(t(), {
        method: 'cod',
        userId: ravi,
        idempotencyKey: key(),
        address: address(),
        lines: [{ sku: OIL, qty: 1 }],
        expectedTotalPaise: 1,
        note: null,
        locale: 'en',
        couponCode: c.code,
        quotePricing: {
          quoteId: '00000000-0000-7000-8000-000000000001',
          offerId: '00000000-0000-7000-8000-000000000002',
          unitPaiseBySku: new Map([[OIL, 40_000]]),
          deliveryPaise: 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'COUPON_INVALID', details: { reason: 'quote_order' } });
  });
});

describe('why a code is refused', () => {
  const lines = [{ sku: OIL, qty: 1 }];
  const reason = async (codeText: string, userId = ravi, cart = lines) => {
    const p = await previewCoupon(t(), {
      userId,
      code: codeText,
      pincode: '492004',
      lines: cart,
      locale: 'en',
    });
    return p.ok ? 'ok' : p.reason;
  };

  it('unknown, paused, not started, ended, minimum, other city', async () => {
    expect(await reason('NOSUCHCODE')).toBe('not_found');
    const paused = await make();
    await setCouponPaused(t(), {
      couponId: paused.id,
      paused: true,
      reason: 'Budget used up',
      expectedVersion: paused.version,
      staffUserId: staff,
      scope: ALL,
    });
    expect(await reason(paused.code)).toBe('paused');
    expect(await reason((await make({ startsAtIst: '2099-01-01T00:00' })).code)).toBe('not_started');
    expect(
      await reason((await make({ startsAtIst: '2020-01-01T00:00', endsAtIst: '2020-02-01T00:00' })).code),
    ).toBe('expired');
    expect(await reason((await make({ minSubtotalPaise: 9_999_900 })).code)).toBe('min_order');
    const [other] = await db
      .select()
      .from(s.cities)
      .where(sql`${s.cities.code} <> 'RPR'`)
      .limit(1);
    if (other) expect(await reason((await make({ city: other.code })).code)).toBe('wrong_city');
  });

  it('per-customer limit, and first order only', async () => {
    const once = await make({ usageLimitPerUser: 1, kind: 'flat', value: 1_000 });
    const fresh = await newUser('fresh');
    await place(lines, once.code, { userId: fresh });
    expect(await reason(once.code, fresh)).toBe('user_limit');
    expect(await reason(once.code, asha)).toBe('ok');
    const first = await make({ firstOrderOnly: true, usageLimitPerUser: 1, kind: 'flat', value: 1_000 });
    expect(await reason(first.code, ravi)).toBe('first_order_only'); // ravi has orders from earlier tests
    expect(await reason(first.code, await newUser('first'))).toBe('ok');
  });

  it('the database repeats the rules: per-customer trigger, shop-funded free delivery, first-order limit', async () => {
    const c = await make({ usageLimitPerUser: 1 });
    await db.insert(s.couponUserUsage).values({ couponId: c.id, userId: ravi, uses: 1 });
    await expect(
      db.update(s.couponUserUsage).set({ uses: 2 }).where(eq(s.couponUserUsage.couponId, c.id)),
    ).rejects.toThrow();
    await expect(
      db.insert(s.coupons).values({
        code: code(),
        kind: 'free_shipping',
        value: 0,
        startsAt: new Date('2020-01-01'),
        funder: 'shop',
        shopId: (await db.select({ id: s.shops.id }).from(s.shops).limit(1))[0]?.id ?? null,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(s.coupons).values({
        code: code(),
        kind: 'flat',
        value: 100,
        startsAt: new Date('2020-01-01'),
        firstOrderOnly: true,
        usageLimitPerUser: 2,
      }),
    ).rejects.toThrow();
  });
});

describe('redemption is counted, never oversold', () => {
  it('the last use goes to one of two parallel checkouts; the other rolls back whole', async () => {
    const c = await make({ usageLimitTotal: 1, kind: 'flat', value: 2_000 });
    const lines = [{ sku: OIL, qty: 1 }];
    const [u1, u2] = [await newUser('p1'), await newUser('p2')];
    // Both preview fine before either has placed.
    const results = await Promise.allSettled([
      place(lines, c.code, { userId: u1 }),
      place(lines, c.code, { userId: u2 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect(lost).toMatchObject({ reason: { code: 'COUPON_INVALID' } });
    expect((await couponRow(c.id)).usedCount).toBe(1);
    const groups = await db.select().from(s.orderGroups).where(eq(s.orderGroups.couponId, c.id));
    expect(groups).toHaveLength(1);
  });

  it('the conditional UPDATE itself refuses at the limit (no preview in front of it)', async () => {
    const c = await make({ usageLimitTotal: 1, kind: 'flat', value: 2_000 });
    const uses = async () =>
      db.execute(sql`update coupons set used_count = used_count + 1 where id = ${c.id}
        and (usage_limit_total is null or used_count < usage_limit_total) returning id`);
    const first = (await uses()) as unknown as { rows: unknown[] };
    const second = (await uses()) as unknown as { rows: unknown[] };
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });
});

describe('cancelled and rejected orders give the use back', () => {
  it('when every part is gone; a partly cancelled order keeps its use', async () => {
    const c = await make({ usageLimitTotal: 5, kind: 'flat', value: 3_000, usageLimitPerUser: 1 });
    const user = await newUser('cancel');
    const lines = [
      { sku: OIL, qty: 1 },
      { sku: TYRE(), qty: 1 },
    ];
    const placed = await place(lines, c.code, { userId: user });
    const { subs } = await groupOf(placed.code);
    expect(subs).toHaveLength(2);
    expect(await myUses(c.id, user)).toBe(1);
    await cancel(subs[0]?.id ?? '');
    expect((await couponRow(c.id)).usedCount).toBe(1); // one part is still alive
    expect(await myUses(c.id, user)).toBe(1);
    await cancel(subs[1]?.id ?? '');
    expect((await couponRow(c.id)).usedCount).toBe(0);
    expect(await myUses(c.id, user)).toBe(0);
    const [red] = await db.select().from(s.couponRedemptions).where(eq(s.couponRedemptions.couponId, c.id));
    expect(red?.releasedAt).not.toBeNull();
    // The customer can use it again.
    const again = await place([{ sku: OIL, qty: 1 }], c.code, { userId: user });
    expect(again.couponDiscountPaise).toBe(3_000);
  });
});

describe('who funds it: shop payouts', () => {
  const shopOf = async (orderId: string) => {
    const [o] = await db
      .select({ s: s.orders.suggestedShopId })
      .from(s.orders)
      .where(eq(s.orders.id, orderId));
    return o?.s ?? '';
  };
  const entries = (orderId: string) =>
    db.select().from(s.shopPayoutEntries).where(eq(s.shopPayoutEntries.orderId, orderId));

  it('a MechDost-funded discount is made good to the delivering shop on delivery', async () => {
    const c = await make({ kind: 'flat', value: 4_000 });
    const placed = await place([{ sku: OIL, qty: 1 }], c.code);
    const { subs } = await groupOf(placed.code);
    const orderId = subs[0]?.id ?? '';
    await deliverBy(orderId, await shopOf(orderId));
    expect(await entries(orderId)).toEqual([
      expect.objectContaining({ kind: 'coupon_discount', amountPaise: 4_000 }),
    ]);
  });

  it('a shop-funded coupon needs the shop to accept first, then lowers that shop’s payout (no entry)', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const shopId = await pricingShop(lines);
    const c = await make({ funder: 'shop', shopId, kind: 'flat', value: 2_500 });
    expect(c.shopTerms).toBe('pending');
    expect(c.live).toBe(false);
    const asked = await previewCoupon(t(), {
      userId: ravi,
      code: c.code,
      pincode: '492004',
      lines,
      locale: 'en',
    });
    expect(asked).toMatchObject({ ok: false, reason: 'shop_terms_pending' });
    const [offer] = (await listShopOffers(t(), { shopId, ownedShopIds: [shopId] })).filter(
      (o) => o.couponId === c.id,
    );
    expect(offer).toMatchObject({ status: 'pending', code: c.code });
    await decideShopOffer(t(), {
      shopId,
      ownedShopIds: [shopId],
      couponId: c.id,
      decision: 'accept',
      expectedVersion: offer?.version ?? 0,
      userId: staff,
    });
    const placed = await place(lines, c.code);
    expect(placed.couponDiscountPaise).toBe(2_500);
    const { subs } = await groupOf(placed.code);
    expect(subs[0]?.couponFunder).toBe('shop');
    await deliverBy(subs[0]?.id ?? '', shopId);
    expect(await entries(subs[0]?.id ?? '')).toEqual([]);
  });

  it('a shop-funded discount on goods another shop delivers is made good by MechDost', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const funding = await pricingShop(lines);
    const [otherShop] = await db
      .select({ id: s.shops.id })
      .from(s.shops)
      .where(sql`${s.shops.id} <> ${funding}`)
      .limit(1);
    const c = await make({ funder: 'shop', shopId: funding, kind: 'flat', value: 1_500 });
    const [terms] = await db.select().from(s.couponShopTerms).where(eq(s.couponShopTerms.couponId, c.id));
    await decideShopOffer(t(), {
      shopId: funding,
      ownedShopIds: [funding],
      couponId: c.id,
      decision: 'accept',
      expectedVersion: terms?.version ?? 0,
      userId: staff,
    });
    const placed = await place(lines, c.code);
    const orderId = (await groupOf(placed.code)).subs[0]?.id ?? '';
    await deliverBy(orderId, otherShop?.id ?? '');
    expect(await entries(orderId)).toEqual([
      expect.objectContaining({ kind: 'coupon_discount', amountPaise: 1_500, shopId: otherShop?.id }),
    ]);
  });

  it('changing the money terms asks the shop again; a stale accept is a 409; another shop’s offer is a 404', async () => {
    const [shopA, shopB] = await db.select({ id: s.shops.id }).from(s.shops).limit(2);
    if (!shopA || !shopB) throw new Error('need two shops');
    const c = await make({ funder: 'shop', shopId: shopA.id, kind: 'flat', value: 1_000 });
    const [terms] = await db.select().from(s.couponShopTerms).where(eq(s.couponShopTerms.couponId, c.id));
    await decideShopOffer(t(), {
      shopId: shopA.id,
      ownedShopIds: [shopA.id],
      couponId: c.id,
      decision: 'accept',
      expectedVersion: terms?.version ?? 0,
      userId: staff,
    });
    const edited = await updateCoupon(t(), {
      couponId: c.id,
      expectedVersion: c.version,
      staffUserId: staff,
      scope: ALL,
      coupon: couponInput({ code: c.code, funder: 'shop', shopId: shopA.id, kind: 'flat', value: 2_000 }),
    });
    expect(edited.shopTerms).toBe('pending');
    await expect(
      decideShopOffer(t(), {
        shopId: shopA.id,
        ownedShopIds: [shopA.id],
        couponId: c.id,
        decision: 'accept',
        expectedVersion: terms?.version ?? 0,
        userId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_OFFER' });
    // Role leak: a shop that is not the funder sees and decides nothing of it.
    expect(
      (await listShopOffers(t(), { shopId: shopB.id, ownedShopIds: [shopB.id] })).map((o) => o.couponId),
    ).not.toContain(c.id);
    await expect(
      decideShopOffer(t(), {
        shopId: shopB.id,
        ownedShopIds: [shopB.id],
        couponId: c.id,
        decision: 'accept',
        expectedVersion: 1,
        userId: staff,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listShopOffers(t(), { shopId: shopA.id, ownedShopIds: [shopB.id] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('admin coupons (coupons:write): CRUD, pause, scope, audit', () => {
  it('creates, edits with a version check, locks kind after use, pauses with a reason, audits all', async () => {
    const c = await make({ kind: 'flat', value: 1_000 });
    await expect(make({ code: c.code })).rejects.toMatchObject({ code: 'COUPON_CODE_TAKEN' });
    const edited = await updateCoupon(t(), {
      couponId: c.id,
      expectedVersion: c.version,
      staffUserId: staff,
      scope: ALL,
      coupon: couponInput({ code: c.code, kind: 'flat', value: 1_500 }),
    });
    expect(edited.value).toBe(1_500);
    await expect(
      updateCoupon(t(), {
        couponId: c.id,
        expectedVersion: c.version, // stale
        staffUserId: staff,
        scope: ALL,
        coupon: couponInput({ code: c.code, kind: 'flat', value: 1_600 }),
      }),
    ).rejects.toMatchObject({ code: 'STALE_COUPON' });
    await place([{ sku: OIL, qty: 1 }], c.code);
    await expect(
      updateCoupon(t(), {
        couponId: c.id,
        expectedVersion: edited.version,
        staffUserId: staff,
        scope: ALL,
        coupon: couponInput({ code: c.code, kind: 'percent', value: 5 }),
      }),
    ).rejects.toMatchObject({ code: 'COUPON_LOCKED' });
    const paused = await setCouponPaused(t(), {
      couponId: c.id,
      paused: true,
      reason: 'Too generous',
      expectedVersion: edited.version,
      staffUserId: staff,
      scope: ALL,
    });
    expect(paused).toMatchObject({ active: false, pausedReason: 'Too generous', live: false });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, c.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['coupon.created', 'coupon.paused', 'coupon.updated']);
    const events = await db.execute(sql`select event from events where props->>'couponId' = ${c.id}`);
    expect(JSON.stringify(events)).toContain('admin_coupon_saved');
  });

  it('a city-scoped manager sees and edits only their city; "every city" needs the all-cities grant', async () => {
    const [rpr] = await db.select().from(s.cities).where(eq(s.cities.code, 'RPR'));
    const scoped = { all: false as const, cityIds: [rpr?.id ?? ''] };
    await expect(
      createCoupon(t(), { staffUserId: staff, scope: scoped, coupon: couponInput({ city: null }) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const mine = await createCoupon(t(), {
      staffUserId: staff,
      scope: scoped,
      coupon: couponInput({ city: 'RPR' }),
    });
    const global = await make();
    const seen = (await listCoupons(t(), { scope: scoped, limit: 100 })).coupons.map((x) => x.id);
    expect(seen).toContain(mine.id);
    expect(seen).not.toContain(global.id);
    await expect(
      setCouponPaused(t(), {
        couponId: global.id,
        paused: true,
        reason: 'no way',
        expectedVersion: global.version,
        staffUserId: staff,
        scope: scoped,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const nobody = { all: false as const, cityIds: [] };
    expect((await listCoupons(t(), { scope: nobody })).coupons).toEqual([]);
  });

  it('lists with a cursor', async () => {
    const first = await listCoupons(t(), { scope: ALL, limit: 2 });
    expect(first.coupons).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const next = await listCoupons(t(), { scope: ALL, limit: 2, cursor: first.nextCursor });
    expect(next.coupons[0]?.id).not.toBe(first.coupons[0]?.id);
  });
});
