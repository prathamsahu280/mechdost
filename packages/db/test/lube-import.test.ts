/**
 * HP and BPCL MAK imports into the database (user 2026-11-25): old products of the brand that are not in the plan are
 * archived (never deleted), Castrol and every other brand is untouched, each pack is a variant with its net quantity and
 * MRP, the public page hides the data sheet link, and a second run changes nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { events } from '../src/repo/events';
import type { CsvRow } from '../src/battery-import';
import { planBpcl, planHp } from '../src/lube-import';
import { applyBpclImport, applyHpImport, diffHpImport, getCatalogueProduct, type Tx } from '../src/repo';

const row = (r: Record<string, string>): CsvRow => r;
const hp = planHp({
  products: [
    row({
      Product: 'HP RACER SPLENDID 10W-30',
      Range: 'Automotive Oils',
      Category: 'Bike Two Wheeler Engine Oils',
      'Picture file': 'p/a.jpg',
      'Picture note': 'Own photo',
      'Data sheet URL': 'https://example.test/pds.pdf',
    }),
  ],
  grades: [],
});
const bpcl = planBpcl({
  products: [
    row({
      Product: 'MAK ALPHA ZENITH 5W-40',
      Range: 'Automobile lubricants',
      Category: 'Cars and SUVs',
      'Product page': 'https://x/az',
      'Picture file': 'p/b.jpg',
      'Picture note': 'Own photo',
    }),
  ],
  packs: [
    row({ 'Product page': 'https://x/az', 'Pack size': '1 Litre', 'Price (Rs)': '670.0' }),
    row({ 'Product page': 'https://x/az', 'Pack size': '3.5 Litre', 'Price (Rs)': '' }),
  ],
  grades: [],
});

let db: TestDb;
let tx: Tx;
let staff: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-lube-staff' }).returning())[0]?.id ?? '';
  const [lub] = await db
    .insert(s.categories)
    .values({ slug: 'lubricants', name: 'Lubricants', sort: 1 })
    .returning();
  const brandIds: Record<string, string> = {};
  for (const [slug, name] of [
    ['hp', 'HP'],
    ['castrol', 'Castrol'],
  ] as const)
    brandIds[slug] = (await db.insert(s.brands).values({ slug, name }).returning())[0]?.id ?? '';
  for (const [brand, slug] of [
    ['hp', 'hp-old-oil'],
    ['hp', 'hp-racer4-20w40-900ml'],
    ['castrol', 'castrol-keep-oil'],
  ] as const) {
    const [p] = await db
      .insert(s.products)
      .values({
        slug,
        name: slug,
        brandId: brandIds[brand] ?? '',
        categoryId: lub?.id ?? '',
        hsn: '2710',
        gstRateBp: 1800,
        status: 'live',
        hindiMachine: true,
      })
      .returning();
    await db.insert(s.productVariants).values({ productId: p?.id ?? '', sku: `OLD-${slug}`, mrpPaise: 100 });
  }
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  await db.insert(s.cities).values({
    stateId: state?.id ?? '',
    code: 'RPR',
    slug: 'raipur',
    name: 'Raipur',
    status: 'live',
    centroid: { lng: 81.64, lat: 21.227 },
  });
});

const statusOf = async (slug: string) =>
  (await db.select().from(s.products).where(eq(s.products.slug, slug)))[0]?.status;

describe('HP import', () => {
  it('a dry run names the old HP product and writes nothing', async () => {
    const diff = await diffHpImport(tx, hp.products);
    expect(diff.counts).toMatchObject({ productsCreated: 1, productsArchived: 1 });
    expect(diff.archived.map((a) => a.slug)).toEqual(['hp-old-oil']);
    expect(await statusOf('hp-old-oil')).toBe('live');
  });

  it('archives the old HP product only, creates a draft with one price-on-request pack, records one event', async () => {
    const run = await applyHpImport(tx, hp.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({ productsCreated: 1, packsCreated: 1, productsArchived: 1 });
    expect(await statusOf('hp-old-oil')).toBe('archived');
    // User ruling 2026-11-25: the live HP Racer4 (orders, shop inventory) is never archived by the import.
    expect(await statusOf('hp-racer4-20w40-900ml')).toBe('live');
    expect(run.archived.map((a) => a.slug)).toEqual(['hp-old-oil']);
    expect(await statusOf('castrol-keep-oil')).toBe('live');
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'hp-racer-splendid-10w-30'));
    expect(p).toMatchObject({ status: 'live', hsn: '2710' });
    const packs = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, p?.id ?? ''));
    expect(packs.map((v) => [v.mrpPaise, v.netQty, v.netUnit])).toEqual([[null, 1, 'piece']]);
    expect(await db.select().from(events).where(eq(events.event, 'admin_hp_imported'))).toHaveLength(1);
  });

  it('a second run changes nothing', async () => {
    const run = await applyHpImport(tx, hp.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      productsArchived: 0,
      packsCreated: 0,
    });
    expect(run.counts.productsUnchanged).toBe(1);
  });
});

describe('BPCL MAK import', () => {
  it('creates the brand, writes packs with net quantity and MRP, and hides the data sheet link on the public page', async () => {
    const run = await applyBpclImport(tx, bpcl.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({ brandsCreated: 1, productsCreated: 1, packsCreated: 2, mrpSet: 1 });
    const [b] = await db.select().from(s.brands).where(eq(s.brands.slug, 'bpcl-mak'));
    expect(b?.name).toBe('BPCL MAK');
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'bpcl-mak-alpha-zenith-5w-40'));
    const packs = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, p?.id ?? ''));
    const byQty = [...packs].sort((a, b) => (a.netQty ?? 0) - (b.netQty ?? 0));
    expect(byQty.map((v) => [v.options, v.mrpPaise, v.netQty, v.netUnit])).toEqual([
      [{ label: '1 L' }, 67000, 1000, 'ml'],
      [{ label: '3.5 L' }, null, 3500, 'ml'],
    ]);
    const page = await getCatalogueProduct(tx, 'bpcl-mak-alpha-zenith-5w-40', {
      cityCode: 'RPR',
      locale: 'en',
    });
    expect(page.spec).not.toHaveProperty('sourceDocs');
    expect(page.spec).toMatchObject({ grade: '5W-40', saeGrade: '5W40' });
    expect(page.variants.map((v) => v.label).sort()).toEqual(['1 L', '3.5 L']);
    expect(await statusOf('castrol-keep-oil')).toBe('live');
    expect(await db.select().from(events).where(eq(events.event, 'admin_bpcl_imported'))).toHaveLength(1);
  });
});

describe('HP import with researched packs', () => {
  const researched = planHp({
    products: [
      row({
        Product: 'HP RACER PRO 10W 30',
        Range: 'Automotive Oils',
        Category: 'Two Wheeler Engine Oils',
        'Picture file': 'p/c.jpg',
      }),
    ],
    grades: [],
    packsMrp: true,
    packs: [
      row({
        plan_slug: 'hp-racer-pro-10w-30',
        pack_label: '900 ml',
        net_qty: '900',
        net_unit: 'ml',
        mrp_inr: '420',
        sale_price_inr: '390',
        source_url: 'https://example.test/p',
        checked_on: '2026-11-25',
        confidence: 'high',
        status: 'found',
      }),
    ],
  });

  it('writes the researched pack with its MRP and hides the private sources from the public page', async () => {
    const run = await applyHpImport(tx, researched.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({ productsCreated: 1, packsCreated: 1, mrpSet: 1 });
    const page = await getCatalogueProduct(tx, 'hp-racer-pro-10w-30', { cityCode: 'RPR', locale: 'en' });
    expect(page.variants.map((v) => [v.label, v.mrpPaise])).toEqual([['900 ml', 42000]]);
    expect(page.spec).not.toHaveProperty('packSources');
    expect(page.spec).not.toHaveProperty('sourceDocs');
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'hp-racer-pro-10w-30'));
    expect(JSON.stringify(p?.spec)).toContain('https://example.test/p');
  });
});
