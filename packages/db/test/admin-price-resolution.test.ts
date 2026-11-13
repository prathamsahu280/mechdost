/**
 * Admin prices drive what the customer pays (design 2026-11-13, Q26): PIN override > city price > the shop's own
 * price; only shops paid at or below that price are chosen (catalogue, checkout and routing alike); orders keep
 * both prices so the margin is recorded (Q11). Demo seed: Castrol Activ 4T 900 ml at several Raipur shops.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  getPriceBoard,
  listCatalogue,
  placeCodOrder,
  quoteCheckout,
  rankShopsForOrder,
  setAdminPrice,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const SLUG = 'castrol-activ-4t-20w40-900ml';
const SKU = 'CAS-ACT4T-0900';
const PIN = '492004';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let customer = '';
let n = 0;

const card = async () =>
  (await listCatalogue(t(), { cityCode: 'RPR', pincode: PIN, locale: 'en', limit: 48 })).items.find(
    (i) => i.slug === SLUG,
  );
const pinRow = async () =>
  (await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' })).variants[0]!.pins.find(
    (p) => p.pincode === PIN,
  )!;

async function placeOne() {
  const lines = [{ sku: SKU, qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: PIN, lines, locale: 'en' });
  n += 1;
  const placed = await placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: `admin-price-${String(n).padStart(8, '0')}`,
    address: {
      contactName: 'Ravi',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: PIN,
    },
    lines,
    expectedTotalPaise: q.totalPaise,
    note: null,
    locale: 'en',
  });
  const code = placed.orders[0]!.code;
  const [order] = await db.select().from(s.orders).where(eq(s.orders.code, code));
  const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, order!.id));
  return { order: order!, item: item!, quote: q };
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-resolve-staff' }).returning())[0]!.id;
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-resolve-customer' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('customer price resolution', () => {
  it('without admin prices the customer pays the nearest shop’s price (interim default, Q83)', async () => {
    const pin = await pinRow();
    expect((await card())?.offer?.pricePaise).toBe(pin.nearestShopPaise);
  });

  it('a city price is what the customer pays; the order keeps the customer and the shop price (margin)', async () => {
    const pin = await pinRow();
    const cityPrice = pin.highestShopPaise!;
    await setAdminPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: null,
      pricePaise: cityPrice,
      expectedVersion: null,
      staffUserId: staff,
    });
    expect((await card())?.offer?.pricePaise).toBe(cityPrice);
    const { item, quote } = await placeOne();
    expect(quote.lines[0]!.unitPaise).toBe(cityPrice);
    expect(item.unitPaise).toBe(cityPrice);
    expect(item.shopUnitPaise).not.toBeNull();
    expect(item.shopUnitPaise!).toBeLessThanOrEqual(cityPrice);

    // Raising the city price later never changes a placed order (snapshot, Review Focus 2).
    const v = (await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' })).variants[0]!.city!.version;
    await setAdminPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: null,
      pricePaise: Math.min(cityPrice + 500, 47_500),
      expectedVersion: v,
      staffUserId: staff,
    });
    const [again] = await db.select().from(s.orderItems).where(eq(s.orderItems.id, item.id));
    expect(again!.unitPaise).toBe(cityPrice);
  });

  it('a PIN override beats the city price, and only shops paid at or below it are chosen', async () => {
    const pin = await pinRow();
    await setAdminPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: PIN,
      pricePaise: pin.lowestShopPaise!,
      expectedVersion: null,
      staffUserId: staff,
    });
    expect((await card())?.offer?.pricePaise).toBe(pin.lowestShopPaise);
    const { item } = await placeOne();
    expect(item.unitPaise).toBe(pin.lowestShopPaise);
    expect(item.shopUnitPaise).toBe(pin.lowestShopPaise);
  });

  it('a shop that raises its price above the customer price stops being chosen; none left → on request', async () => {
    const pin = await pinRow();
    const price = pin.override!.pricePaise;
    // Every shop selling the pack at this PIN raises its approved price above the override.
    const [variant] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, SKU));
    await db
      .update(s.shopInventory)
      .set({ sellingPaise: price + 100 })
      .where(
        and(eq(s.shopInventory.variantId, variant!.id), sql`${s.shopInventory.sellingPaise} <= ${price}`),
      );
    expect((await card())?.offer).toBeNull();
    const q = await quoteCheckout(t(), { pincode: PIN, lines: [{ sku: SKU, qty: 1 }], locale: 'en' });
    expect(q.lines[0]!.unitPaise).toBeNull();
  });
});

describe('routing', () => {
  it('a shop paid more than the customer pays for an item is not eligible', async () => {
    // Fresh state: drop the PIN override, keep the city price, restore one cheap listing.
    await db.delete(s.adminPrices).where(sql`${s.adminPrices.pincode} is not null`);
    const { order, item } = await placeOne();
    const ranked = await rankShopsForOrder(t(), order.id, 'en');
    const eligible = ranked.filter((r) => r.eligible);
    expect(eligible.length).toBeGreaterThan(0);
    const [variant] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, SKU));
    await db
      .update(s.shopInventory)
      .set({ sellingPaise: item.unitPaise + 1 })
      .where(eq(s.shopInventory.variantId, variant!.id));
    expect((await rankShopsForOrder(t(), order.id, 'en')).filter((r) => r.eligible)).toHaveLength(0);
  });
});
