/**
 * Vehicle segments (design 2026-11-25, spec 02 "Vehicle segments"): the seeded segments and category mapping, the insert
 * trigger and the backfill (category first, vehicle types for general categories, tractor text), the many-to-many
 * table, the listing filter and facet counts, the card tags, the search words and the admin edits.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_SEGMENTS_OF_CATEGORY, defaultSegmentsFor } from '@mechdost/shared/vehicle-segments';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  invalidateSearchVocab,
  listAdminSegments,
  listCatalogue,
  productSegmentCodes,
  setProductSegments,
  updateVehicleSegment,
  type Tx,
} from '../src/repo';
import { rowsOf } from '../src/repo/sql-rows';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const CAT: Record<string, string> = {};
const P: Record<string, string> = {};

async function category(slug: string): Promise<string> {
  const [row] = await db
    .insert(s.categories)
    .values({ slug, name: slug, nameHi: `${slug} (हिं)` })
    .returning();
  CAT[slug] = row!.id;
  return row!.id;
}

async function product(
  slug: string,
  categorySlug: string,
  extra: Partial<typeof s.products.$inferInsert> = {},
): Promise<string> {
  const [p] = await db
    .insert(s.products)
    .values({
      slug,
      name: slug,
      nameHi: `${slug} (हिं)`,
      brandId: F.brand!,
      categoryId: CAT[categorySlug]!,
      hsn: '4011',
      gstRateBp: 2800,
      status: 'live',
      ...extra,
    })
    .returning();
  await db
    .insert(s.productVariants)
    .values({ productId: p!.id, sku: `SKU-${slug.toUpperCase()}`, mrpPaise: 100000 });
  P[slug] = p!.id;
  return p!.id;
}

const segmentsOf = async (slug: string) => productSegmentCodes(t(), P[slug]!);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  await db.insert(s.cities).values({
    stateId: state!.id,
    code: 'RPR',
    slug: 'raipur',
    name: 'Raipur',
    status: 'live',
    centroid: { lng: 81.64, lat: 21.227 },
  });
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-segments-staff' }).returning())[0]!.id;
  F.brand = (await db.insert(s.brands).values({ slug: 'mrf', name: 'MRF' }).returning())[0]!.id;
  for (const slug of [...Object.keys(DEFAULT_SEGMENTS_OF_CATEGORY), 'greases', 'coolants', 'filters'])
    await category(slug);
});

afterAll(async () => {
  await client.close();
});

describe('the seeded segments and mapping (migration 0087)', () => {
  it('seeds the eight segments with English and Hindi names in order', async () => {
    const rows = await listAdminSegments(t());
    expect(rows.map((r) => r.code)).toEqual([
      'two_wheeler',
      'three_wheeler',
      'car_suv',
      'light_commercial',
      'truck_bus',
      'tractor_farm',
      'construction_otr',
      'not_vehicle',
    ]);
    expect(rows.every((r) => r.nameEn !== '' && r.nameHi !== '' && r.active)).toBe(true);
    expect(rows.find((r) => r.code === 'truck_bus')).toMatchObject({
      nameEn: 'Truck & bus',
      nameHi: 'ट्रक और बस',
    });
  });

  it('holds exactly the reviewed category mapping (SQL table equals the shared constant)', async () => {
    const rows = rowsOf<{ category_slug: string; segment_code: string }>(
      await db.execute(sql`select category_slug, segment_code from category_default_segments`),
    );
    const sqlMap: Record<string, string[]> = {};
    for (const r of rows) (sqlMap[r.category_slug] ??= []).push(r.segment_code);
    for (const v of Object.values(sqlMap)) v.sort();
    const shared = Object.fromEntries(
      Object.entries(DEFAULT_SEGMENTS_OF_CATEGORY).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(sqlMap).toEqual(shared);
  });

  it('refuses a code outside the enum and keeps the tables closed to the Data API roles', async () => {
    await expect(
      db.insert(s.vehicleSegments).values({ code: 'hovercraft', nameEn: 'x', nameHi: 'x' }),
    ).rejects.toThrow();
    const rls = rowsOf<{ relname: string; relrowsecurity: boolean }>(
      await db.execute(sql`select relname, relrowsecurity from pg_class where relname in
        ('vehicle_segments','product_vehicle_segments','category_default_segments')`),
    );
    expect(rls).toHaveLength(3);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe('defaults on insert and the backfill', () => {
  beforeAll(async () => {
    await product('truck-tyre', 'truck-bus-tyres');
    await product('cv-battery', 'cv-batteries', { vehicleTypes: ['4W'] }); // the category wins over the type
    await product('farm-tyre', 'farm-tyres');
    await product('otr-tyre', 'otr-tyres');
    await product('home-inverter', 'home-power');
    await product('diesel-oil', 'diesel-engine-oil');
    await product('diesel-oil-tractor', 'diesel-engine-oil', { name: 'Servo Tractor diesel oil 15W-40' });
    await product('grease-bike-car', 'greases', { vehicleTypes: ['2W', '4W'] });
    await product('grease-plain', 'greases');
    await product('coolant-three', 'coolants', { vehicleTypes: ['3W'] });
  });

  it('a new product takes its category defaults', async () => {
    expect(await segmentsOf('truck-tyre')).toEqual(['truck_bus']);
    expect(await segmentsOf('farm-tyre')).toEqual(['tractor_farm']);
    expect(await segmentsOf('otr-tyre')).toEqual(['construction_otr']);
    expect(await segmentsOf('home-inverter')).toEqual(['not_vehicle']);
    expect(await segmentsOf('cv-battery')).toEqual(['light_commercial', 'truck_bus']);
    expect(await segmentsOf('diesel-oil')).toEqual(['light_commercial', 'truck_bus']);
  });

  it('a diesel oil that says tractor also gets Tractor & farm', async () => {
    expect(await segmentsOf('diesel-oil-tractor')).toEqual(['light_commercial', 'truck_bus', 'tractor_farm']);
  });

  it('a general category takes the segments of its vehicle types, else none', async () => {
    expect(await segmentsOf('grease-bike-car')).toEqual(['two_wheeler', 'car_suv']);
    expect(await segmentsOf('coolant-three')).toEqual(['three_wheeler']);
    expect(await segmentsOf('grease-plain')).toEqual([]);
  });

  it('the shared helper agrees with the SQL for every case above', () => {
    expect(defaultSegmentsFor({ categorySlug: 'truck-bus-tyres', vehicleTypes: [] })).toEqual(['truck_bus']);
    expect(defaultSegmentsFor({ categorySlug: 'cv-batteries', vehicleTypes: ['4W'] })).toEqual([
      'truck_bus',
      'light_commercial',
    ]);
    expect(defaultSegmentsFor({ categorySlug: 'greases', vehicleTypes: ['2W', '4W'] })).toEqual([
      'two_wheeler',
      'car_suv',
    ]);
    expect(defaultSegmentsFor({ categorySlug: 'greases', vehicleTypes: [] })).toEqual([]);
  });

  it('the backfill restores the defaults, is idempotent and leaves a product staff already set alone', async () => {
    await db.execute(sql`delete from product_vehicle_segments`);
    await db
      .insert(s.productVehicleSegments)
      .values({ productId: P['truck-tyre']!, segmentCode: 'tractor_farm' });
    const [first] = rowsOf<{ n: number }>(
      await db.execute(sql`select public.backfill_product_segments() as n`),
    );
    expect(first!.n).toBeGreaterThan(0);
    expect(await segmentsOf('truck-tyre')).toEqual(['tractor_farm']); // staff's choice kept
    expect(await segmentsOf('farm-tyre')).toEqual(['tractor_farm']);
    expect(await segmentsOf('grease-bike-car')).toEqual(['two_wheeler', 'car_suv']);
    expect(await segmentsOf('grease-plain')).toEqual([]);
    const [again] = rowsOf<{ n: number }>(
      await db.execute(sql`select public.backfill_product_segments() as n`),
    );
    expect(again!.n).toBe(0);
    // Put the fixture back for the later suites.
    await db.delete(s.productVehicleSegments).where(eq(s.productVehicleSegments.productId, P['truck-tyre']!));
    await db
      .insert(s.productVehicleSegments)
      .values({ productId: P['truck-tyre']!, segmentCode: 'truck_bus' });
  });

  it('keeps a product with the same segment once and deletes its rows with the product', async () => {
    await expect(
      db.insert(s.productVehicleSegments).values({ productId: P['truck-tyre']!, segmentCode: 'truck_bus' }),
    ).rejects.toThrow();
    const id = await product('temp-product', 'truck-bus-tyres');
    await db.delete(s.products).where(eq(s.products.id, id));
    const left = rowsOf<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from product_vehicle_segments where product_id = ${id}`),
    );
    expect(left[0]!.n).toBe(0);
  });
});

describe('the listing: filter, facets, card tags', () => {
  const list = (extra: Partial<Parameters<typeof listCatalogue>[1]> = {}) =>
    listCatalogue(t(), { cityCode: 'RPR', locale: 'en', ...extra });

  it('filters by one segment and by several (any of)', async () => {
    const truck = await list({ segments: ['truck_bus'] });
    expect(truck.items.map((i) => i.slug).sort()).toEqual(
      ['cv-battery', 'diesel-oil', 'diesel-oil-tractor', 'truck-tyre'].sort(),
    );
    const both = await list({ segments: ['truck_bus', 'tractor_farm'] });
    expect(both.items.map((i) => i.slug)).toContain('farm-tyre');
    expect(both.items.map((i) => i.slug)).toContain('truck-tyre');
    expect(both.items.map((i) => i.slug)).not.toContain('home-inverter');
  });

  it('counts each segment for the current query without applying the segment filter itself', async () => {
    const all = await list();
    const byCode = Object.fromEntries(all.facets.segments.map((f) => [f.code, f.count]));
    expect(byCode.truck_bus).toBe(4);
    expect(byCode.tractor_farm).toBe(2);
    expect(byCode.construction_otr).toBe(1);
    expect(byCode.not_vehicle).toBe(1);
    // Choosing a segment does not change the counts of the others.
    const filtered = await list({ segments: ['truck_bus'] });
    expect(filtered.facets).toEqual(all.facets);
    // A category narrows them.
    const tyres = await list({ category: 'farm-tyres' });
    expect(Object.fromEntries(tyres.facets.segments.map((f) => [f.code, f.count]))).toMatchObject({
      tractor_farm: 1,
      truck_bus: 0,
    });
  });

  it('names segments in the page language and orders them like the staff order', async () => {
    const hi = await list({ locale: 'hi', segments: ['construction_otr'] });
    expect(hi.items[0]?.segments).toEqual([{ code: 'construction_otr', name: 'निर्माण और ओटीआर' }]);
    expect(hi.facets.segments.find((f) => f.code === 'truck_bus')?.name).toBe('ट्रक और बस');
    const cv = (await list({ segments: ['light_commercial'] })).items.find((i) => i.slug === 'cv-battery');
    expect(cv?.segments.map((x) => x.code)).toEqual(['light_commercial', 'truck_bus']);
  });

  it('sends no facets on a later page (the cursor) and no tag for a switched-off segment', async () => {
    const first = await list({ limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const next = await list({ limit: 2, cursor: first.nextCursor });
    expect(next.facets.segments).toEqual([]);
    const [tractor] = await db
      .select()
      .from(s.vehicleSegments)
      .where(eq(s.vehicleSegments.code, 'tractor_farm'));
    await updateVehicleSegment(t(), {
      code: 'tractor_farm',
      expectedVersion: tractor!.version,
      patch: { active: false },
      staffUserId: F.staff!,
    });
    const off = await list();
    expect(off.facets.segments.map((f) => f.code)).not.toContain('tractor_farm');
    expect(off.items.find((i) => i.slug === 'farm-tyre')?.segments).toEqual([]);
    const [again] = await db
      .select()
      .from(s.vehicleSegments)
      .where(eq(s.vehicleSegments.code, 'tractor_farm'));
    await updateVehicleSegment(t(), {
      code: 'tractor_farm',
      expectedVersion: again!.version,
      patch: { active: true },
      staffUserId: F.staff!,
    });
  });
});

describe('search words', () => {
  it('"truck" ranks the Truck & bus products first and drops the word from the text match', async () => {
    invalidateSearchVocab();
    await product('city-tyre', 'greases', { name: 'City tyre', vehicleTypes: ['4W'] });
    await product('truck-radial', 'truck-bus-tyres', { name: 'Radial tyre 10.00 R20' });
    const page = await listCatalogue(t(), { cityCode: 'RPR', locale: 'en', q: 'truck tyre' });
    const slugs = page.items.map((i) => i.slug);
    expect(slugs).toContain('truck-radial');
    expect(slugs.indexOf('truck-radial')).toBeLessThan(
      slugs.indexOf('city-tyre') === -1 ? 99 : slugs.indexOf('city-tyre'),
    );
  });

  it('the migration turned the old truck / bus / tractor vehicle words into segment words', async () => {
    const rows = rowsOf<{ term: string; kind: string; expands_to: string[] }>(
      await db.execute(
        sql`select term, kind, expands_to from search_synonyms where term in ('truck','tractor','jcb','ट्रक')`,
      ),
    );
    expect(rows.every((r) => r.kind === 'segment')).toBe(true);
    expect(rows.find((r) => r.term === 'jcb')?.expands_to).toEqual(['construction_otr']);
  });
});

describe('admin edits', () => {
  it('renames, reorders and switches a segment with compare-and-set and an audit row', async () => {
    const [before] = await db
      .select()
      .from(s.vehicleSegments)
      .where(eq(s.vehicleSegments.code, 'light_commercial'));
    const updated = await updateVehicleSegment(t(), {
      code: 'light_commercial',
      expectedVersion: before!.version,
      patch: { nameHi: 'हल्के वाहन', sort: 45 },
      staffUserId: F.staff!,
    });
    expect(updated).toMatchObject({ nameHi: 'हल्के वाहन', sort: 45, version: before!.version + 1 });
    await expect(
      updateVehicleSegment(t(), {
        code: 'light_commercial',
        expectedVersion: before!.version,
        patch: { sort: 1 },
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SEGMENT' });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'vehicle_segment.updated'));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    await expect(
      updateVehicleSegment(t(), {
        code: 'nope',
        expectedVersion: 1,
        patch: { sort: 1 },
        staffUserId: F.staff!,
      }),
    ).rejects.toThrow();
  });

  it("sets a product's segments, bumps its version, audits and refuses stale or unknown input", async () => {
    const [p] = await db.select().from(s.products).where(eq(s.products.slug, 'grease-plain'));
    const out = await setProductSegments(t(), {
      slug: 'grease-plain',
      expectedVersion: p!.version,
      segments: ['truck_bus', 'tractor_farm', 'truck_bus'],
      staffUserId: F.staff!,
    });
    expect(out.segments).toEqual(['truck_bus', 'tractor_farm']);
    expect(out.version).toBe(p!.version + 1);
    expect(await segmentsOf('grease-plain')).toEqual(['truck_bus', 'tractor_farm']);
    await expect(
      setProductSegments(t(), {
        slug: 'grease-plain',
        expectedVersion: p!.version,
        segments: [],
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PRODUCT' });
    await expect(
      setProductSegments(t(), {
        slug: 'grease-plain',
        expectedVersion: out.version,
        segments: ['x'],
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_SEGMENTS' });
    const cleared = await setProductSegments(t(), {
      slug: 'grease-plain',
      expectedVersion: out.version,
      segments: [],
      staffUserId: F.staff!,
    });
    expect(cleared.segments).toEqual([]);
  });
});
