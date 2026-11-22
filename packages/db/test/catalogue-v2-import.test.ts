/**
 * Catalogue-v2 import into the database (design 2026-11-22): idempotent, never deletes, never overwrites the admin's
 * work (MRPs, edited products, hidden brands), dry run writes nothing. PGlite, same migrations as production.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  emptyReport,
  newPlanState,
  planSection,
  SECTIONS,
  type PlannedProduct,
  type Section,
  type SourceProduct,
} from '../src/catalogue-v2';
import {
  applyCatalogueImport,
  diffCatalogueImport,
  lastImportRun,
  recordImportRun,
  summariseStatus,
  productsWithoutPhoto,
  updateProductTexts,
  type Tx,
} from '../src/repo';

type Fixture = Record<Section, SourceProduct[]> & { img: never[] };
const fx = JSON.parse(
  readFileSync(new URL('./fixtures/catalogue-v2.json', import.meta.url), 'utf8'),
) as Fixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff: string;
let plan: PlannedProduct[];

function makePlan(): PlannedProduct[] {
  const report = emptyReport();
  const state = newPlanState();
  return SECTIONS.flatMap((section) =>
    planSection({ section, products: fx[section], images: fx.img }, report, state),
  );
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-import-staff' }).returning())[0]!.id;
  await db.insert(s.categories).values([
    { slug: 'lubricants', name: 'Lubricants', sort: 1 },
    { slug: 'batteries', name: 'Batteries', sort: 2 },
    { slug: 'tyres', name: 'Tyres', sort: 3 },
    { slug: 'filters', name: 'Filters', sort: 4 },
    { slug: 'accessories', name: 'Accessories', sort: 5 },
    { slug: 'ev-essentials', name: 'EV essentials', sort: 6 },
  ]);
  plan = makePlan();
});
afterAll(async () => {
  await client.close();
});

const total = async () => ({
  products: (await db.select({ n: sql<number>`count(*)::int` }).from(s.products))[0]!.n,
  variants: (await db.select({ n: sql<number>`count(*)::int` }).from(s.productVariants))[0]!.n,
  brands: (await db.select({ n: sql<number>`count(*)::int` }).from(s.brands))[0]!.n,
  ranges: (await db.select({ n: sql<number>`count(*)::int` }).from(s.productRanges))[0]!.n,
  categories: (await db.select({ n: sql<number>`count(*)::int` }).from(s.categories))[0]!.n,
});

describe('catalogue-v2 import', () => {
  it('dry run reports what would be created and writes nothing', async () => {
    const before = await total();
    const diff = await diffCatalogueImport(t(), plan);
    expect(diff.productsCreated).toBe(plan.length);
    expect(diff.packsCreated).toBe(plan.reduce((n, p) => n + p.packs.length, 0));
    expect(diff.brandsCreated).toBeGreaterThan(5);
    expect(await total()).toEqual(before);
  });

  it('creates categories, brands, ranges, products and packs with typed values', async () => {
    const counts = await applyCatalogueImport(t(), plan, { staffUserId: staff, batchSize: 4 });
    expect(counts.productsCreated).toBe(plan.length);
    expect(counts.slugsRenamed).toBe(0);
    const [castrol] = await db
      .select()
      .from(s.products)
      .where(eq(s.products.slug, plan.find((p) => p.brand.slug === 'castrol')!.slug));
    expect(castrol).toMatchObject({ status: 'live', hindiMachine: true, hsn: '2710', gstRateBp: 1800 });
    expect(castrol?.spec).toMatchObject({ saeGrade: '10W30' });
    expect(castrol?.rangeId).not.toBeNull();
    expect(castrol?.vehicleTypes).toEqual(['2W']);
    const noMrp = await db
      .select()
      .from(s.productVariants)
      .where(sql`${s.productVariants.mrpPaise} is null`);
    expect(noMrp.length).toBeGreaterThan(0);
    const sub = await db.select().from(s.categories).where(eq(s.categories.slug, 'motorcycle-oil'));
    expect(sub[0]?.parentId).not.toBeNull();
    expect(sub[0]?.nameHi).toBe('मोटरसाइकिल ऑयल');
    const draft = await db.select().from(s.products).where(eq(s.products.status, 'draft'));
    expect(draft.some((p) => p.slug.includes('powerzone'))).toBe(true);
  });

  it('a second run changes nothing (no duplicates, no writes)', async () => {
    const before = await total();
    const diff = await diffCatalogueImport(t(), plan);
    expect(diff).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      packsCreated: 0,
      mrpFilled: 0,
      packsUpdated: 0,
    });
    const counts = await applyCatalogueImport(t(), plan, { staffUserId: staff });
    expect(counts).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      packsCreated: 0,
      mrpFilled: 0,
      brandsCreated: 0,
      rangesCreated: 0,
      categoriesCreated: 0,
    });
    expect(counts.productsUnchanged).toBe(plan.length);
    expect(await total()).toEqual(before);
  });

  it('never deletes: a product missing from a later plan stays', async () => {
    const before = await total();
    await applyCatalogueImport(t(), plan.slice(0, 3), { staffUserId: staff });
    expect(await total()).toEqual(before);
  });

  it('changed source text updates a machine-made product; an admin-edited one is left alone', async () => {
    const [a, b] = plan.filter((p) => p.status === 'live' && p.description !== null);
    const next = plan.map((p) =>
      p === a || p === b ? { ...p, description: `${p.description ?? ''} Updated.` } : p,
    );
    // The admin fixes the Hindi name of `b`.
    const row = (await db.select().from(s.products).where(eq(s.products.slug, b!.slug)))[0]!;
    await updateProductTexts(t(), {
      slug: b!.slug,
      expectedVersion: row.version,
      patch: { nameHi: 'सुधारा हुआ नाम' },
      staffUserId: staff,
    });
    const counts = await applyCatalogueImport(t(), next, { staffUserId: staff });
    expect(counts.productsUpdated).toBe(1);
    const [ra] = await db.select().from(s.products).where(eq(s.products.slug, a!.slug));
    const [rb] = await db.select().from(s.products).where(eq(s.products.slug, b!.slug));
    expect(ra?.description).toContain('Updated.');
    expect(rb?.description).not.toContain('Updated.');
    expect(rb).toMatchObject({ nameHi: 'सुधारा हुआ नाम', hindiMachine: false });
  });

  it('fills an MRP only where the pack has none; the admin MRP is never overwritten', async () => {
    const withGap = plan.find(
      (p) => p.packs.some((k) => k.mrpPaise === null) && p.packs.some((k) => k.mrpPaise !== null),
    )!;
    const gap = withGap.packs.find((k) => k.mrpPaise === null)!;
    const priced = withGap.packs.find((k) => k.mrpPaise !== null)!;
    await db.update(s.productVariants).set({ mrpPaise: 99_900 }).where(eq(s.productVariants.sku, priced.sku));
    const next = plan.map((p) =>
      p === withGap
        ? {
            ...p,
            packs: p.packs.map((k) =>
              k === gap ? { ...k, mrpPaise: 12_300 } : k === priced ? { ...k, mrpPaise: 55_500 } : k,
            ),
          }
        : p,
    );
    const counts = await applyCatalogueImport(t(), next, { staffUserId: staff });
    expect(counts.mrpFilled).toBe(1);
    const rows = await db
      .select()
      .from(s.productVariants)
      .where(inArray(s.productVariants.sku, [gap.sku, priced.sku]));
    expect(rows.find((r) => r.sku === gap.sku)?.mrpPaise).toBe(12_300);
    expect(rows.find((r) => r.sku === priced.sku)?.mrpPaise).toBe(99_900);
  });

  it('a hidden brand stays hidden across a re-run', async () => {
    await db
      .update(s.brands)
      .set({ hidden: true, hiddenReason: 'supplier_issue' })
      .where(eq(s.brands.slug, 'castrol'));
    await applyCatalogueImport(t(), plan, { staffUserId: staff });
    const [b] = await db.select().from(s.brands).where(eq(s.brands.slug, 'castrol'));
    expect(b).toMatchObject({ hidden: true, hiddenReason: 'supplier_issue' });
    await db.update(s.brands).set({ hidden: false, hiddenReason: null }).where(eq(s.brands.slug, 'castrol'));
  });

  it('a slug taken by another product gets a -cv2 slug instead of overwriting it', async () => {
    const victim = plan[plan.length - 1]!;
    const taken = {
      ...victim,
      slug: 'my-own-product',
      packs: victim.packs.map((k) => ({ ...k, sku: `NEW-${k.sku}`.slice(0, 64) })),
    };
    const [brand] = await db.select().from(s.brands).limit(1);
    const [cat] = await db.select().from(s.categories).limit(1);
    await db.insert(s.products).values({
      slug: 'my-own-product',
      name: 'Mine',
      brandId: brand!.id,
      categoryId: cat!.id,
      hsn: '8507',
      gstRateBp: 1800,
      status: 'live',
    });
    const counts = await applyCatalogueImport(t(), [taken], { staffUserId: staff });
    expect(counts.slugsRenamed).toBe(1);
    const [mine] = await db.select().from(s.products).where(eq(s.products.slug, 'my-own-product'));
    expect(mine?.name).toBe('Mine');
    expect((await db.select().from(s.products).where(eq(s.products.slug, 'my-own-product-cv2'))).length).toBe(
      1,
    );
  });

  it('keeps the summary of a real run for the admin panel', async () => {
    expect(await lastImportRun(t())).toBeNull();
    const summary = summariseStatus(
      [
        { brand: 'Castrol', status: 'imported', reason: '' },
        { brand: 'Castrol', status: 'skipped', reason: 'no_picture_bytes' },
        { brand: 'Motul', status: 'skipped', reason: 'not_price_list_brand' },
      ],
      new Date('2026-11-22T10:00:00Z'),
    );
    expect(summary.brands.Castrol).toEqual({ imported: 1, updated: 0, unchanged: 0, skipped: 1 });
    expect(summary.reasons).toEqual({ no_picture_bytes: 1, not_price_list_brand: 1 });
    await recordImportRun(t(), staff, summary);
    expect(await lastImportRun(t())).toMatchObject({ totals: { products: 3, imported: 1, skipped: 2 } });
  });

  it('classifies each product in the dry run (unchanged after an import)', async () => {
    const diff = await diffCatalogueImport(t(), plan);
    expect(diff.classes.size).toBe(plan.length);
    expect([...diff.classes.values()].every((c) => c === 'unchanged' || c === 'updated')).toBe(true);
  });

  it('a re-run with reviewed Hindi replaces what the importer wrote (names, highlights, ranges), never the admin edits', async () => {
    const ranged = plan.filter((p) => p.range !== null && p.status === 'live');
    const distinct = [...new Set(ranged.map((p) => p.range?.slug ?? ''))].slice(0, 2);
    const [kept, changed] = distinct as [string, string];
    // The admin renamed one range in Hindi after the first import.
    await db.update(s.productRanges).set({ nameHi: 'एडमिन का नाम' }).where(eq(s.productRanges.slug, kept));
    const next = plan.map((p) => ({
      ...p,
      nameHi: `${p.nameHi} समीक्षित`,
      highlightsHi: p.highlightsHi.map((h) => `${h} समीक्षित`),
      range: p.range ? { ...p.range, nameHi: 'नई श्रेणी' } : null,
    }));
    await applyCatalogueImport(t(), next, { staffUserId: staff });
    const ranges = await db.select().from(s.productRanges).where(inArray(s.productRanges.slug, distinct));
    expect(ranges.find((r) => r.slug === kept)?.nameHi).toBe('एडमिन का नाम');
    expect(ranges.find((r) => r.slug === changed)?.nameHi).toBe('नई श्रेणी');
    const rows = await db
      .select()
      .from(s.products)
      .where(
        and(
          eq(s.products.hindiMachine, true),
          inArray(
            s.products.slug,
            plan.map((p) => p.slug),
          ),
        ),
      );
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.nameHi?.endsWith('समीक्षित')).toBe(true);
      expect(row.highlightsHi.every((h) => h.endsWith('समीक्षित'))).toBe(true);
    }
  });

  it('writes an audit row per created product and lists products without a photo', async () => {
    const created = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'product.created'), eq(s.auditLog.entity, 'product')));
    expect(created.length).toBeGreaterThanOrEqual(plan.length);
    const missing = await productsWithoutPhoto(t(), plan);
    expect(missing.length).toBe(plan.filter((p) => p.photo !== null).length);
  });
});
