/**
 * Demo catalogue seed: idempotent (twice = same rows, reservations kept), served by the catalogue reads in English
 * and Hindi, and removable before launch (Q21).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { removeRaipurDemo, seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { getCatalogueProduct, listCatalogue, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});

afterAll(async () => {
  await client.close();
});

describe('Raipur demo seed', () => {
  it('gives heavy-vehicle demo products their segments and bikes theirs from the vehicle types (design 2026-11-25)', async () => {
    await seedRaipurDemo(t(), fixture);
    const page = await listCatalogue(t(), { cityCode: 'RPR', locale: 'en', segments: ['truck_bus'] });
    expect(page.items.map((i) => i.slug)).toContain('mrf-steel-muscle-1000r20-truck-tyre');
    const byCode = Object.fromEntries(page.facets.segments.map((f) => [f.code, f.count]));
    expect(byCode.tractor_farm).toBeGreaterThanOrEqual(2);
    expect(byCode.construction_otr).toBeGreaterThanOrEqual(1);
    expect(byCode.two_wheeler).toBeGreaterThanOrEqual(1);
    // A second seed keeps what staff set and does not duplicate rows.
    await seedRaipurDemo(t(), fixture);
    expect(await db.$count(s.productVehicleSegments)).toBeGreaterThan(0);
  });

  it('loads once, and a second run changes nothing but keeps reservations', async () => {
    const first = await seedRaipurDemo(t(), fixture);
    expect(first.products).toBe(fixture.products.length);
    const counts = async () => ({
      products: await db.$count(s.products),
      shops: await db.$count(s.shops),
      inventory: await db.$count(s.shopInventory),
      coverage: await db.$count(s.shopPincodes),
    });
    const before = await counts();
    expect(before).toEqual({
      products: fixture.products.length,
      shops: fixture.shops.length,
      inventory: fixture.offers.length,
      coverage: fixture.shops.length * fixture.pincodes.length,
    });
    const [row] = await db.select().from(s.shopInventory).where(eq(s.shopInventory.onHand, 2)).limit(1);
    await db.update(s.shopInventory).set({ reserved: 2 }).where(eq(s.shopInventory.id, row!.id));
    await db.update(s.shopInventory).set({ onHand: 2 }).where(eq(s.shopInventory.id, row!.id));
    await seedRaipurDemo(t(), { ...fixture, offers: fixture.offers.map((o) => ({ ...o, onHand: 0 })) });
    expect(await counts()).toEqual(before);
    const [kept] = await db.select().from(s.shopInventory).where(eq(s.shopInventory.id, row!.id));
    expect(kept).toMatchObject({ reserved: 2, onHand: 2 }); // never below reserved
    await seedRaipurDemo(t(), fixture); // restore stock
  });

  it('is served by the catalogue in Hindi with nearest-shop prices', async () => {
    const page = await listCatalogue(t(), { cityCode: 'RPR', pincode: '492001', locale: 'hi', limit: 48 });
    expect(page.items).toHaveLength(fixture.products.length);
    const tyre = page.items.find((i) => i.slug === 'scooter-tubeless-tyre-90-90-12');
    expect(tyre).toMatchObject({ name: 'ट्यूबलेस स्कूटर टायर 90/90-12', category: { name: 'टायर' } });
    expect(tyre?.offer?.shippingPaise).toBe(4000);
    // "On request" products are listed without a price.
    expect(page.items.find((i) => i.slug === 'heavy-duty-battery-90ah')?.offer).toBeNull();
    const oil = await getCatalogueProduct(t(), 'castrol-activ-4t-20w40-900ml', {
      cityCode: 'RPR',
      pincode: '492099',
      locale: 'hi',
    });
    // Sarona/Tatibandh PIN → Gupta Lubes & Spares is the nearest shop selling lubricants.
    expect(oil.variants[0]?.offer?.seller).toBe('गुप्ता ल्यूब्स एंड स्पेयर्स');
  });

  it('writes typed attributes and the pack size for comparison (design 2026-11-13)', async () => {
    const withCompare: DemoFixture = {
      ...fixture,
      products: fixture.products.map((p) =>
        p.slug === 'castrol-activ-4t-20w40-900ml'
          ? {
              ...p,
              attributes: { saeGrade: '20W40', jasoClass: 'MA2' },
              netQuantity: { qty: 900, unit: 'ml' },
            }
          : p,
      ),
    };
    await seedRaipurDemo(t(), withCompare);
    const oil = await getCatalogueProduct(t(), 'castrol-activ-4t-20w40-900ml', {
      cityCode: 'RPR',
      pincode: '492099',
      locale: 'en',
    });
    expect(oil.attributes).toEqual({ saeGrade: '20W40', jasoClass: 'MA2' });
    expect(oil.variants[0]?.netQuantity).toEqual({ qty: 900, unit: 'ml' });
    expect(oil.variants[0]?.offer?.netQuantity).toEqual({ qty: 900, unit: 'ml' });
  });

  it('can be removed again before launch', async () => {
    await removeRaipurDemo(t(), fixture);
    expect(await db.$count(s.products)).toBe(0);
    expect(await db.$count(s.shops)).toBe(0);
  });
});
