/**
 * Apollo import into the database (user 2026-11-24): old products of brand `apollo` and brand `vredestein` are archived
 * (never deleted), every other brand is untouched, the industrial sub-category is created, one product per pattern holds
 * every size with its EAN barcode, the public page hides the per-size private data, and a second run changes nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { events } from '../src/repo/events';
import { csvRows } from '../src/battery-import';
import { planApollo } from '../src/apollo';
import { applyApolloImport, diffApolloImport, getCatalogueProduct, type Tx } from '../src/repo';

const HEADER =
  'Tyre,Brand,Product type,Pattern,Size,MRP incl. taxes (Rs),EAN barcode,SKU (shop),Tubeless / tube type,source,Pattern page,Shop page,Picture files';
const PAGE = 'https://www.apollotyres.com/en-in/x/';
const plan = planApollo({
  tyres: csvRows(`${HEADER}
Apollo ALNAC 4G 185/55 R16 TL,Apollo,Car / SUV / van tyre,ALNAC 4G,185/55 R16,6340.0,8904156005372,RLGCH0AL43AH1,TL (tubeless),Product page + shop,${PAGE},https://shop.apollotyres.com/a,pictures/Car/ALNAC 4G/Apollo ALNAC 4G - 1.jpg
Apollo ALNAC 4G 185/60 R14 TL,Apollo,Car / SUV / van tyre,ALNAC 4G,185/60 R14,,,,TL (tubeless),Product page,${PAGE},,pictures/Car/ALNAC 4G/Apollo ALNAC 4G - 1.jpg
Apollo SL HD 6.50-10,Apollo,Industrial tyre,SL HD,6.50-10,,,,,Product page,${PAGE},,pictures/Industrial/SL HD/Apollo SL HD - 1.jpg
Vredestein Ultrac 205/65 R16,Vredestein,Car / SUV / van tyre,Ultrac,205/65 R16,12000.0,,RL11P0ULT0VW1,,Shop only,,https://shop.apollotyres.com/v,`),
  brochure: [],
  fitment: [],
});

let db: TestDb;
let tx: Tx;
let staff: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-apollo-staff' }).returning())[0]?.id ?? '';
  const [tyres] = await db.insert(s.categories).values({ slug: 'tyres', name: 'Tyres', sort: 3 }).returning();
  const brandIds: Record<string, string> = {};
  for (const [slug, name] of [
    ['apollo', 'Apollo'],
    ['vredestein', 'Vredestein'],
    ['ceat', 'CEAT'],
  ] as const)
    brandIds[slug] = (await db.insert(s.brands).values({ slug, name }).returning())[0]?.id ?? '';
  for (const [brand, slug] of [
    ['apollo', 'apollo-old-tyre'],
    ['vredestein', 'vredestein-old-tyre'],
    ['ceat', 'ceat-keep-tyre'],
  ] as const) {
    const [p] = await db
      .insert(s.products)
      .values({
        slug,
        name: slug,
        brandId: brandIds[brand] ?? '',
        categoryId: tyres?.id ?? '',
        hsn: '4011',
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

describe('Apollo import', () => {
  it('plans two products (Vredestein dropped) and a dry run names the old Apollo and Vredestein products', async () => {
    expect(plan.products.map((p) => p.slug)).toEqual(['apollo-alnac-4g', 'apollo-sl-hd']);
    const diff = await diffApolloImport(tx, plan.products);
    expect(diff.counts).toMatchObject({ productsCreated: 2, packsCreated: 3, productsArchived: 2 });
    expect(diff.archived.map((a) => a.slug).sort()).toEqual(['apollo-old-tyre', 'vredestein-old-tyre']);
  });

  it('archives old apollo and vredestein products, never another brand; creates industrial-tyres; writes barcodes', async () => {
    const run = await applyApolloImport(tx, plan.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({ productsCreated: 2, packsCreated: 3, productsArchived: 2 });
    expect(await statusOf('apollo-old-tyre')).toBe('archived');
    expect(await statusOf('vredestein-old-tyre')).toBe('archived');
    expect(await statusOf('ceat-keep-tyre')).toBe('live');
    const [cat] = await db.select().from(s.categories).where(eq(s.categories.slug, 'industrial-tyres'));
    expect(cat).toMatchObject({ name: 'Industrial tyres', nameHi: 'इंडस्ट्रियल टायर' });
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'apollo-alnac-4g'));
    const packs = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, p?.id ?? ''));
    expect(packs.map((v) => [v.sku, v.barcode, v.mrpPaise]).sort()).toEqual([
      ['APOLLO-ALNAC-4G-185-60-R14-TL', null, null],
      ['APOLLO-RLGCH0AL43AH1', '8904156005372', 634000],
    ]);
  });

  it('the public page lists the sizes and hides the per-size private data', async () => {
    const page = await getCatalogueProduct(tx, 'apollo-alnac-4g', { cityCode: 'RPR', locale: 'en' });
    expect(page.variants).toHaveLength(2);
    expect(page.spec).not.toHaveProperty('variantSpecs');
  });

  it('records one event and a second run changes nothing', async () => {
    expect(await db.select().from(events).where(eq(events.event, 'admin_apollo_imported'))).toHaveLength(1);
    const run = await applyApolloImport(tx, plan.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      productsArchived: 0,
      packsCreated: 0,
      categoriesCreated: 0,
      variantsArchived: 0,
    });
    expect(run.counts.productsUnchanged).toBe(2);
  });
});
