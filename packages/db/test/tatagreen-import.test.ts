/**
 * Tata Green import into the database (user 2026-11-24): the 15 generic old products of brand `tata-green` are archived
 * (never deleted), other brands (a Gulf product with "Tata" in its name, Tata Power EZ, Amaron) are untouched, the
 * new rows are live (draft where there is no picture) with pack, part numbers, range, category, the new industrial
 * category is created, the public page hides the offer price, and a second run changes nothing.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { events } from '../src/repo/events';
import { csvRows, planTataGreen, type TataGreenPlan } from '../src/tatagreen';
import { applyTataGreenImport, diffTataGreenImport, getCatalogueProduct, type Tx } from '../src/repo';

const fix = (name: string) =>
  csvRows(readFileSync(new URL(`./fixtures/tatagreen/${name}`, import.meta.url), 'utf8'));
const plan: TataGreenPlan = planTataGreen({
  batteries: fix('tatagreen_batteries.csv'),
  fitment: fix('tatagreen_vehicle_fitment.csv'),
  placeholderPictures: [
    'pictures/Car - SUV - MUV battery/PREMIO/Tata Green PREMIO 55B24L (T1).jpg',
    'pictures/Home UPS inverter/SwitchOn/Tata Green SwitchOn TGUPS2500.jpg',
  ],
});

const OLD_SLUGS = [
  'tata-green-e-rickshaw-li-ion',
  'tata-green-genstar',
  'tata-green-jeevan-series',
  'tata-green-premio-adv-series',
  'tata-green-premio-iss-series',
  'tata-green-premio-series',
  'tata-green-slv-series-slv-series',
  'tata-green-tg-series-tg-series',
  'tata-green-tg-x-series',
  'tata-green-roadstar-series',
  'tata-green-slv-series',
  'tata-green-tg-series',
  'tata-green-switchon-hkva-series',
  'tata-green-switchon-hups-series',
  'tata-green-switchon-tubular-battery-series',
];

let db: TestDb;
let tx: Tx;
let staff: string;
const others: Record<string, string> = {};

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-tata-staff' }).returning())[0]?.id ?? '';
  const [batteries] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', sort: 2 })
    .returning();
  const [er] = await db
    .insert(s.categories)
    .values({ slug: 'e-rickshaw-batteries', name: 'E-rickshaw batteries', parentId: batteries?.id, sort: 1 })
    .returning();
  const brandIds: Record<string, string> = {};
  for (const [slug, name] of [
    ['tata-green', 'Tata Green'],
    ['gulf', 'Gulf'],
    ['tata-power', 'Tata Power'],
    ['amaron', 'Amaron'],
  ] as const)
    brandIds[slug] = (await db.insert(s.brands).values({ slug, name }).returning())[0]?.id ?? '';
  const base = {
    categoryId: batteries?.id ?? '',
    hsn: '8507',
    gstRateBp: 1800,
    status: 'live',
    hindiMachine: true,
  };
  const made = async (brand: string, slug: string, name: string, categoryId?: string) => {
    const [p] = await db
      .insert(s.products)
      .values({
        ...base,
        categoryId: categoryId ?? base.categoryId,
        brandId: brandIds[brand] ?? '',
        slug,
        name,
      })
      .returning();
    await db.insert(s.productVariants).values({ productId: p?.id ?? '', sku: `SKU-${slug}`, mrpPaise: 100 });
    return p?.id ?? '';
  };
  for (const slug of OLD_SLUGS)
    await made('tata-green', slug, slug, slug === 'tata-green-e-rickshaw-li-ion' ? er?.id : undefined);
  others.gulf = await made('gulf', 'gulf-tata-motors-engine-oil', 'Gulf Tata Motors engine oil');
  others.power = await made('tata-power', 'tata-power-ez-charger', 'Tata Power EZ charger');
  others.amaron = await made('amaron', 'amaron-pro-55b24ls', 'Amaron Pro 55B24LS');
});

describe('Tata Green import', () => {
  it('a dry run writes nothing and reports the plan and the 15 products it would archive', async () => {
    const diff = await diffTataGreenImport(tx, plan.products);
    expect(diff.counts.productsCreated).toBe(plan.products.length);
    expect(diff.counts.productsArchived).toBe(15);
    expect(diff.archived.map((x) => x.slug).sort()).toEqual([...OLD_SLUGS].sort());
    expect(
      await db.select().from(s.categories).where(eq(s.categories.slug, 'industrial-batteries')),
    ).toHaveLength(0);
    const old = await db.select().from(s.products).where(inArray(s.products.slug, OLD_SLUGS));
    expect(old.every((p) => p.status === 'live')).toBe(true);
  });

  it('archives the 15 old products with their packs, leaves other brands alone, creates the new rows', async () => {
    const run = await applyTataGreenImport(tx, plan.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: plan.products.length,
      productsArchived: 15,
      brandsCreated: 0,
      categoriesCreated: 7,
    });
    const old = await db.select().from(s.products).where(inArray(s.products.slug, OLD_SLUGS));
    expect(old).toHaveLength(15);
    expect(old.every((p) => p.status === 'archived')).toBe(true);
    const oldPacks = await db
      .select()
      .from(s.productVariants)
      .where(
        inArray(
          s.productVariants.productId,
          old.map((p) => p.id),
        ),
      );
    expect(oldPacks.every((v) => v.status === 'archived')).toBe(true);
    const audits = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.entityId, old[0]?.id ?? ''));
    expect(audits.every((a) => (a.after as { source?: string }).source === 'tatagreen_import')).toBe(true);
    // Gulf (with "Tata" in its name), Tata Power and Amaron: untouched.
    for (const id of Object.values(others)) {
      const [p] = await db.select().from(s.products).where(eq(s.products.id, id));
      expect(p?.status).toBe('live');
      expect(p?.version).toBe(1);
    }
    // New rows: live, or draft where the plan has no picture.
    const rows = await db
      .select()
      .from(s.products)
      .where(
        inArray(
          s.products.slug,
          plan.products.map((p) => p.slug),
        ),
      );
    expect(rows).toHaveLength(plan.products.length);
    for (const r of rows) {
      const planned = plan.products.find((p) => p.slug === r.slug);
      expect(r.status).toBe(planned?.status);
      expect(r.rangeId).not.toBeNull();
      expect(r.hindiMachine).toBe(true);
    }
    expect(rows.filter((r) => r.status === 'draft').length).toBe(3);
    // The new industrial category sits under batteries; the existing e-rickshaw category is reused.
    const [industrial] = await db
      .select()
      .from(s.categories)
      .where(eq(s.categories.slug, 'industrial-batteries'));
    expect(industrial).toMatchObject({ name: 'Industrial batteries', nameHi: 'औद्योगिक बैटरी' });
    expect(industrial?.parentId).not.toBeNull();
    expect(
      await db.select().from(s.categories).where(eq(s.categories.slug, 'e-rickshaw-batteries')),
    ).toHaveLength(1);
    // Part numbers: the model, and the bare code of the co-branded one.
    const [msil] = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.sku, 'TATAGREEN-PREMIO-34B19L-M-MSIL-CO-BRANDED'));
    const parts = await db
      .select()
      .from(s.partNumbers)
      .where(eq(s.partNumbers.variantId, msil?.id ?? ''));
    expect(parts.map((p) => p.normalised).sort()).toEqual(['34B19LM', '34B19LMMSILCOBRANDED']);
    expect(msil?.mrpPaise).toBe(473300);
  });

  it('the public page shows the MRP and no Tata Green offer price, fitment or category rule', async () => {
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
    const page = await getCatalogueProduct(tx, 'tata-green-premio-40b20l-pr2436', {
      cityCode: 'RPR',
      locale: 'en',
    });
    for (const key of ['tataGreenPrice', 'fitment', 'categoryRule'])
      expect(page.spec).not.toHaveProperty(key);
    expect(page.spec).toMatchObject({ source: 'tatagreen', model: '40B20L PR2436' });
    expect(page.variants[0]?.mrpPaise).toBe(482200);
    const tg = await getCatalogueProduct(tx, 'tata-green-tg350l', { cityCode: 'RPR', locale: 'en' });
    expect(tg.spec).not.toHaveProperty('categoryRule');
  });

  it('records the import event once', async () => {
    const rows = await db.select().from(events).where(eq(events.event, 'admin_tatagreen_imported'));
    expect(rows).toHaveLength(1);
  });

  it('a second run changes nothing', async () => {
    const [before] = await db
      .select()
      .from(s.products)
      .where(eq(s.products.slug, 'tata-green-premio-40b20l-pr2436'));
    const run = await applyTataGreenImport(tx, plan.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      productsArchived: 0,
      packsCreated: 0,
      mrpSet: 0,
      variantsArchived: 0,
      categoriesCreated: 0,
      rangesCreated: 0,
    });
    expect(run.counts.productsUnchanged).toBe(plan.products.length);
    const [after] = await db
      .select()
      .from(s.products)
      .where(eq(s.products.slug, 'tata-green-premio-40b20l-pr2436'));
    expect(after?.version).toBe(before?.version);
  });
});
