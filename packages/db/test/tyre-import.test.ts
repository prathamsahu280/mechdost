/**
 * CEAT and MRF tyre imports into the database (user 2026-11-24): the old product of each brand is archived (never
 * deleted), other brands are untouched, the sub-categories under `tyres` are created with their English and Hindi names
 * and descriptions, the public page hides the private spec keys, `category=tyres` still lists every tyre, a second run
 * changes nothing, and a picture shared by several products is stored once and survives until its last product drops it.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { events } from '../src/repo/events';
import { csvRows } from '../src/battery-import';
import { planCeat } from '../src/ceat';
import { planMrf } from '../src/mrf';
import {
  applyCeatImport,
  applyMrfImport,
  attachSharedProductPhoto,
  diffCeatImport,
  getCatalogueProduct,
  listCatalogue,
  removeProductPhoto,
  saveProductPhoto,
  type StoredProductImage,
  type Tx,
} from '../src/repo';

const CEAT_HEADER =
  'Tyre,Product type,Pattern,Size,SKU,Price incl. taxes (Rs),"Price in site data, not shown on page (Rs)",Width,Aspect ratio,Rim (inch),Load index,Speed rating,Construction,Tubeless / tube type,Position,Product page,Picture files,Picture URLs,Data checks';
const CEAT_PIC = 'pictures/Car - SUV tyre/MILAZE X3/CEAT MILAZE X3 - Front.jpg';
const ceat = planCeat({
  tyres: csvRows(`${CEAT_HEADER}
CEAT MILAZE X3 145/70R12 69T TL,Car / SUV tyre,MILAZE X3,145/70R12,105037,2900,,145,70,12,69,T,Radial,Tube Less,Front/Rear,https://ceat.example/a,${CEAT_PIC},u1,
CEAT MILAZE X3 155/70R12 73T TL,Car / SUV tyre,MILAZE X3,155/70R12,105038,,3100,155,70,12,73,T,Radial,Tube Less,Front/Rear,https://ceat.example/b,${CEAT_PIC},u1,"Price not shown on the page (the site has it only in its hidden data)"
CEAT ZOOM X3 110/80-17 57P TL,Motorcycle tyre,ZOOM X3,110/80-17,113577,,,110,80,17,57,P,Bias,Tube Less,Front,https://ceat.example/c,,,No picture on the page`),
  fitment: csvRows(`Vehicle type,Make,Model,Variant,Manufacturing years,Front / rear,Option,Tyre
Car,MARUTI,800,NA,1983-2014,,Recommended,CEAT MILAZE X3 145/70R12 69T TL`),
});
const MRF_HEADER =
  'Tyre,Product type,Pattern,Size,MRP incl. GST (Rs),Width,Aspect ratio,Rim (inch),Construction,Load index,Speed rating,Ply rating,Tubeless (TL) / tube type (TT),Tube sold with tyre,Features,Tyre name on site,Product page,Picture files,Picture URLs';
const mrf = planMrf({
  tyres: csvRows(`${MRF_HEADER}
MRF ZWYDE 175/60R13 77T TL,Passenger car tyre,ZWYDE,175/60R13,5360,175,60,13,Radial,77,T,,TL (tubeless),No,,175/60R13 77T TL ZWYDE,https://mrf.example/a,pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Left.jpg,
MRF 4.50-12 Bias Poly Pouch,Tube / flap,BIAS POLY POUCH,4.50-12,,4.5,,12,Bias,,,,,,,4.50-12 Bias Poly Pouch,https://mrf.example/t,pictures/Tube - flap/BIAS POLY POUCH/MRF BIAS POLY POUCH - Left.jpg,`),
  fitment: csvRows(`Vehicle type,Make (first word),Vehicle (as on site),Tyre
Car / SUV,MARUTI,MARUTI ZEN ESTILO,MRF ZWYDE 175/60R13 77T TL`),
});

let db: TestDb;
let tx: Tx;
let staff: string;

const image = (productId: string): StoredProductImage => {
  const mediaId = randomUUID();
  const dir = `product/${productId}`;
  return {
    mediaId,
    bucket: 'photos',
    path: `${dir}/${mediaId}.webp`,
    thumbPath: `${dir}/${mediaId}-thumb.webp`,
    path640: `${dir}/${mediaId}-640.webp`,
    width: 1200,
    height: 1200,
    bytes: 5000,
    thumbBytes: 800,
    sha256: 'b'.repeat(64),
    lqip: 'data:image/webp;base64,UklGRg==',
  };
};

beforeAll(async () => {
  ({ db } = await createTestDb());
  tx = db;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-tyre-staff' }).returning())[0]?.id ?? '';
  const [tyres] = await db.insert(s.categories).values({ slug: 'tyres', name: 'Tyres', sort: 3 }).returning();
  const brandIds: Record<string, string> = {};
  for (const [slug, name] of [
    ['ceat', 'CEAT'],
    ['mrf', 'MRF'],
    ['apollo', 'Apollo'],
  ] as const)
    brandIds[slug] = (await db.insert(s.brands).values({ slug, name }).returning())[0]?.id ?? '';
  for (const [brand, slug] of [
    ['ceat', 'ceat-old-tyre'],
    ['mrf', 'mrf-old-tyre'],
    ['apollo', 'apollo-alnac'],
  ] as const) {
    const [p] = await db
      .insert(s.products)
      .values({
        slug,
        name: slug,
        brandId: brandIds[brand] ?? '',
        categoryId: tyres?.id ?? '',
        hsn: '4011',
        gstRateBp: 2800,
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

describe('CEAT and MRF import', () => {
  it('a dry run writes nothing and names the one old CEAT product it would archive', async () => {
    const diff = await diffCeatImport(tx, ceat.products);
    expect(diff.counts).toMatchObject({
      productsCreated: 2,
      packsCreated: 3,
      productsArchived: 1,
      categoriesCreated: 2,
    });
    expect(diff.archived.map((a) => a.slug)).toEqual(['ceat-old-tyre']);
    expect(await db.select().from(s.categories).where(eq(s.categories.slug, 'car-suv-tyres'))).toHaveLength(
      0,
    );
  });

  it('CEAT: archives its old product only, creates the sub-categories under tyres with Hindi names and descriptions', async () => {
    const run = await applyCeatImport(tx, ceat.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: 2,
      packsCreated: 3,
      productsArchived: 1,
      categoriesCreated: 2,
    });
    const status = async (slug: string) =>
      (await db.select().from(s.products).where(eq(s.products.slug, slug)))[0]?.status;
    expect(await status('ceat-old-tyre')).toBe('archived');
    expect(await status('mrf-old-tyre')).toBe('live');
    expect(await status('apollo-alnac')).toBe('live');
    const [car] = await db.select().from(s.categories).where(eq(s.categories.slug, 'car-suv-tyres'));
    const [top] = await db.select().from(s.categories).where(eq(s.categories.slug, 'tyres'));
    expect(car).toMatchObject({
      name: 'Car and SUV tyres',
      nameHi: 'कार और SUV टायर',
      parentId: top?.id,
    });
    expect(car?.description).toBeTruthy();
    expect(car?.descriptionHi).toMatch(/[ऀ-ॿ]/);
    const rows = await db
      .select()
      .from(s.products)
      .where(
        inArray(
          s.products.slug,
          ceat.products.map((p) => p.slug),
        ),
      );
    expect(rows.map((r) => r.status).sort()).toEqual(['draft', 'live']);
    const [pattern] = rows.filter((r) => r.slug === 'ceat-milaze-x3');
    const variantSpecs = (pattern?.spec as { variantSpecs?: Record<string, { ceatPrice?: unknown }> })
      .variantSpecs;
    expect(variantSpecs?.['CEAT-105038']?.ceatPrice).toEqual({
      siteData: { paise: 310000, gstIncluded: true },
    });
    expect(
      await db
        .select()
        .from(s.productVariants)
        .where(eq(s.productVariants.productId, pattern?.id ?? '')),
    ).toHaveLength(2);
    const [pack] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'CEAT-105038'));
    expect(pack?.mrpPaise).toBeNull();
  });

  it('MRF: archives its old product only, reuses the existing categories, creates tubes and flaps', async () => {
    const run = await applyMrfImport(tx, mrf.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({ productsCreated: 2, productsArchived: 1, categoriesCreated: 1 });
    const [old] = await db.select().from(s.products).where(eq(s.products.slug, 'mrf-old-tyre'));
    expect(old?.status).toBe('archived');
    const [tube] = await db.select().from(s.categories).where(eq(s.categories.slug, 'tubes-flaps'));
    expect(tube?.nameHi).toBe('ट्यूब और फ़्लैप');
    const [other] = await db.select().from(s.products).where(eq(s.products.slug, 'apollo-alnac'));
    expect(other).toMatchObject({ status: 'live', version: 1 });
  });

  it('the public page lists every size as a variant and hides the private spec keys (fitment, hidden price, per-size data)', async () => {
    const page = await getCatalogueProduct(tx, 'ceat-milaze-x3', { cityCode: 'RPR', locale: 'en' });
    for (const key of ['fitment', 'ceatPrice', 'sourceChecks', 'variantSpecs'])
      expect(page.spec).not.toHaveProperty(key);
    expect(page.spec).toMatchObject({ pattern: 'Milaze X3', sizeCount: 2 });
    expect(page.variants.map((v) => [v.options.size, v.options.tlTt, v.mrpPaise ?? null])).toEqual(
      expect.arrayContaining([
        ['145/70R12 69T TL', 'TL', 290000],
        ['155/70R12 73T TL', 'TL', null],
      ]),
    );
  });

  it('category=tyres lists the tyres of every sub-category; a sub-category lists only its own', async () => {
    const all = await listCatalogue(tx, { cityCode: 'RPR', locale: 'en', category: 'tyres', limit: 50 });
    const slugs = all.items.map((i) => i.slug).sort();
    expect(slugs).toEqual(
      expect.arrayContaining(['ceat-milaze-x3', 'mrf-zwyde', 'mrf-bias-poly-pouch', 'apollo-alnac']),
    );
    expect(slugs).not.toContain('ceat-old-tyre');
    expect(slugs).not.toContain('mrf-old-tyre');
    const cars = await listCatalogue(tx, {
      cityCode: 'RPR',
      locale: 'en',
      category: 'car-suv-tyres',
      limit: 50,
    });
    expect(cars.items.map((i) => i.slug).sort()).toEqual(['ceat-milaze-x3', 'mrf-zwyde']);
  });

  it('records one event per run and a second run changes nothing', async () => {
    expect(await db.select().from(events).where(eq(events.event, 'admin_ceat_imported'))).toHaveLength(1);
    expect(await db.select().from(events).where(eq(events.event, 'admin_mrf_imported'))).toHaveLength(1);
    const run = await applyCeatImport(tx, ceat.products, { staffUserId: staff });
    expect(run.counts).toMatchObject({
      productsCreated: 0,
      productsUpdated: 0,
      productsArchived: 0,
      packsCreated: 0,
      categoriesCreated: 0,
    });
    expect(run.counts.productsUnchanged).toBe(2);
    const mrfRun = await applyMrfImport(tx, mrf.products, { staffUserId: staff });
    expect(mrfRun.counts).toMatchObject({ productsCreated: 0, productsUpdated: 0, productsArchived: 0 });
  });
});

describe('a pattern picture shared by several products', () => {
  it('is stored once; removing one product keeps it for the other and the last removal retires it', async () => {
    const [a] = await db.select().from(s.products).where(eq(s.products.slug, 'ceat-milaze-x3'));
    const [b] = await db.select().from(s.products).where(eq(s.products.slug, 'mrf-zwyde'));
    const actor = { kind: 'staff', userId: staff } as const;
    const first = await saveProductPhoto(tx, {
      slug: 'ceat-milaze-x3',
      actor,
      alt: 'front view',
      altHi: 'सामने का दृश्य',
      image: image(a?.id ?? ''),
    });
    const second = await attachSharedProductPhoto(tx, {
      slug: 'mrf-zwyde',
      actor,
      alt: 'front view',
      altHi: 'सामने का दृश्य',
      fromPhotoId: first.id,
    });
    const photos = await db
      .select()
      .from(s.productPhotos)
      .where(inArray(s.productPhotos.id, [first.id, second.id]));
    expect(new Set(photos.map((p) => p.mediaId)).size).toBe(1);
    expect(photos.every((p) => p.status === 'approved')).toBe(true);
    expect(
      await db
        .select()
        .from(s.mediaObjects)
        .where(eq(s.mediaObjects.id, photos[0]?.mediaId ?? '')),
    ).toHaveLength(1);

    const kept = await removeProductPhoto(tx, {
      slug: 'ceat-milaze-x3',
      photoId: first.id,
      actor,
    });
    expect(kept.paths).toEqual([]);
    const [media] = await db
      .select()
      .from(s.mediaObjects)
      .where(eq(s.mediaObjects.id, photos[0]?.mediaId ?? ''));
    expect(media?.deletedAt).toBeNull();
    const [still] = await db.select().from(s.productPhotos).where(eq(s.productPhotos.id, second.id));
    expect(still?.deletedAt).toBeNull();

    const last = await removeProductPhoto(tx, { slug: b?.slug ?? '', photoId: second.id, actor });
    expect(last.paths).toHaveLength(3);
    const [gone] = await db
      .select()
      .from(s.mediaObjects)
      .where(eq(s.mediaObjects.id, photos[0]?.mediaId ?? ''));
    expect(gone?.deletedAt).not.toBeNull();
  });

  it('only staff may attach, and only from a live photo', async () => {
    await expect(
      attachSharedProductPhoto(tx, {
        slug: 'ceat-milaze-x3',
        actor: { kind: 'staff', userId: staff },
        alt: 'front view',
        altHi: 'सामने का दृश्य',
        fromPhotoId: randomUUID(),
      }),
    ).rejects.toThrow('Photo not found');
    await expect(
      attachSharedProductPhoto(tx, {
        slug: 'ceat-milaze-x3',
        actor: { kind: 'shop', userId: staff, shopIds: [] },
        alt: 'front view',
        altHi: 'सामने का दृश्य',
        fromPhotoId: randomUUID(),
      }),
    ).rejects.toThrow('Photo not found');
    expect(
      await db
        .select()
        .from(s.productPhotos)
        .where(and(eq(s.productPhotos.alt, 'front view'))),
    ).toHaveLength(2);
  });
});
