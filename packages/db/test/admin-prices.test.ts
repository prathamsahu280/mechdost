/**
 * Admin customer prices (plan 2026-11-13, design admin-catalogue-pin-prices): the price board (current city price,
 * PIN overrides and shop suggestions per PIN) and the save rules (never above MRP, never below what a shop is
 * paid, compare-and-set, audited). Demo seed data: Castrol Activ 4T 900 ml, MRP ₹475.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  clearPinPrice,
  ConflictError,
  getPriceBoard,
  NotFoundError,
  setAdminPrice,
  ValidationError,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const SLUG = 'castrol-activ-4t-20w40-900ml';
const SKU = 'CAS-ACT4T-0900';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-prices-staff' }).returning())[0]!.id;
  // A Raipur PIN no shop delivers to (for the NO_SHOP rule).
  const [rpr] = await db.select().from(s.cities).where(eq(s.cities.code, 'RPR'));
  await db.insert(s.pincodes).values({
    pincode: '492015',
    stateId: rpr!.stateId,
    cityId: rpr!.id,
    centroid: { lng: 81.7, lat: 21.2 },
  });
});

afterAll(async () => {
  await client.close();
});

describe('price board', () => {
  it('shows MRP, no admin prices yet, and nearest/lowest/highest shop prices for every covered PIN', async () => {
    const board = await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' });
    expect(board.variants).toHaveLength(1);
    const v = board.variants[0]!;
    expect(v).toMatchObject({ sku: SKU, mrpPaise: 47_500, city: null });
    expect(v.pins.length).toBeGreaterThan(0);
    expect(v.pins.map((p) => p.pincode)).not.toContain('492015');
    for (const p of v.pins) {
      expect(p.override).toBeNull();
      expect(p.lowestShopPaise).not.toBeNull();
      expect(p.lowestShopPaise!).toBeLessThanOrEqual(p.nearestShopPaise!);
      expect(p.nearestShopPaise!).toBeLessThanOrEqual(p.highestShopPaise!);
    }
  });

  it('404s an unknown product or city', async () => {
    await expect(getPriceBoard(t(), { productSlug: 'nope', cityCode: 'RPR' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getPriceBoard(t(), { productSlug: SLUG, cityCode: 'XXX' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('setting prices', () => {
  const lowest = async () =>
    Math.min(
      ...(await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' })).variants[0]!.pins.map(
        (p) => p.lowestShopPaise!,
      ),
    );

  it('sets the city price, then updates it with the version; a second create is stale', async () => {
    const low = await lowest();
    const first = await setAdminPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: null,
      pricePaise: low,
      expectedVersion: null,
      staffUserId: staff,
    });
    await expect(
      setAdminPrice(t(), {
        sku: SKU,
        cityCode: 'RPR',
        pincode: null,
        pricePaise: low,
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PRICE' });
    const second = await setAdminPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: null,
      pricePaise: 47_000,
      expectedVersion: first.version,
      staffUserId: staff,
    });
    expect(second.version).toBe(first.version + 1);
    const board = await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' });
    expect(board.variants[0]!.city).toEqual({ pricePaise: 47_000, version: second.version });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'price.set'));
    expect(audit.at(-1)).toMatchObject({ before: { pricePaise: low }, after: { pricePaise: 47_000 } });
  });

  it('refuses above MRP, below what the cheapest shop is paid, an uncovered PIN and another city’s PIN', async () => {
    const pin = (await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' })).variants[0]!.pins[0]!;
    const save = (pincode: string | null, pricePaise: number) =>
      setAdminPrice(t(), {
        sku: SKU,
        cityCode: 'RPR',
        pincode,
        pricePaise,
        expectedVersion: null,
        staffUserId: staff,
      });
    await expect(save(pin.pincode, 47_501)).rejects.toMatchObject({ code: 'MRP_EXCEEDED' });
    await expect(save(pin.pincode, pin.lowestShopPaise! - 1)).rejects.toMatchObject({
      code: 'BELOW_SHOP_PRICE',
    });
    await expect(save('492015', 46_000)).rejects.toMatchObject({ code: 'NO_SHOP' });
    await expect(save('999999', 46_000)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setAdminPrice(t(), {
        sku: 'NO-SUCH-SKU',
        cityCode: 'RPR',
        pincode: null,
        pricePaise: 46_000,
        expectedVersion: null,
        staffUserId: staff,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a PIN override shows on the board and can be cleared with its version (stale clear refused)', async () => {
    const pin = (await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' })).variants[0]!.pins[0]!;
    const set = await setAdminPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: pin.pincode,
      pricePaise: pin.highestShopPaise!,
      expectedVersion: null,
      staffUserId: staff,
    });
    const board = await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' });
    expect(board.variants[0]!.pins.find((p) => p.pincode === pin.pincode)!.override).toEqual({
      pricePaise: pin.highestShopPaise!,
      version: set.version,
    });
    await expect(
      clearPinPrice(t(), {
        sku: SKU,
        cityCode: 'RPR',
        pincode: pin.pincode,
        expectedVersion: set.version + 5,
        staffUserId: staff,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await clearPinPrice(t(), {
      sku: SKU,
      cityCode: 'RPR',
      pincode: pin.pincode,
      expectedVersion: set.version,
      staffUserId: staff,
    });
    const after = await getPriceBoard(t(), { productSlug: SLUG, cityCode: 'RPR' });
    expect(after.variants[0]!.pins.find((p) => p.pincode === pin.pincode)!.override).toBeNull();
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'price.cleared'))).toBe(1);
  });

  it('the database keeps one city price per pack and positive prices', async () => {
    const [v] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, SKU));
    const [rpr] = await db.select().from(s.cities).where(eq(s.cities.code, 'RPR'));
    await expect(
      db
        .insert(s.adminPrices)
        .values({ variantId: v!.id, cityId: rpr!.id, sellingPaise: 45_000, updatedBy: staff }),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update admin_prices set selling_paise = 0 where variant_id = ${v!.id}`),
    ).rejects.toThrow();
  });
});
