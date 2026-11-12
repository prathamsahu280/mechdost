/**
 * Admin catalogue editor (spec 02/08): English and Hindi texts side by side with the missing-Hindi list,
 * compare-and-set edits audited field by field, Hindi highlights aligned or empty, publishing through
 * productMachine (active variant required; complete Hindi when the launch check is on), drafts invisible.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  getAdminProduct,
  listAdminProducts,
  listCatalogue,
  setProductStatus,
  setProductVehicleTypes,
  updateProductTexts,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  await db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' });
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', nameHi: 'बैटरी' })
    .returning();
  const [brand] = await db.insert(s.brands).values({ slug: 'exide', name: 'Exide' }).returning();
  const base = { brandId: brand!.id, categoryId: cat!.id, hsn: '8507', gstRateBp: 1800 };
  await db.insert(s.products).values([
    { ...base, slug: 'a-complete', name: 'Complete battery', nameHi: 'पूरी बैटरी', status: 'live' },
    {
      ...base,
      slug: 'b-draft',
      name: 'Draft battery',
      specSummary: '12 V · 3 Ah',
      highlights: ['Sealed'],
      status: 'draft',
    },
  ]);
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-cat-admin' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('catalogue editor', () => {
  it('lists Hindi gaps and filters by them', async () => {
    const all = await listAdminProducts(t(), {});
    expect(all.items.map((p) => [p.slug, p.missingHindi])).toEqual([
      ['a-complete', []],
      ['b-draft', ['name', 'specSummary', 'highlights']],
    ]);
    const gaps = await listAdminProducts(t(), { missingHindiOnly: true });
    expect(gaps.items.map((p) => p.slug)).toEqual(['b-draft']);
    expect((await listAdminProducts(t(), { limit: 1 })).next).toBe('a-complete');
  });

  it('edits texts with compare-and-set, audits only what changed, keeps Hindi highlights aligned', async () => {
    const p = await getAdminProduct(t(), 'b-draft');
    await expect(
      updateProductTexts(t(), {
        slug: 'b-draft',
        expectedVersion: p.version,
        patch: { highlightsHi: ['एक', 'दो'] },
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'HIGHLIGHTS_HI_ALIGNED' });
    await expect(
      updateProductTexts(t(), {
        slug: 'b-draft',
        expectedVersion: p.version,
        patch: { name: ' ' },
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
    const r = await updateProductTexts(t(), {
      slug: 'b-draft',
      expectedVersion: p.version,
      patch: { nameHi: 'ड्राफ़्ट बैटरी', specSummaryHi: '12 V · 3 Ah', name: 'Draft battery' },
      staffUserId: staff,
    });
    expect(r.missingHindi).toEqual(['highlights']);
    await expect(
      updateProductTexts(t(), {
        slug: 'b-draft',
        expectedVersion: p.version,
        patch: { nameHi: 'x' },
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PRODUCT' });
    const [audit] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'product.texts_updated'));
    expect(Object.keys(audit!.after as object).sort()).toEqual(['nameHi', 'specSummaryHi']); // name was unchanged
  });

  it('publishes through the machine: needs a variant, and complete Hindi once the launch check is on', async () => {
    let p = await getAdminProduct(t(), 'b-draft');
    await expect(
      setProductStatus(t(), {
        slug: 'b-draft',
        to: 'archived',
        expectedVersion: p.version,
        staffUserId: staff,
      }),
    ).rejects.toThrow(/illegal transition/);
    await expect(
      setProductStatus(t(), { slug: 'b-draft', to: 'live', expectedVersion: p.version, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'NO_VARIANT' });
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, 'b-draft'));
    await db.insert(s.productVariants).values({ productId: row!.id, sku: 'EXI-DRAFT', mrpPaise: 90000 });
    await db.insert(s.settings).values({ key: 'catalogue.require_hindi_to_publish', value: true });
    await expect(
      setProductStatus(t(), { slug: 'b-draft', to: 'live', expectedVersion: p.version, staffUserId: staff }),
    ).rejects.toMatchObject({ code: 'HINDI_MISSING', details: { fields: ['highlights'] } });
    await updateProductTexts(t(), {
      slug: 'b-draft',
      expectedVersion: p.version,
      patch: { highlightsHi: ['सील्ड'] },
      staffUserId: staff,
    });
    p = await getAdminProduct(t(), 'b-draft');
    expect((await listCatalogue(t(), { cityCode: 'RPR', locale: 'en' })).items.map((i) => i.slug)).toEqual([
      'a-complete',
    ]);
    await setProductStatus(t(), {
      slug: 'b-draft',
      to: 'live',
      expectedVersion: p.version,
      staffUserId: staff,
    });
    expect(
      (await listCatalogue(t(), { cityCode: 'RPR', locale: 'hi' })).items.map((i) => i.name).sort(),
    ).toEqual(['ड्राफ़्ट बैटरी', 'पूरी बैटरी']);
  });
});

describe('vehicle types (admin-editable, decision 2026-11-12)', () => {
  it('staff set the types a product is for; audited; stale versions and unknown codes are refused', async () => {
    const p = await getAdminProduct(t(), 'b-draft');
    const r = await setProductVehicleTypes(t(), {
      slug: 'b-draft',
      expectedVersion: p.version,
      vehicleTypes: ['4W', '2W', '2W'],
      staffUserId: staff,
    });
    expect((await getAdminProduct(t(), 'b-draft')).vehicleTypes).toEqual(['2W', '4W']);
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'product.vehicle_types_updated'));
    expect(audit.at(-1)).toMatchObject({
      before: { vehicleTypes: [] },
      after: { vehicleTypes: ['2W', '4W'] },
    });
    await expect(
      setProductVehicleTypes(t(), {
        slug: 'b-draft',
        expectedVersion: p.version,
        vehicleTypes: [],
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PRODUCT' });
    await expect(
      setProductVehicleTypes(t(), {
        slug: 'b-draft',
        expectedVersion: r.version,
        vehicleTypes: ['EV' as '2W'],
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_TYPES' });
  });
});
