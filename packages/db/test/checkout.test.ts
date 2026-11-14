/**
 * Checkout (spec 03 acceptance tests): the server re-prices every line (nearest covering shop with enough stock),
 * splits per shop, splits GST exactly (CGST = SGST in-state, IGST across states), enforces the COD cap, and the
 * same idempotency key never places two orders. Runs on the Raipur demo catalogue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { placeCodOrder, placeOrder, quoteCheckout, type ShippingAddress, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let userId = '';

const OIL = 'CAS-ACT4T-0900'; // lubricants, ₹440 at the first shop
const sku = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? slug;
const address = (pincode = '492004'): ShippingAddress => ({
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  line2: null,
  landmark: null,
  pincode,
});
const key = (n: number) => `checkout-key-${String(n).padStart(6, '0')}`;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  userId = (await db.insert(s.users).values({ firebaseUid: 'fb-checkout-ravi' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('quote', () => {
  it('splits a cart per nearest shop with exact in-state GST', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [
        { sku: OIL, qty: 2 },
        { sku: sku('scooter-tubeless-tyre-90-90-12'), qty: 1 },
      ],
      locale: 'en',
    });
    expect(q.ok).toBe(true);
    expect(q.groups.map((g) => g.seller).sort()).toEqual(['Chhattisgarh Tyre House', 'Sharma Auto Parts']);
    const oil = q.lines.find((l) => l.sku === OIL);
    expect(oil).toMatchObject({
      unitPaise: 44000,
      totalPaise: 88000,
      issue: null,
      name: 'Castrol Activ 4T 20W40 900 ml',
    });
    expect(q.subtotalPaise).toBe(88000 + 165000);
    expect(q.shippingPaise).toBe(2 * 4000);
    expect(q.totalPaise).toBe(q.subtotalPaise + q.shippingPaise + q.codFeePaise);
    // 18 % inclusive on ₹880 = ₹134.24, split in two equal halves.
    expect(q.groups.find((g) => g.seller === 'Sharma Auto Parts')?.taxPaise).toBe(2 * 6712);
  });

  it('reports unavailable lines and the most any shop can deliver', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [
        { sku: OIL, qty: 50 },
        { sku: sku('heavy-duty-battery-90ah'), qty: 1 }, // on request: no stock anywhere
        { sku: 'NO-SUCH-SKU', qty: 1 },
      ],
      locale: 'hi',
    });
    expect(q.ok).toBe(false);
    expect(q.lines.map((l) => [l.issue, l.available])).toEqual([
      ['insufficient_stock', 12],
      ['unavailable', null],
      ['unavailable', null],
    ]);
    expect(q.groups).toEqual([]);
  });

  it('applies the COD cap, the free-delivery setting and refuses unknown PINs', async () => {
    const tyres = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [{ sku: sku('car-tyre-185-65-r15'), qty: 2 }], // ₹8,400 > ₹5,000 cap
      locale: 'en',
    });
    expect(tyres.cod).toEqual({ allowed: false, reason: 'over_cap', capPaise: 500000 });

    await db.insert(s.settings).values({ key: 'checkout.free_delivery_min_paise', value: 50000 });
    const free = await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 2 }], locale: 'en' });
    expect(free.shippingPaise).toBe(0);
    await db.delete(s.settings).where(eq(s.settings.key, 'checkout.free_delivery_min_paise'));

    await expect(
      quoteCheckout(t(), { pincode: '110001', lines: [{ sku: OIL, qty: 1 }], locale: 'en' }),
    ).rejects.toMatchObject({ code: 'PINCODE_NOT_SERVICEABLE' });
    await expect(
      quoteCheckout(t(), {
        pincode: '492004',
        lines: [
          { sku: OIL, qty: 1 },
          { sku: OIL, qty: 2 },
        ],
        locale: 'en',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_LINE' });
  });

  it('free delivery per group: the shop override wins over the city setting; 0 = always free', async () => {
    const [sharma] = await db.select().from(s.shops).where(eq(s.shops.name, 'Sharma Auto Parts'));
    const lines = [
      { sku: OIL, qty: 2 }, // ₹880 from Sharma
      { sku: sku('scooter-tubeless-tyre-90-90-12'), qty: 1 }, // ₹1,650 from Chhattisgarh Tyre House
    ];
    const shippingBySeller = async () =>
      Object.fromEntries(
        (await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' })).groups.map((g) => [
          g.seller,
          g.shippingPaise,
        ]),
      );
    await db.insert(s.settings).values({ key: 'checkout.free_delivery_min_paise', value: 100000 });
    // City: free from ₹1,000 → only the tyre group (₹1,650) ships free.
    expect(await shippingBySeller()).toEqual({ 'Sharma Auto Parts': 4000, 'Chhattisgarh Tyre House': 0 });
    // Sharma: free from ₹500 → its ₹880 group ships free too; the other shop still follows the city.
    await db.update(s.shops).set({ freeDeliveryMinPaise: 50000 }).where(eq(s.shops.id, sharma!.id));
    expect(await shippingBySeller()).toEqual({ 'Sharma Auto Parts': 0, 'Chhattisgarh Tyre House': 0 });
    // A shop threshold above the city's is honoured (the shop's value, not the lower one).
    await db.update(s.shops).set({ freeDeliveryMinPaise: 1_00_000_00 }).where(eq(s.shops.id, sharma!.id));
    await db
      .update(s.settings)
      .set({ value: 50000 })
      .where(eq(s.settings.key, 'checkout.free_delivery_min_paise'));
    expect(await shippingBySeller()).toEqual({ 'Sharma Auto Parts': 4000, 'Chhattisgarh Tyre House': 0 });
    // 0 = always free for that shop, even with no city setting at all.
    await db.delete(s.settings).where(eq(s.settings.key, 'checkout.free_delivery_min_paise'));
    await db.update(s.shops).set({ freeDeliveryMinPaise: 0 }).where(eq(s.shops.id, sharma!.id));
    expect(await shippingBySeller()).toEqual({ 'Sharma Auto Parts': 0, 'Chhattisgarh Tyre House': 4000 });
    // The PIN's own value wins over the shop's: PIN 0 = free for every group even with a shop threshold.
    await db.update(s.shops).set({ freeDeliveryMinPaise: 1_00_000_00 }).where(eq(s.shops.id, sharma!.id));
    await db.update(s.pincodes).set({ freeDeliveryMinPaise: 0 }).where(eq(s.pincodes.pincode, '492004'));
    expect(await shippingBySeller()).toEqual({ 'Sharma Auto Parts': 0, 'Chhattisgarh Tyre House': 0 });
    // PIN null falls back to the shop (Sharma: above its ₹880, so charged), then to the city (none: charged).
    await db.update(s.pincodes).set({ freeDeliveryMinPaise: null }).where(eq(s.pincodes.pincode, '492004'));
    expect(await shippingBySeller()).toEqual({ 'Sharma Auto Parts': 4000, 'Chhattisgarh Tyre House': 4000 });
    await db.update(s.shops).set({ freeDeliveryMinPaise: null }).where(eq(s.shops.id, sharma!.id));
    await expect(
      db.update(s.shops).set({ freeDeliveryMinPaise: -1 }).where(eq(s.shops.id, sharma!.id)),
    ).rejects.toThrow();
  });

  it('uses IGST when the shop is in another state', async () => {
    const [od] = await db
      .insert(s.states)
      .values({ code: 'OD', name: 'Odisha', gstStateCode: '21' })
      .returning();
    const [sharma] = await db.select().from(s.shops).where(eq(s.shops.name, 'Sharma Auto Parts'));
    await db.update(s.shops).set({ stateId: od!.id }).where(eq(s.shops.id, sharma!.id));
    const q = await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 2 }], locale: 'en' });
    expect(q.groups[0]?.taxPaise).toBe(13424); // ₹880 × 18/118, one IGST amount
    await db.update(s.shops).set({ stateId: sharma!.stateId }).where(eq(s.shops.id, sharma!.id));
  });
});

describe('placing a COD order', () => {
  it('creates sub-orders, items, reservations, a timeline event and an audit row', async () => {
    const lines = [
      { sku: OIL, qty: 2 },
      { sku: sku('scooter-tubeless-tyre-90-90-12'), qty: 1 },
    ];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const placed = await placeCodOrder(t(), {
      userId,
      idempotencyKey: key(1),
      address: address(),
      lines,
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    expect(placed).toMatchObject({ paymentStatus: 'cod_pending', totalPaise: q.totalPaise, replayed: false });
    expect(placed.code).toMatch(/^MD-RPR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(placed.orders.map((o) => o.code)).toEqual([`${placed.code}-1`, `${placed.code}-2`]);

    const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
    const subs = await db.select().from(s.orders).where(eq(s.orders.groupId, group!.id));
    expect(subs.every((o) => o.status === 'placed' && o.suggestedShopId !== null && o.shopId === null)).toBe(
      true,
    );
    const items = await db.select().from(s.orderItems);
    expect(items.map((i) => i.cgstPaise === i.sgstPaise && i.igstPaise === 0)).toEqual([true, true]);
    // Titles snapshot in English and Hindi whatever the customer's locale (hard rule 10).
    const tyre = items.find((i) => i.sku === sku('scooter-tubeless-tyre-90-90-12'));
    expect(tyre?.title).toMatch(/Tubeless scooter tyre 90\/90-12$/u);
    expect(tyre?.titleHi).toMatch(/[ऀ-ॿ]/u);
    const reserved = await db.select().from(s.reservations).where(eq(s.reservations.status, 'active'));
    expect(reserved.map((r) => r.qty).sort()).toEqual([1, 2]);
    const events = await db.select().from(s.orderEvents);
    expect(events.map((e) => [e.toStatus, e.actorType])).toEqual([
      ['placed', 'customer'],
      ['placed', 'customer'],
    ]);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'order.placed'))).toBe(1);
  });

  it('the same key returns the same order, even sent twice at once', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const input = {
      userId,
      idempotencyKey: key(2),
      address: address(),
      lines,
      expectedTotalPaise: q.totalPaise,
      note: 'Call before coming',
      locale: 'en' as const,
    };
    const [a, b] = await Promise.all([placeCodOrder(t(), input), placeCodOrder(t(), input)]);
    expect(a.code).toBe(b.code);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect((await placeCodOrder(t(), input)).code).toBe(a.code);
    // The same key for a different request is refused, never answered with the old order.
    await expect(placeCodOrder(t(), { ...input, address: address('492001') })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    await expect(placeCodOrder(t(), { ...input, note: 'Different note' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    expect(
      await db.$count(
        s.orderGroups,
        and(eq(s.orderGroups.userId, userId), eq(s.orderGroups.idempotencyKey, key(2))),
      ),
    ).toBe(1);
  });

  it('refuses a changed price, an over-cap COD order and stock that is no longer there', async () => {
    const before = await db.$count(s.orderGroups);
    const lines = [{ sku: OIL, qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const base = { userId, address: address(), note: null, locale: 'en' as const };
    await expect(
      placeCodOrder(t(), { ...base, idempotencyKey: key(3), lines, expectedTotalPaise: q.totalPaise - 100 }),
    ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });

    const tyres = [{ sku: sku('car-tyre-185-65-r15'), qty: 2 }];
    const tq = await quoteCheckout(t(), { pincode: '492004', lines: tyres, locale: 'en' });
    await expect(
      placeCodOrder(t(), {
        ...base,
        idempotencyKey: key(4),
        lines: tyres,
        expectedTotalPaise: tq.totalPaise,
      }),
    ).rejects.toMatchObject({ code: 'COD_NOT_ALLOWED' });

    // Empty every shelf of the oil: the next placement fails with the line details, nothing is written.
    await db.execute(sql`update shop_inventory set on_hand = reserved
      where variant_id = (select id from product_variants where sku = ${OIL})`);
    await expect(
      placeCodOrder(t(), { ...base, idempotencyKey: key(5), lines, expectedTotalPaise: q.totalPaise }),
    ).rejects.toMatchObject({
      code: 'CHECKOUT_UNAVAILABLE',
      details: { lines: [{ sku: OIL, issue: 'unavailable', available: null }] },
    });
    expect(await db.$count(s.orderGroups)).toBe(before);
  });
});

describe('COD fee (code review 2026-11-03)', () => {
  it('rides on the first sub-order, so the sub-orders add up to what the customer confirmed', async () => {
    await db.insert(s.settings).values({ key: 'checkout.cod_fee_paise', value: 2000 });
    try {
      // The oil's stock is used up by the tests above; these two still come from different shops.
      const lines = [
        { sku: sku('exide-xltz4a-2w-battery'), qty: 1 },
        { sku: sku('scooter-tubeless-tyre-90-90-12'), qty: 1 },
      ];
      const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
      expect(q.ok).toBe(true);
      expect(q.codFeePaise).toBe(2000);
      const placed = await placeCodOrder(t(), {
        userId,
        idempotencyKey: key(90),
        address: address(),
        lines,
        expectedTotalPaise: q.totalPaise,
        note: null,
        locale: 'en',
      });
      const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
      const subs = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.groupId, group!.id))
        .orderBy(s.orders.subNo);
      expect(subs.map((o) => o.codFeePaise)).toEqual([2000, ...subs.slice(1).map(() => 0)]);
      expect(subs.reduce((a, o) => a + o.totalPaise, 0)).toBe(group!.totalPaise);
      expect(placed.orders.reduce((a, o) => a + o.totalPaise, 0)).toBe(placed.totalPaise);
    } finally {
      await db.delete(s.settings).where(eq(s.settings.key, 'checkout.cod_fee_paise'));
    }
  });
});

describe('online payment (Razorpay, plan 2026-11-12)', () => {
  it('the quote also gives the online total: no COD fee', async () => {
    await db.insert(s.settings).values({ key: 'checkout.cod_fee_paise', value: 2000 });
    try {
      const q = await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 1 }], locale: 'en' });
      expect(q.onlineTotalPaise).toBe(q.subtotalPaise + q.shippingPaise);
      expect(q.totalPaise).toBe(q.onlineTotalPaise + 2000);
    } finally {
      await db.delete(s.settings).where(eq(s.settings.key, 'checkout.cod_fee_paise'));
    }
  });

  it('an online order has no COD fee, starts unpaid and holds stock only for the payment window', async () => {
    const lines = [{ sku: sku('exide-xltz4a-2w-battery'), qty: 1 }]; // the oil is used up by earlier tests
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const placed = await placeOrder(t(), {
      method: 'online',
      userId,
      idempotencyKey: key(500),
      address: address(),
      lines,
      expectedTotalPaise: q.onlineTotalPaise,
      note: null,
      locale: 'en',
    });
    expect(placed).toMatchObject({
      paymentMethod: 'online',
      paymentStatus: 'created',
      totalPaise: q.onlineTotalPaise,
    });
    const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
    expect(group).toMatchObject({ paymentMethod: 'online', paymentStatus: 'created', codFeePaise: 0 });
    const [order] = await db.select().from(s.orders).where(eq(s.orders.groupId, group!.id));
    const [hold] = await db.select().from(s.reservations).where(eq(s.reservations.orderId, order!.id));
    const minutes = (hold!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThan(35); // default online window 30 min, not the 24 h COD hold

    // The same key returns the same order (a double tap or a retry), never a second one.
    const again = await placeOrder(t(), {
      method: 'online',
      userId,
      idempotencyKey: key(500),
      address: address(),
      lines,
      expectedTotalPaise: q.onlineTotalPaise,
      note: null,
      locale: 'en',
    });
    expect(again).toMatchObject({ code: placed.code, replayed: true, paymentMethod: 'online' });
    expect(
      await db.$count(
        s.orderGroups,
        and(eq(s.orderGroups.userId, userId), eq(s.orderGroups.idempotencyKey, key(500))),
      ),
    ).toBe(1);
  });
});

describe('business purchase with a GSTIN (plan 2026-11-13 buyer GSTIN)', () => {
  const business = { gstin: '22ABVCS4888H1ZL', businessName: 'Sahu Motors' };
  const place = async (n: number, extra: { business?: typeof business | null } = {}) => {
    // Its own product: earlier tests in this file used up the oil's stock.
    const lines = [{ sku: sku('synthetic-engine-oil-5w30-3-5l'), qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    return {
      input: {
        userId,
        idempotencyKey: key(n),
        address: address(),
        lines,
        expectedTotalPaise: q.totalPaise,
        note: null,
        locale: 'en' as const,
        ...extra,
      },
    };
  };
  const group = async (code: string) =>
    (await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, code)))[0]!;

  it('stores the GSTIN and business name on the order group; without them, nulls', async () => {
    const withBiz = await placeCodOrder(t(), (await place(901, { business })).input);
    expect(await group(withBiz.code)).toMatchObject({
      gstin: '22ABVCS4888H1ZL',
      businessName: 'Sahu Motors',
    });
    const plain = await placeCodOrder(t(), (await place(902)).input);
    expect(await group(plain.code)).toMatchObject({ gstin: null, businessName: null });
  });

  it('the same key with a different GSTIN is a different request, never the old order', async () => {
    const { input } = await place(903, { business });
    await placeCodOrder(t(), input);
    await expect(
      placeCodOrder(t(), { ...input, business: { gstin: '27AAPFU0939F1ZV', businessName: 'Sahu Motors' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
    await expect(placeCodOrder(t(), { ...input, business: null })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
  });

  it('the database refuses a malformed GSTIN or a GSTIN without a business name', async () => {
    const { code } = await placeCodOrder(t(), (await place(904)).input);
    await expect(
      db
        .update(s.orderGroups)
        .set({ gstin: 'BAD', businessName: 'Sahu Motors' })
        .where(eq(s.orderGroups.code, code)),
    ).rejects.toThrow();
    await expect(
      db.update(s.orderGroups).set({ gstin: '22ABVCS4888H1ZL' }).where(eq(s.orderGroups.code, code)),
    ).rejects.toThrow();
  });

  it('the quote names the delivery state by its GST code', async () => {
    const q = await quoteCheckout(t(), { pincode: '492001', lines: [{ sku: OIL, qty: 1 }], locale: 'en' });
    expect(q.deliveryStateCode).toBe('22');
  });
});
