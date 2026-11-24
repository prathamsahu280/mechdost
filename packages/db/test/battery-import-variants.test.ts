/**
 * The import writer takes N variants per planned product (user 2026-11-24: one product per tread pattern, each size a
 * variant): a two-size product creates two packs with barcodes and part numbers, a re-run changes nothing, a size that
 * leaves the plan is archived alone, a SKU owned by another brand stops the import, a null MRP stays null and an MRP
 * staff already set is not lowered.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { mfrPart, type PlannedProduct, type PlannedVariant } from '../src/battery-import';
import { applyBatteryImport, diffBatteryImport, type BatteryImportConfig, type Tx } from '../src/repo';

const CFG: BatteryImportConfig = {
  brand: { slug: 'ceat', name: 'CEAT' },
  specSource: 'ceat',
  auditSource: 'ceat_import',
  event: 'admin_ceat_imported',
};

const variant = (sku: string, size: string, mrpPaise: number | null, ean: string | null): PlannedVariant => ({
  sku,
  model: size,
  mrpPaise,
  weightG: null,
  netQuantity: { qty: 1, unit: 'piece' },
  options: { size },
  barcode: ean,
  partNumbers: [mfrPart(sku)],
});

const product = (slug: string, variants: PlannedVariant[]): PlannedProduct => {
  const first = variants[0];
  if (!first) throw new Error('a product needs a variant');
  return {
    sourceRow: 1,
    productType: 'car_suv_tyre',
    slug,
    range: { slug: `${slug}-range`, name: slug, nameHi: slug },
    category: {
      slug: 'car-suv-tyres',
      parent: 'tyres',
      name: 'Car and SUV tyres',
      nameHi: 'कार और SUV टायर',
    },
    name: slug,
    nameHi: slug,
    description: 'd',
    descriptionHi: 'd',
    specSummary: '',
    specSummaryHi: '',
    compatibility: null,
    compatibilityHi: null,
    highlights: [],
    highlightsHi: [],
    vehicleTypes: ['4W'],
    spec: { source: 'ceat' },
    warranty: null,
    hsn: '4011',
    gstRateBp: 1800,
    status: 'live',
    variant: first,
    variants,
    partNumbers: first.partNumbers,
    partNumber: first.partNumbers[0] ?? mfrPart('X'),
    photos: [],
    photo: null,
    fitmentCount: 0,
  };
};

let db: TestDb;
let tx: Tx;
let staff: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-variants-staff' }).returning())[0]?.id ?? '';
  await db.insert(s.categories).values({ slug: 'tyres', name: 'Tyres', sort: 3 });
  await db.insert(s.brands).values({ slug: 'other', name: 'Other' });
});

const variantsOf = async (slug: string) => {
  const [p] = await db.select().from(s.products).where(eq(s.products.slug, slug));
  if (!p) return [];
  return db.select().from(s.productVariants).where(eq(s.productVariants.productId, p.id));
};

describe('writer with several variants per product', () => {
  const two = product('ceat-milaze-x3', [
    variant('CEAT-1', '145/70R12 69T TL', 290000, '8901234567890'),
    variant('CEAT-2', '155/70R12 73T TL', null, null),
  ]);

  it('creates one product with two packs, their barcodes, null MRP and part numbers', async () => {
    const diff = await diffBatteryImport(tx, CFG, [two]);
    expect(diff.counts.productsCreated).toBe(1);
    expect(diff.counts.packsCreated).toBe(2);
    expect(await variantsOf('ceat-milaze-x3')).toHaveLength(0);

    const res = await applyBatteryImport(tx, CFG, [two], { staffUserId: staff });
    expect(res.counts.productsCreated).toBe(1);
    expect(res.counts.packsCreated).toBe(2);
    expect(res.counts.mrpSet).toBe(1);
    const vs = await variantsOf('ceat-milaze-x3');
    expect(vs.map((v) => [v.sku, v.barcode, v.mrpPaise, v.options])).toEqual(
      expect.arrayContaining([
        ['CEAT-1', '8901234567890', 290000, { size: '145/70R12 69T TL' }],
        ['CEAT-2', null, null, { size: '155/70R12 73T TL' }],
      ]),
    );
    const parts = await db.select().from(s.partNumbers);
    expect(parts.map((p) => p.normalised).sort()).toEqual(['CEAT1', 'CEAT2']);
    expect(new Set(parts.map((p) => p.variantId)).size).toBe(2);
  });

  it('a re-run changes nothing', async () => {
    const res = await applyBatteryImport(tx, CFG, [two], { staffUserId: staff });
    expect(res.counts).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      productsUnchanged: 1,
      packsCreated: 0,
      variantsArchived: 0,
    });
    expect(res.results.get('ceat-milaze-x3')).toBe('unchanged');
  });

  it('writes a barcode that was missing and keeps an MRP staff set above the import (never lowers it)', async () => {
    const [v2] = (await variantsOf('ceat-milaze-x3')).filter((v) => v.sku === 'CEAT-2');
    await db
      .update(s.productVariants)
      .set({ mrpPaise: 400000 })
      .where(eq(s.productVariants.id, v2?.id ?? ''));
    const withEan = product('ceat-milaze-x3', [
      variant('CEAT-1', '145/70R12 69T TL', 290000, '8901234567890'),
      variant('CEAT-2', '155/70R12 73T TL', 310000, '8901234567891'),
    ]);
    const res = await applyBatteryImport(tx, CFG, [withEan], { staffUserId: staff });
    expect(res.results.get('ceat-milaze-x3')).toBe('updated');
    const after = (await variantsOf('ceat-milaze-x3')).find((v) => v.sku === 'CEAT-2');
    expect(after?.barcode).toBe('8901234567891');
    expect(after?.mrpPaise).toBe(400000);
  });

  it('a size that leaves the plan is archived alone; the other size stays active', async () => {
    const one = product('ceat-milaze-x3', [variant('CEAT-1', '145/70R12 69T TL', 290000, '8901234567890')]);
    const res = await applyBatteryImport(tx, CFG, [one], { staffUserId: staff });
    expect(res.counts.variantsArchived).toBe(1);
    const vs = await variantsOf('ceat-milaze-x3');
    expect(vs.find((v) => v.sku === 'CEAT-1')?.status).toBe('active');
    expect(vs.find((v) => v.sku === 'CEAT-2')?.status).toBe('archived');
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'ceat-milaze-x3'));
    expect(p?.status).toBe('live');
  });

  it('a SKU that belongs to another brand stops the import and moves nothing', async () => {
    const [other] = await db.select().from(s.brands).where(eq(s.brands.slug, 'other'));
    const [cat] = await db.select().from(s.categories).where(eq(s.categories.slug, 'tyres'));
    const [foreign] = await db
      .insert(s.products)
      .values({
        slug: 'other-tyre',
        name: 'Other tyre',
        brandId: other?.id ?? '',
        categoryId: cat?.id ?? '',
        hsn: '4011',
        gstRateBp: 1800,
        status: 'live',
      })
      .returning();
    await db.insert(s.productVariants).values({ productId: foreign?.id ?? '', sku: 'CEAT-9', mrpPaise: 100 });
    const clash = product('ceat-clash', [
      variant('CEAT-8', '90/90-10', 100, null),
      variant('CEAT-9', '100/90-10', 100, null),
    ]);
    await expect(applyBatteryImport(tx, CFG, [clash], { staffUserId: staff })).rejects.toMatchObject({
      code: 'SLUG_TAKEN',
    });
    const v = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'CEAT-9'));
    expect(v[0]?.productId).toBe(foreign?.id);
  });
});
