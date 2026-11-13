/**
 * Product comparison data (design 2026-11-13): typed net quantity per pack, typed attributes per category in
 * `products.spec`, and the catalogue offer carrying the net quantity of the very pack it prices.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  ConflictError,
  getAdminProduct,
  getCatalogueProduct,
  listCatalogue,
  NotFoundError,
  setProductAttributes,
  setVariantNetQuantity,
  ValidationError,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  F.state = (
    await db.insert(s.states).values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' }).returning()
  )[0]!.id;
  F.raipur = (
    await db
      .insert(s.cities)
      .values({
        stateId: F.state,
        code: 'RPR',
        slug: 'raipur',
        name: 'Raipur',
        status: 'live',
        centroid: { lng: 81.64, lat: 21.227 },
      })
      .returning()
  )[0]!.id;
  await db
    .insert(s.pincodes)
    .values({ pincode: '492001', stateId: F.state, cityId: F.raipur, centroid: { lng: 81.64, lat: 21.227 } });
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-compare-staff' }).returning())[0]!.id;
  F.lubricants = (
    await db.insert(s.categories).values({ slug: 'lubricants', name: 'Lubricants', sort: 1 }).returning()
  )[0]!.id;
  F.castrol = (await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning())[0]!.id;
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Near Auto',
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: F.raipur,
      stateId: F.state,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  F.shop = shop!.id;
  await db.insert(s.shopPincodes).values({ shopId: F.shop, pincode: '492001', shippingPaise: 4000 });
  const [p] = await db
    .insert(s.products)
    .values({
      slug: 'castrol-activ',
      name: 'Activ 4T 20W40',
      brandId: F.castrol,
      categoryId: F.lubricants,
      hsn: '2710',
      gstRateBp: 1800,
      status: 'live',
    })
    .returning();
  F.product = p!.id;
  const [small] = await db
    .insert(s.productVariants)
    .values({ productId: F.product, sku: 'CAS-0900', mrpPaise: 47_500, netQty: 900, netUnit: 'ml' })
    .returning();
  const [big] = await db
    .insert(s.productVariants)
    .values({ productId: F.product, sku: 'CAS-1000', mrpPaise: 52_000, netQty: 1000, netUnit: 'ml' })
    .returning();
  // Only the 1 L pack is on a shelf: the offer must carry 1000 ml, not the first variant's 900 ml.
  await db.insert(s.shopInventory).values([
    { shopId: F.shop, variantId: small!.id, sellingPaise: 44_000, onHand: 0 },
    { shopId: F.shop, variantId: big!.id, sellingPaise: 49_000, onHand: 5 },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('database checks', () => {
  const variant = (extra: Record<string, unknown>) =>
    db
      .insert(s.productVariants)
      .values({ productId: F.product!, sku: `X-${Math.random()}`, mrpPaise: 1, ...extra });

  it('refuses an unknown unit, a quantity without a unit and a zero quantity', async () => {
    await expect(variant({ netQty: 1, netUnit: 'l' })).rejects.toThrow();
    await expect(variant({ netQty: 900 })).rejects.toThrow();
    await expect(variant({ netUnit: 'ml' })).rejects.toThrow();
    await expect(variant({ netQty: 0, netUnit: 'ml' })).rejects.toThrow();
  });

  it('keeps products.spec an object', async () => {
    await expect(
      db.execute(sql`update products set spec = '[]'::jsonb where id = ${F.product!}`),
    ).rejects.toThrow();
  });
});

describe('setProductAttributes', () => {
  it('saves valid attributes for the category, bumps the version and audits', async () => {
    const before = await getAdminProduct(t(), 'castrol-activ');
    const r = await setProductAttributes(t(), {
      slug: 'castrol-activ',
      expectedVersion: before.version,
      attributes: { saeGrade: '20W40', apiClass: 'SL', jasoClass: 'MA2', baseType: 'mineral' },
      staffUserId: F.staff!,
    });
    expect(r.version).toBeGreaterThan(before.version);
    expect(r.attributes).toEqual({
      saeGrade: '20W40',
      apiClass: 'SL',
      jasoClass: 'MA2',
      baseType: 'mineral',
    });
    const [row] = await db
      .select({ spec: s.products.spec })
      .from(s.products)
      .where(eq(s.products.id, F.product!));
    expect(row!.spec).toEqual(r.attributes);
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'product.attributes_updated'));
    expect(audit.at(-1)).toMatchObject({ before: { attributes: {} }, after: { attributes: r.attributes } });
  });

  it('refuses a bad value and a stale version', async () => {
    const p = await getAdminProduct(t(), 'castrol-activ');
    await expect(
      setProductAttributes(t(), {
        slug: 'castrol-activ',
        expectedVersion: p.version,
        attributes: { saeGrade: '99W99' },
        staffUserId: F.staff!,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setProductAttributes(t(), {
        slug: 'castrol-activ',
        expectedVersion: p.version - 1,
        attributes: { saeGrade: '10W30' },
        staffUserId: F.staff!,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('setVariantNetQuantity', () => {
  it('sets and clears a pack size, and 404s an unknown SKU', async () => {
    expect(
      await setVariantNetQuantity(t(), {
        sku: 'CAS-0900',
        netQuantity: { qty: 950, unit: 'ml' },
        staffUserId: F.staff!,
      }),
    ).toEqual({ sku: 'CAS-0900', netQuantity: { qty: 950, unit: 'ml' } });
    expect(
      await setVariantNetQuantity(t(), { sku: 'CAS-0900', netQuantity: null, staffUserId: F.staff! }),
    ).toEqual({ sku: 'CAS-0900', netQuantity: null });
    await setVariantNetQuantity(t(), {
      sku: 'CAS-0900',
      netQuantity: { qty: 900, unit: 'ml' },
      staffUserId: F.staff!,
    });
    await expect(
      setVariantNetQuantity(t(), { sku: 'NOPE', netQuantity: null, staffUserId: F.staff! }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setVariantNetQuantity(t(), {
        sku: 'CAS-0900',
        netQuantity: { qty: 1, unit: 'l' } as never,
        staffUserId: F.staff!,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('catalogue reads carry the pack of the offer', () => {
  it('lists the offered pack (1 L in stock), not the first variant', async () => {
    const page = await listCatalogue(t(), { cityCode: 'RPR', pincode: '492001', locale: 'en' });
    const card = page.items.find((c) => c.slug === 'castrol-activ');
    expect(card?.offer).toMatchObject({ pricePaise: 49_000, netQuantity: { qty: 1000, unit: 'ml' } });
  });

  it('returns typed attributes and each variant pack on the product', async () => {
    const p = await getCatalogueProduct(t(), 'castrol-activ', {
      cityCode: 'RPR',
      pincode: '492001',
      locale: 'en',
    });
    expect(p.attributeSet).toBe('lubricants');
    expect(p.attributes).toMatchObject({ saeGrade: '20W40' });
    expect(p.variants.map((v) => v.netQuantity)).toEqual(
      expect.arrayContaining([
        { qty: 900, unit: 'ml' },
        { qty: 1000, unit: 'ml' },
      ]),
    );
  });
});
