/**
 * Catalogue reads (spec 02 acceptance tests): the PIN price is the nearest covering shop with stock (decision
 * 2026-11-01, Q26 default), never a paused/suspended/busy shop or an empty shelf; city-wide "From ₹" is the
 * lowest offer; typo, Hindi and part-number search; drafts never appear; keyset pages stay stable under inserts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { getCatalogueProduct, listCatalogue, listCatalogueCategories, type Tx } from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};

async function shop(name: string, lng: number, status: 'approved' | 'paused' = 'approved', busy = false) {
  const [row] = await db
    .insert(s.shops)
    .values({
      name,
      nameHi: `${name} (हिं)`,
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: F.raipur!,
      stateId: F.state!,
      location: { lng, lat: 21.227 },
      status,
      busy,
      ...(status === 'paused' ? { statusReason: 'Stock audit', statusChangedBy: F.staff! } : {}),
    })
    .returning();
  await db.insert(s.shopPincodes).values({ shopId: row!.id, pincode: '492001', shippingPaise: 4000 });
  return row!.id;
}

async function product(slug: string, extra: Partial<typeof s.products.$inferInsert> = {}) {
  const [p] = await db
    .insert(s.products)
    .values({
      slug,
      name: slug,
      brandId: F.exide!,
      categoryId: F.batteries!,
      hsn: '8507',
      gstRateBp: 1800,
      status: 'live',
      ...extra,
    })
    .returning();
  const [v] = await db
    .insert(s.productVariants)
    .values({ productId: p!.id, sku: `SKU-${slug.toUpperCase()}`, mrpPaise: 150000 })
    .returning();
  return { productId: p!.id, variantId: v!.id };
}

async function offer(shopId: string, variantId: string, sellingPaise: number, onHand = 5) {
  await db.insert(s.shopInventory).values({ shopId, variantId, sellingPaise, onHand });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  F.state = state!.id;
  const city = async (code: string, slug: string) =>
    (
      await db
        .insert(s.cities)
        .values({
          stateId: F.state!,
          code,
          slug,
          name: slug,
          status: 'live',
          centroid: { lng: 81.64, lat: 21.227 },
        })
        .returning()
    )[0]!.id;
  F.raipur = await city('RPR', 'raipur');
  F.bilaspur = await city('BLS', 'bilaspur');
  await db.insert(s.pincodes).values([
    { pincode: '492001', stateId: F.state, cityId: F.raipur, centroid: { lng: 81.64, lat: 21.227 } },
    { pincode: '495001', stateId: F.state, cityId: F.bilaspur, centroid: { lng: 82.15, lat: 22.08 } },
  ]);
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-catalogue-staff' }).returning())[0]!.id;

  const [batteries] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', nameHi: 'बैटरी', sort: 1 })
    .returning();
  F.batteries = batteries!.id;
  F.twoWheelerBatteries = (
    await db
      .insert(s.categories)
      .values({ slug: 'two-wheeler-batteries', name: '2W batteries', parentId: F.batteries, sort: 2 })
      .returning()
  )[0]!.id;
  F.lubricants = (
    await db.insert(s.categories).values({ slug: 'lubricants', name: 'Lubricants', sort: 3 }).returning()
  )[0]!.id;
  await db.insert(s.categories).values({ slug: 'hidden-stuff', name: 'Hidden', hidden: true });
  F.exide = (await db.insert(s.brands).values({ slug: 'exide', name: 'Exide' }).returning())[0]!.id;
  F.castrol = (await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning())[0]!.id;

  F.near = await shop('Near Auto', 81.641);
  F.far = await shop('Far Auto', 81.75);
  F.paused = await shop('Paused Auto', 81.64, 'paused');
  F.busy = await shop('Busy Auto', 81.6405, 'approved', true);

  const exide = await product('exide-xltz4a', {
    name: 'Exide Xplore XLTZ4A battery',
    nameHi: 'Exide Xplore XLTZ4A बैटरी',
    specSummary: '12 V · 3 Ah',
    specSummaryHi: '12 V · 3 Ah',
    highlights: ['Maintenance free'],
    highlightsHi: ['रखरखाव-मुक्त'],
  });
  F.exideVariant = exide.variantId;
  await db
    .insert(s.partNumbers)
    .values({ variantId: exide.variantId, kind: 'mfr', value: 'XLTZ-4A', normalised: 'XLTZ4A' });
  await offer(F.near, exide.variantId, 110000);
  await offer(F.far, exide.variantId, 95000);
  await offer(F.paused, exide.variantId, 80000);
  await offer(F.busy, exide.variantId, 85000);

  const castrol = await product('castrol-activ', {
    name: 'Castrol Activ 4T 20W-40 engine oil',
    nameHi: 'Castrol Activ 4T 20W-40 इंजन ऑयल',
    brandId: F.castrol,
    categoryId: F.lubricants,
  });
  await offer(F.near, castrol.variantId, 44000, 0); // empty shelf: not buyable

  await product('amaron-2w', { name: 'Amaron 2W battery', categoryId: F.twoWheelerBatteries });
  await product('draft-battery', { name: 'Draft battery', status: 'draft' });
});

afterAll(async () => {
  await client.close();
});

const base = { cityCode: 'RPR', locale: 'en' } as const;

describe('prices', () => {
  it('a PIN gets the nearest covering shop with stock, not the cheapest one', async () => {
    const page = await listCatalogue(t(), { ...base, pincode: '492001', q: 'XLTZ4A' });
    const exide = page.items.find((i) => i.slug === 'exide-xltz4a');
    // Busy Auto is nearer but busy; Paused Auto is cheapest but paused; Far Auto is cheaper but farther.
    expect(exide?.offer).toEqual({ pricePaise: 110000, mrpPaise: 150000, shippingPaise: 4000, leadDays: 2 });
    expect(page.place).toEqual({ cityId: F.raipur, cityCode: 'RPR', pincode: '492001', pincodeKnown: true });
  });

  it('without a PIN, "From ₹" is the lowest buyable offer in the city', async () => {
    const page = await listCatalogue(t(), base);
    expect(page.items.find((i) => i.slug === 'exide-xltz4a')?.offer?.pricePaise).toBe(95000);
    expect(page.items.find((i) => i.slug === 'castrol-activ')?.offer).toBeNull(); // no free stock
  });

  it('an unknown PIN or another city has no offers', async () => {
    const unknown = await listCatalogue(t(), { ...base, pincode: '110001' });
    expect(unknown.place.pincodeKnown).toBe(false);
    expect(unknown.items.every((i) => i.offer === null)).toBe(true);
    const bilaspur = await listCatalogue(t(), { ...base, pincode: '495001' });
    expect(bilaspur.place.cityCode).toBe('BLS');
    expect(bilaspur.items.every((i) => i.offer === null)).toBe(true);
  });

  it('"available only" keeps buyable products', async () => {
    const page = await listCatalogue(t(), { ...base, availableOnly: true });
    expect(page.items.map((i) => i.slug)).toEqual(['exide-xltz4a']);
  });
});

describe('search and filters', () => {
  it('finds typos, Hindi words and part numbers; drafts never appear', async () => {
    const slugs = async (q: string, locale: 'en' | 'hi' = 'en') =>
      (await listCatalogue(t(), { ...base, q, locale })).items.map((i) => i.slug);
    expect(await slugs('castrl')).toContain('castrol-activ');
    expect(await slugs('engine oil')).toEqual(['castrol-activ']);
    expect(await slugs('बैटरी', 'hi')).toContain('exide-xltz4a');
    expect(await slugs('xltz-4a')).toEqual(['exide-xltz4a']);
    expect(await slugs('battery')).not.toContain('draft-battery');
  });

  it('a category includes its children; brand filter; Hindi fields with English fallback', async () => {
    const batteries = await listCatalogue(t(), { ...base, category: 'batteries', locale: 'hi' });
    expect(batteries.items.map((i) => i.slug).sort()).toEqual(['amaron-2w', 'exide-xltz4a']);
    const exide = batteries.items.find((i) => i.slug === 'exide-xltz4a');
    expect(exide).toMatchObject({
      name: 'Exide Xplore XLTZ4A बैटरी',
      highlights: ['रखरखाव-मुक्त'],
      category: { slug: 'batteries', name: 'बैटरी' },
    });
    expect(batteries.items.find((i) => i.slug === 'amaron-2w')?.name).toBe('Amaron 2W battery'); // fallback
    const castrol = await listCatalogue(t(), { ...base, brand: 'castrol' });
    expect(castrol.items.map((i) => i.slug)).toEqual(['castrol-activ']);
  });

  it('categories: visible ones in order with live counts', async () => {
    const cats = await listCatalogueCategories(t(), 'hi');
    expect(cats.map((c) => c.slug)).toEqual(['batteries', 'two-wheeler-batteries', 'lubricants']);
    expect(cats[0]).toMatchObject({ name: 'बैटरी', liveProducts: 1 });
    expect(cats[1]).toMatchObject({ parentSlug: 'batteries', liveProducts: 1 });
  });
});

describe('pagination', () => {
  it('keyset pages stay stable while new products are added', async () => {
    for (let i = 0; i < 4; i += 1) await product(`page-${String(i)}`, { categoryId: F.lubricants });
    const first = await listCatalogue(t(), { ...base, category: 'lubricants', limit: 2 });
    await product('page-new', { categoryId: F.lubricants }); // newer than everything: lands before page 1
    const seen = [...first.items.map((i) => i.slug)];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await listCatalogue(t(), { ...base, category: 'lubricants', limit: 2, cursor });
      seen.push(...next.items.map((i) => i.slug));
      cursor = next.nextCursor;
    }
    expect(seen).toEqual(['page-3', 'page-2', 'page-1', 'page-0', 'castrol-activ']);
  });

  it('price order puts unpriced products last, page after page', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next = await listCatalogue(t(), {
        ...base,
        category: 'batteries',
        sort: 'price_asc',
        limit: 1,
        cursor,
      });
      seen.push(...next.items.map((i) => i.slug));
      cursor = next.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['exide-xltz4a', 'amaron-2w']);
  });

  it('a tampered cursor is rejected', async () => {
    await expect(listCatalogue(t(), { ...base, cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    const forged = Buffer.from(JSON.stringify({ k: "x'); drop table products; --", id: 'nope' })).toString(
      'base64url',
    );
    await expect(listCatalogue(t(), { ...base, cursor: forged })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });
});

describe('product page', () => {
  it('shows each variant’s offer with the seller; drafts and unknown slugs are 404', async () => {
    const page = await getCatalogueProduct(t(), 'exide-xltz4a', { ...base, pincode: '492001', locale: 'hi' });
    expect(page).toMatchObject({
      name: 'Exide Xplore XLTZ4A बैटरी',
      gstRateBp: 1800,
      partNumbers: [{ kind: 'mfr', value: 'XLTZ-4A' }],
      variants: [{ sku: 'SKU-EXIDE-XLTZ4A', offer: { pricePaise: 110000, seller: 'Near Auto (हिं)' } }],
    });
    await expect(getCatalogueProduct(t(), 'draft-battery', base)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getCatalogueProduct(t(), 'nope', base)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pausing the nearest shop moves the PIN price to the next nearest', async () => {
    await db
      .update(s.shops)
      .set({ status: 'paused', statusReason: 'Holiday audit', statusChangedBy: F.staff })
      .where(eq(s.shops.id, F.near!));
    const page = await getCatalogueProduct(t(), 'exide-xltz4a', { ...base, pincode: '492001', locale: 'en' });
    expect(page.variants[0]?.offer).toMatchObject({ pricePaise: 95000, seller: 'Far Auto' });
  });
});

describe('vehicle types (decision 2026-11-12: fitment by type until Q76)', () => {
  it('cards and pages carry the tags; a vehicle filter keeps only tagged products', async () => {
    await product('auto-brake-shoe-3w', { vehicleTypes: ['3W'] });
    await product('tyre-gauge-all', { vehicleTypes: ['2W', '3W', '4W'] });
    const threeWheelers = await listCatalogue(t(), { ...base, vehicleType: '3W' });
    expect(threeWheelers.items.map((i) => i.slug).sort()).toEqual(['auto-brake-shoe-3w', 'tyre-gauge-all']);
    expect(threeWheelers.items.find((i) => i.slug === 'tyre-gauge-all')?.vehicleTypes).toEqual([
      '2W',
      '3W',
      '4W',
    ]);
    const all = await listCatalogue(t(), base);
    expect(all.items.find((i) => i.slug === 'castrol-activ')?.vehicleTypes).toEqual([]);
    const page = await getCatalogueProduct(t(), 'auto-brake-shoe-3w', base);
    expect(page.vehicleTypes).toEqual(['3W']);
  });

  it('the database refuses codes that are not vehicle types', async () => {
    await expect(product('ev-tagged', { vehicleTypes: ['EV'] })).rejects.toThrow();
  });
});

describe('shops that are never used for prices (design 2026-11-13)', () => {
  it('a shop with only a GST enrolment number, and a listing staff blocked, are never priced', async () => {
    const page = () => getCatalogueProduct(t(), 'exide-xltz4a', { ...base, pincode: '492001', locale: 'en' });
    const before = (await page()).variants[0]?.offer?.seller;
    expect(before).toBeTruthy();
    const [nearest] = await db.select().from(s.shops).where(eq(s.shops.name, before!));
    await db.update(s.shops).set({ gstStatus: 'enrolled' }).where(eq(s.shops.id, nearest!.id));
    expect((await page()).variants[0]?.offer?.seller).not.toBe(before);
    await db.update(s.shops).set({ gstStatus: 'registered' }).where(eq(s.shops.id, nearest!.id));
    // Blocked by staff but switched back on by hand: still never priced.
    await db
      .update(s.shopInventory)
      .set({ adminBlocked: true, blockedReasonCode: 'above_market', active: true })
      .where(eq(s.shopInventory.shopId, nearest!.id));
    expect((await page()).variants[0]?.offer?.seller).not.toBe(before);
    await db
      .update(s.shopInventory)
      .set({ adminBlocked: false, blockedReasonCode: null })
      .where(eq(s.shopInventory.shopId, nearest!.id));
    expect((await page()).variants[0]?.offer?.seller).toBe(before);
  });
});
