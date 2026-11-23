/**
 * Amaron import into the database (user 2026-11-23): old Amaron products are archived (never deleted), Exide and other
 * brands are untouched, new rows are live with pack, part numbers, range, category and photos fields, the earth-moving
 * category is created, and a second run changes nothing.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { csvRows as amaronRows, planAmaron, type AmaronPlan } from '../src/amaron';
import { planExide } from '../src/exide';
import {
  applyAmaronImport,
  applyExideImport,
  batteryPhotoStates,
  diffAmaronImport,
  getCatalogueProduct,
  reorderProductPhotos,
  saveProductPhoto,
  type Tx,
} from '../src/repo';

const amaron = (name: string) =>
  amaronRows(readFileSync(new URL(`./fixtures/amaron/${name}`, import.meta.url), 'utf8'));
const exide = (name: string) =>
  amaronRows(readFileSync(new URL(`./fixtures/exide/${name}`, import.meta.url), 'utf8'));
const plan: AmaronPlan = planAmaron({
  batteries: amaron('amaron_batteries.csv'),
  fitment: amaron('amaron_vehicle_fitment.csv'),
  combos: amaron('amaron_home_ups_combos.csv'),
});

let db: TestDb;
let tx: Tx;
let staff: string;
let demoAmaron: string;
let exideProduct: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-amaron-staff' }).returning())[0]?.id ?? '';
  const [batteries] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', sort: 2 })
    .returning();
  const [am] = await db.insert(s.brands).values({ slug: 'amaron', name: 'Amaron' }).returning();
  const [ex] = await db.insert(s.brands).values({ slug: 'exide', name: 'Exide' }).returning();
  const base = {
    categoryId: batteries?.id ?? '',
    hsn: '8507',
    gstRateBp: 1800,
    status: 'live',
    hindiMachine: true,
  };
  // The demo Amaron product (not in the plan) and an Exide product.
  const [a] = await db
    .insert(s.products)
    .values({
      ...base,
      brandId: am?.id ?? '',
      slug: 'car-starter-battery-45ah',
      name: 'Car starter battery 45Ah',
    })
    .returning();
  const [b] = await db
    .insert(s.products)
    .values({
      ...base,
      brandId: ex?.id ?? '',
      slug: 'exide-mileage-ml55d23l',
      name: 'Exide Mileage ML55D23L',
    })
    .returning();
  demoAmaron = a?.id ?? '';
  exideProduct = b?.id ?? '';
  await db.insert(s.productVariants).values([
    { productId: demoAmaron, sku: 'DEMO-AMARON-45', mrpPaise: 1 },
    { productId: exideProduct, sku: 'EXIDE-ML55D23L', mrpPaise: 878700 },
  ]);
});

describe('Amaron import', () => {
  it('a dry run writes nothing and reports the plan', async () => {
    const diff = await diffAmaronImport(tx, plan.products);
    expect(diff.counts.productsCreated).toBe(plan.products.length);
    expect(diff.counts.productsArchived).toBe(1);
    expect(diff.archived.map((x) => x.slug)).toEqual(['car-starter-battery-45ah']);
    const [row] = await db.select().from(s.products).where(eq(s.products.id, demoAmaron));
    expect(row?.status).toBe('live');
    expect(
      await db.select().from(s.categories).where(eq(s.categories.slug, 'earth-moving-batteries')),
    ).toHaveLength(0);
  });

  it('archives the old Amaron product with its pack, leaves Exide alone, creates the new rows live', async () => {
    const run = await applyAmaronImport(tx, plan.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: plan.products.length,
      productsArchived: 1,
      brandsCreated: 0,
    });
    // Archived, not deleted; its pack archived too; an audit row.
    const [old] = await db.select().from(s.products).where(eq(s.products.id, demoAmaron));
    expect(old?.status).toBe('archived');
    const oldPack = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, demoAmaron));
    expect(oldPack.map((v) => v.status)).toEqual(['archived']);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, demoAmaron));
    expect(audits.some((a) => a.action === 'product.status_changed')).toBe(true);
    expect(audits.every((a) => (a.after as { source?: string }).source === 'amaron_import')).toBe(true);
    // Exide: untouched.
    const [ex] = await db.select().from(s.products).where(eq(s.products.id, exideProduct));
    expect(ex?.status).toBe('live');
    expect(ex?.version).toBe(1);
    // Every planned product is live with a pack, part numbers, a range and a category.
    const slugs = plan.products.map((p) => p.slug);
    const live = await db.select().from(s.products).where(inArray(s.products.slug, slugs));
    expect(live).toHaveLength(plan.products.length);
    expect(live.every((p) => p.status === 'live' && p.rangeId !== null && p.hindiMachine)).toBe(true);
    const packs = await db
      .select()
      .from(s.productVariants)
      .where(
        inArray(
          s.productVariants.sku,
          plan.products.map((p) => p.variant.sku),
        ),
      );
    expect(packs).toHaveLength(plan.products.length);
    const parts = await db
      .select()
      .from(s.partNumbers)
      .where(
        inArray(
          s.partNumbers.variantId,
          packs.map((v) => v.id),
        ),
      );
    expect(parts).toHaveLength(plan.products.reduce((n, p) => n + p.partNumbers.length, 0));
    const pro = packs.find((v) => v.sku === 'AMARON-AAM-PR-0055B24LS');
    expect(parts.filter((p) => p.variantId === pro?.id).map((p) => p.normalised)).toEqual(
      expect.arrayContaining(['55B24LS', 'AAMPR0055B24LS']),
    );
    expect(pro?.mrpPaise).toBe(966800);
    // The brand's ranges and the new earth-moving category (a sub-category of batteries).
    const [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, 'amaron'));
    const ranges = await db
      .select()
      .from(s.productRanges)
      .where(eq(s.productRanges.brandId, brand?.id ?? ''));
    expect(ranges.map((r) => r.slug)).toEqual(expect.arrayContaining(['amaron-pro', 'amaron-black']));
    const [earth] = await db
      .select()
      .from(s.categories)
      .where(eq(s.categories.slug, 'earth-moving-batteries'));
    expect(earth).toMatchObject({ name: 'Earth-moving & construction equipment batteries' });
    expect(earth?.nameHi).toBe('अर्थ-मूविंग और कंस्ट्रक्शन मशीन बैटरी');
    expect(earth?.parentId).not.toBeNull();
    // The spec keeps Amaron's price terms and the combos.
    const [hups] = await db.select().from(s.products).where(eq(s.products.slug, 'amaron-home-ups-hb750a'));
    expect((hups?.spec as { combos?: unknown[] }).combos?.length).toBeGreaterThan(0);
    const [bl] = await db.select().from(s.products).where(eq(s.products.slug, 'amaron-black-bl400lmf'));
    expect((bl?.spec as { amaronPrice: { sellingPaise: number } }).amaronPrice.sellingPaise).toBe(454900);
  });

  it('the public product page shows the MRP and no Amaron price terms, combos or fitment list', async () => {
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
    const page = await getCatalogueProduct(tx, 'amaron-home-ups-hb750a', {
      cityCode: 'RPR',
      locale: 'en',
    });
    for (const key of ['amaronPrice', 'combos', 'fitment', 'categoryRule'])
      expect(page.spec).not.toHaveProperty(key);
    expect(page.spec).toMatchObject({ source: 'amaron', itemCode: 'AAM-HU-HB0000750' });
    expect(page.variants[0]?.mrpPaise).toBe(773800);
    const car = await getCatalogueProduct(tx, 'amaron-pro-55b24ls', { cityCode: 'RPR', locale: 'en' });
    expect(car.spec).not.toHaveProperty('fitment');
  });

  it('places photos in plan order, skips what a product already has, keeps an older photo behind', async () => {
    const slug = 'amaron-black-bl400lmf';
    const p = plan.products.find((x) => x.slug === slug);
    if (!p) throw new Error('no product');
    expect(p.photos).toHaveLength(3);
    const actor = { kind: 'staff' as const, userId: staff };
    const [row] = await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.slug, slug));
    const productId = row?.id ?? '';
    const image = (n: number) => {
      const mediaId = crypto.randomUUID();
      const dir = `product/${productId}`;
      return {
        mediaId,
        bucket: 'photos',
        path: `${dir}/${mediaId}.webp`,
        thumbPath: `${dir}/${mediaId}-thumb.webp`,
        path640: `${dir}/${mediaId}-640.webp`,
        width: 1600,
        height: 1200,
        bytes: 100,
        thumbBytes: 10,
        sha256: String(n).repeat(64),
        lqip: 'data:image/webp;base64,UklGRg==',
      };
    };
    // An older photo first (a replaced product's), then the three of the plan added in a different order than planned.
    const old = await saveProductPhoto(tx, {
      slug,
      actor,
      alt: 'Old photo',
      altHi: 'पुरानी फ़ोटो',
      image: image(9),
    });
    const [front, side, top] = p.photos;
    const added: Record<string, string> = {};
    for (const [n, ph] of [
      [1, top],
      [2, front],
      [3, side],
    ] as const) {
      if (!ph) throw new Error('photo');
      const saved = await saveProductPhoto(tx, {
        slug,
        actor,
        alt: ph.alt,
        altHi: ph.altHi,
        photoSource: ph.sourceUrl,
        image: image(n),
      });
      added[ph.file] = saved.id;
    }
    const state = (await batteryPhotoStates(tx, [p])).get(slug);
    if (!state || !front || !side || !top) throw new Error('state');
    // What the CLI does: every planned photo already there is found by its source URL, and the order is the plan's.
    const wanted = p.photos.map((ph) => state.idBySource.get(ph.sourceUrl));
    expect(wanted).toEqual([front, side, top].map((ph) => added[ph.file]));
    const order = [...wanted, ...state.photoIds.filter((id) => !wanted.includes(id))].filter(
      (id): id is string => id !== undefined,
    );
    expect(order).toHaveLength(4);
    expect(order.at(-1)).toBe(old.id);
    await reorderProductPhotos(tx, { slug, ids: order, userId: staff });
    const after = (await batteryPhotoStates(tx, [p])).get(slug);
    expect(after?.photoIds).toEqual(order);
  });

  it('a second run changes nothing', async () => {
    const [before] = await db.select().from(s.products).where(eq(s.products.slug, 'amaron-pro-55b24ls'));
    const run = await applyAmaronImport(tx, plan.products, { staffUserId: staff });
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
    const [after] = await db.select().from(s.products).where(eq(s.products.slug, 'amaron-pro-55b24ls'));
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
    await applyAmaronImport(tx, plan.products, { staffUserId: staff });
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, target.slug));
    expect(row?.name).toBe('Staff edited name');
    const [v] = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.sku, target.variant.sku));
    expect(v?.mrpPaise).toBe(12345);
  });

  it('an Exide import afterwards leaves every Amaron product live (and the other way round)', async () => {
    const exidePlan = planExide({
      batteries: exide('exide_batteries.csv'),
      fitment: exide('exide_vehicle_fitment.csv'),
    });
    const run = await applyExideImport(tx, exidePlan.products, { staffUserId: staff });
    expect(run.archived.every((a) => !a.slug.startsWith('amaron-'))).toBe(true);
    const amarons = await db
      .select()
      .from(s.products)
      .where(
        inArray(
          s.products.slug,
          plan.products.map((p) => p.slug),
        ),
      );
    expect(amarons.every((p) => p.status === 'live')).toBe(true);
    // And the Amaron run still archives nothing of Exide.
    const again = await diffAmaronImport(tx, plan.products);
    expect(again.archived).toEqual([]);
  });
});
