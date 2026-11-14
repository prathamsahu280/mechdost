/**
 * Adding products (plan 2026-11-14 Stream B; spec 02/08): the admin form creates a draft (or live when
 * published) with its first pack, brand created on the way, audited; the CSV import checks every row first,
 * writes nothing when any row is wrong, skips SKUs already in the catalogue and inserts the rest in one go.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createProduct,
  events,
  getAdminProduct,
  importProducts,
  type NewProduct,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';

const battery = (over: Partial<NewProduct> = {}): NewProduct => ({
  categorySlug: 'batteries',
  brand: 'Exide',
  name: 'XLTZ4A 2W battery',
  nameHi: 'XLTZ4A दोपहिया बैटरी',
  specSummary: '12 V · 3 Ah',
  specSummaryHi: '12 V · 3 Ah',
  highlights: ['Sealed'],
  highlightsHi: ['सील्ड'],
  vehicleTypes: ['2W'],
  attributes: { voltage: 12, capacityAh: '3', batteryType: 'vrla' },
  sku: 'EXI-XLTZ4A',
  mrpPaise: 145_000,
  hsn: '8507',
  gstRateBp: 1800,
  netQuantity: { qty: 1, unit: 'piece' },
  ...over,
});

const count = async () => ({
  products: await db.$count(s.products),
  variants: await db.$count(s.productVariants),
  brands: await db.$count(s.brands),
});

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [parent] = await db
    .insert(s.categories)
    .values([
      { slug: 'batteries', name: 'Batteries', nameHi: 'बैटरी' },
      { slug: 'lubricants', name: 'Lubricants', nameHi: 'लुब्रिकेंट' },
    ])
    .returning();
  await db
    .insert(s.categories)
    .values({ slug: 'scooter-batteries', name: 'Scooter batteries', parentId: parent!.id });
  const [brand] = await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning();
  const [lube] = await db.select().from(s.categories).where(eq(s.categories.slug, 'lubricants'));
  const [old] = await db
    .insert(s.products)
    .values({
      slug: 'castrol-activ',
      name: 'Activ',
      brandId: brand!.id,
      categoryId: lube!.id,
      hsn: '2710',
      gstRateBp: 1800,
    })
    .returning();
  await db.insert(s.productVariants).values({ productId: old!.id, sku: 'CAS-OLD', mrpPaise: 40_000 });
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-cat-create' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.delete(s.settings).where(eq(s.settings.key, 'catalogue.require_hindi_to_publish'));
});

describe('createProduct (admin form)', () => {
  it('creates a draft with its first pack, typed attributes and a new brand, audited with an event', async () => {
    const before = await count();
    const r = await createProduct(t(), { product: battery(), publish: false, staffUserId: staff });
    expect(r).toMatchObject({
      slug: 'exide-xltz4a-2w-battery',
      sku: 'EXI-XLTZ4A',
      status: 'draft',
      version: 1,
    });
    expect(await count()).toEqual({
      products: before.products + 1,
      variants: before.variants + 1,
      brands: before.brands + 1,
    });
    const p = await getAdminProduct(t(), r.slug);
    expect(p).toMatchObject({
      brand: 'Exide',
      category: 'batteries',
      status: 'draft',
      nameHi: 'XLTZ4A दोपहिया बैटरी',
      highlightsHi: ['सील्ड'],
      vehicleTypes: ['2W'],
      attributes: { voltage: 12, capacityAh: 3, batteryType: 'vrla' },
      variants: [{ sku: 'EXI-XLTZ4A', mrpPaise: 145_000, netQuantity: { qty: 1, unit: 'piece' } }],
      missingHindi: [],
    });
    const audits = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, p.id), eq(s.auditLog.action, 'product.created')));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({
      status: 'draft',
      source: 'form',
      variant: { sku: 'EXI-XLTZ4A' },
    });
    expect(
      await db.$count(
        s.auditLog,
        and(eq(s.auditLog.action, 'brand.created'), eq(s.auditLog.entity, 'brand')),
      ),
    ).toBe(1);
    const rows = await db.select().from(events).where(eq(events.event, 'admin_product_created'));
    expect(rows.map((e) => e.props)).toContainEqual({
      productSlug: 'exide-xltz4a-2w-battery',
      sku: 'EXI-XLTZ4A',
      status: 'draft',
      source: 'form',
    });
  });

  it('refuses a SKU or slug already in use with 409 codes, and writes nothing', async () => {
    const before = await count();
    await expect(
      createProduct(t(), { product: battery({ slug: 'other-slug' }), publish: false, staffUserId: staff }),
    ).rejects.toMatchObject({ status: 409, code: 'SKU_TAKEN' });
    await expect(
      createProduct(t(), { product: battery({ sku: 'EXI-NEW' }), publish: false, staffUserId: staff }),
    ).rejects.toMatchObject({ status: 409, code: 'SLUG_TAKEN' });
    expect(await count()).toEqual(before);
  });

  it('checks the category, attributes (parent category rules) and Hindi highlight alignment', async () => {
    const make = (over: Partial<NewProduct>) =>
      createProduct(t(), {
        product: battery({ sku: 'X-1', slug: 'x-1', ...over }),
        publish: false,
        staffUserId: staff,
      });
    await expect(make({ categorySlug: 'tyres' })).rejects.toMatchObject({
      status: 422,
      code: 'UNKNOWN_CATEGORY',
    });
    await expect(make({ attributes: { voltage: 99 } })).rejects.toMatchObject({ code: 'ATTRIBUTE_VALUE' });
    await expect(make({ attributes: { saeGrade: '20W40' } })).rejects.toMatchObject({
      code: 'ATTRIBUTE_UNKNOWN',
    });
    await expect(make({ highlightsHi: ['एक', 'दो'] })).rejects.toMatchObject({
      code: 'HIGHLIGHTS_HI_ALIGNED',
    });
    const sub = await make({ categorySlug: 'scooter-batteries', attributes: { voltage: '12' } });
    expect((await getAdminProduct(t(), sub.slug)).category).toBe('scooter-batteries');
  });

  it('publishes on create through the product machine; with the Hindi rule on, gaps block it', async () => {
    await db.insert(s.settings).values({ key: 'catalogue.require_hindi_to_publish', value: true });
    await expect(
      createProduct(t(), {
        product: battery({ sku: 'LIVE-1', slug: 'live-1', nameHi: null }),
        publish: true,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'HINDI_MISSING' });
    const r = await createProduct(t(), {
      product: battery({ sku: 'LIVE-1', slug: 'live-1' }),
      publish: true,
      staffUserId: staff,
    });
    expect(r.status).toBe('live');
  });
});

describe('importProducts (CSV)', () => {
  const rows = (...inputs: NewProduct[]) => inputs.map((input, i) => ({ row: i + 2, input }));
  const run = (r: ReturnType<typeof rows>, opts: { dryRun?: boolean; invalid?: [] } = {}) =>
    importProducts(t(), {
      rows: r,
      invalid: opts.invalid ?? [],
      dryRun: opts.dryRun ?? false,
      publish: false,
      staffUserId: staff,
    });

  it('a dry run checks and writes nothing; the real run inserts every row and skips existing SKUs', async () => {
    const file = rows(
      battery({ sku: 'IMP-1', name: 'Import one' }),
      battery({ sku: 'IMP-2', name: 'Import two', brand: 'Amaron' }),
      battery({ sku: 'CAS-OLD', name: 'Already there' }),
    );
    const before = await count();
    const dry = await run(file, { dryRun: true });
    expect(dry).toEqual({
      dryRun: true,
      status: 'draft',
      created: [
        { row: 2, slug: 'exide-import-one', sku: 'IMP-1' },
        { row: 3, slug: 'amaron-import-two', sku: 'IMP-2' },
      ],
      skipped: [{ row: 4, sku: 'CAS-OLD', reason: 'SKU_EXISTS' }],
    });
    expect(await count()).toEqual(before);

    const real = await run(file);
    expect(real.dryRun).toBe(false);
    expect(real.created).toHaveLength(2);
    expect(await count()).toEqual({
      products: before.products + 2,
      variants: before.variants + 2,
      brands: before.brands + 1,
    });
    expect(
      (await db.select().from(events).where(eq(events.event, 'admin_catalogue_imported'))).map(
        (e) => e.props,
      ),
    ).toEqual([{ rows: 3, created: 2, skipped: 1, status: 'draft' }]);

    // Re-running the same file is safe: everything is reported as already there.
    const again = await run(file);
    expect(again.created).toEqual([]);
    expect(again.skipped.map((x) => x.sku)).toEqual(['IMP-1', 'IMP-2', 'CAS-OLD']);
    expect(await count()).toEqual({
      products: before.products + 2,
      variants: before.variants + 2,
      brands: before.brands + 1,
    });
  });

  it('one bad row → nothing written, every problem listed by row and column', async () => {
    const before = await count();
    const file = rows(
      battery({ sku: 'BAD-1', name: 'Good row' }),
      battery({ sku: 'BAD-2', name: 'Bad row', categorySlug: 'nope', attributes: {} }),
      battery({ sku: 'BAD-1', name: 'Repeated SKU' }),
      battery({ sku: 'BAD-4', name: 'Good row' }),
      battery({ sku: 'BAD-5', slug: 'castrol-activ' }),
    );
    await expect(
      importProducts(t(), {
        rows: file,
        invalid: [{ row: 7, field: 'mrp_rupees', code: 'INVALID' }],
        dryRun: false,
        publish: false,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'IMPORT_ROWS_INVALID',
      details: {
        errors: [
          { row: 3, field: 'category', code: 'UNKNOWN_CATEGORY' },
          { row: 4, field: 'sku', code: 'SKU_REPEATED' },
          { row: 5, field: 'slug', code: 'SLUG_REPEATED' },
          { row: 6, field: 'slug', code: 'SLUG_TAKEN' },
          { row: 7, field: 'mrp_rupees', code: 'INVALID' },
        ],
        skipped: [],
      },
    });
    expect(await count()).toEqual(before);
  });
});
