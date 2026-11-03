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
import { placeCodOrder, quoteCheckout, type ShippingAddress, type Tx } from '../src/repo';
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
