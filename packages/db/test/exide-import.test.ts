/**
 * Exide import into the database (user 2026-11-23): old Exide products are archived (never deleted), other brands are
 * untouched, new rows are live with pack, part number, range and category, and a second run changes nothing.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { csvRows, planExide, type ExidePlan } from '../src/exide';
import { applyExideImport, diffExideImport, type Tx } from '../src/repo';

const fix = (name: string) =>
  csvRows(readFileSync(new URL(`./fixtures/exide/${name}`, import.meta.url), 'utf8'));
const plan: ExidePlan = planExide({
  batteries: fix('exide_batteries.csv'),
  fitment: fix('exide_vehicle_fitment.csv'),
});

let db: TestDb;
let tx: Tx;
let staff: string;
let oldSameSlug: string;
let oldOther: string;
let otherBrand: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-exide-staff' }).returning())[0]?.id ?? '';
  const [batteries] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', sort: 2 })
    .returning();
  const [exide] = await db.insert(s.brands).values({ slug: 'exide', name: 'Exide' }).returning();
  const [tata] = await db.insert(s.brands).values({ slug: 'tata-green', name: 'Tata Green' }).returning();
  const base = {
    categoryId: batteries?.id ?? '',
    hsn: '8507',
    gstRateBp: 1800,
    status: 'live',
    hindiMachine: true,
  };
  // An old catalogue-v2 row with the same slug as a planned one, an old one that is not in the plan, another brand's.
  const [a] = await db
    .insert(s.products)
    .values({
      ...base,
      brandId: exide?.id ?? '',
      slug: 'exide-mileage-ml55d23l',
      name: 'EXIDE MILEAGE ML55D23L',
    })
    .returning();
  const [b] = await db
    .insert(s.products)
    .values({
      ...base,
      brandId: exide?.id ?? '',
      slug: 'exide-old-generic-battery',
      name: 'Exide generic battery',
    })
    .returning();
  const [c] = await db
    .insert(s.products)
    .values({ ...base, brandId: tata?.id ?? '', slug: 'tata-green-battery', name: 'Tata Green battery' })
    .returning();
  oldSameSlug = a?.id ?? '';
  oldOther = b?.id ?? '';
  otherBrand = c?.id ?? '';
  await db.insert(s.productVariants).values([
    { productId: oldSameSlug, sku: 'EXIDE-MILEAGE-ML55D23L-STD', mrpPaise: 1 },
    { productId: oldOther, sku: 'EXIDE-GENERIC-1' },
    { productId: otherBrand, sku: 'TATA-GREEN-1' },
  ]);
});

describe('Exide import', () => {
  it('a dry run writes nothing and reports the plan', async () => {
    const diff = await diffExideImport(tx, plan.products);
    expect(diff.counts.productsCreated).toBe(plan.products.length - 1);
    expect(diff.counts.productsArchived).toBe(1);
    expect(diff.archived.map((a) => a.slug)).toEqual(['exide-old-generic-battery']);
    const [row] = await db.select().from(s.products).where(eq(s.products.id, oldOther));
    expect(row?.status).toBe('live');
  });

  it('archives old Exide products, leaves other brands alone, creates the new rows live', async () => {
    const run = await applyExideImport(tx, plan.products, { staffUserId: staff });
    expect(run.counts.productsArchived).toBe(1);
    // Archived, not deleted; its pack archived too.
    const [old] = await db.select().from(s.products).where(eq(s.products.id, oldOther));
    expect(old?.status).toBe('archived');
    const oldPack = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, oldOther));
    expect(oldPack.map((v) => v.status)).toEqual(['archived']);
    // Another brand: untouched.
    const [other] = await db.select().from(s.products).where(eq(s.products.id, otherBrand));
    expect(other?.status).toBe('live');
    expect(other?.version).toBe(1);
    // The old row with the planned slug is replaced in place (same id), its old pack archived.
    const [same] = await db.select().from(s.products).where(eq(s.products.id, oldSameSlug));
    expect(same?.name).toBe('Exide Mileage ML55D23L');
    expect(same?.status).toBe('live');
    const sameVariants = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, oldSameSlug));
    expect(sameVariants.find((v) => v.sku === 'EXIDE-MILEAGE-ML55D23L-STD')?.status).toBe('archived');
    expect(sameVariants.find((v) => v.sku === 'EXIDE-ML55D23L')).toMatchObject({
      status: 'active',
      mrpPaise: 878700,
    });
    // Every planned product is live with a pack, a part number, a range and a category.
    const slugs = plan.products.map((p) => p.slug);
    const live = await db.select().from(s.products).where(inArray(s.products.slug, slugs));
    expect(live).toHaveLength(plan.products.length);
    expect(live.every((p) => p.status === 'live' && p.rangeId !== null && p.hindiMachine)).toBe(true);
    const skus = await db
      .select()
      .from(s.productVariants)
      .where(
        inArray(
          s.productVariants.sku,
          plan.products.map((p) => p.variant.sku),
        ),
      );
    expect(skus).toHaveLength(plan.products.length);
    const parts = await db
      .select()
      .from(s.partNumbers)
      .where(
        inArray(
          s.partNumbers.variantId,
          skus.map((v) => v.id),
        ),
      );
    expect(parts).toHaveLength(plan.products.length);
    const homePower = await db.select().from(s.categories).where(eq(s.categories.slug, 'home-power'));
    expect(homePower[0]).toMatchObject({ parentId: null, nameHi: 'इन्वर्टर और होम UPS' });
    const sub = await db.select().from(s.categories).where(eq(s.categories.slug, 'car-suv-batteries'));
    expect(sub[0]?.parentId).not.toBeNull();
    // Audit rows for the archive.
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, oldOther));
    expect(audits.some((a) => a.action === 'product.status_changed')).toBe(true);
  });

  it('a second run changes nothing', async () => {
    const [before] = await db.select().from(s.products).where(eq(s.products.id, oldSameSlug));
    const run = await applyExideImport(tx, plan.products, { staffUserId: staff });
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
    const [after] = await db.select().from(s.products).where(eq(s.products.id, oldSameSlug));
    expect(after?.version).toBe(before?.version);
  });

  it('keeps the texts of a product staff edited after the import, and an MRP staff set', async () => {
    const target = plan.products[1];
    if (!target) throw new Error('no plan');
    await db
      .update(s.products)
      .set({ hindiMachine: false, name: 'Staff edited name' })
      .where(eq(s.products.slug, target.slug));
    await db
      .update(s.productVariants)
      .set({ mrpPaise: 12345 })
      .where(eq(s.productVariants.sku, target.variant.sku));
    await applyExideImport(tx, plan.products, { staffUserId: staff });
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, target.slug));
    expect(row?.name).toBe('Staff edited name');
    const [v] = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.sku, target.variant.sku));
    expect(v?.mrpPaise).toBe(12345);
  });
});
