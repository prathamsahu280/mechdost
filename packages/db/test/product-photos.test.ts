/**
 * Product photos (spec 02 "Product photos", design 2026-11-15 item 1): the limit of 8 under parallel uploads, ordered
 * positions (reorder, compaction on removal), alt text in both languages, the setting that lets shops add photos
 * (off by default; shown only after staff approve), who may touch what (a foreign shop gets 404), and what the public
 * catalogue and the image lookup may see (approved only, never a removed or refused photo).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  findProductPhotoForServing,
  getCatalogueProduct,
  listPhotoQueue,
  listProductPhotos,
  prepareProductPhoto,
  removeProductPhoto,
  reorderProductPhotos,
  reviewProductPhoto,
  saveProductPhoto,
  updateProductPhotoAlt,
  type PhotoActor,
  type StoredProductImage,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { rowsOf } from '../src/repo/sql-rows';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff: PhotoActor;
let shopA: PhotoActor; // sells the product
let shopB: PhotoActor; // does not
let slug = '';
let otherSlug = '';
let productId = '';

const image = (): StoredProductImage => {
  const mediaId = randomUUID();
  const dir = `product/${productId}`;
  return {
    mediaId,
    bucket: 'photos',
    path: `${dir}/${mediaId}.webp`,
    thumbPath: `${dir}/${mediaId}-thumb.webp`,
    path640: `${dir}/${mediaId}-640.webp`,
    width: 1200,
    height: 900,
    bytes: 5000,
    thumbBytes: 800,
    sha256: 'a'.repeat(64),
    lqip: 'data:image/webp;base64,UklGRg==',
  };
};
const add = (actor: PhotoActor = staff, over: { alt?: string; altHi?: string; slug?: string } = {}) =>
  saveProductPhoto(t(), {
    slug: over.slug ?? slug,
    actor,
    alt: over.alt ?? 'Front of the oil can',
    altHi: over.altHi ?? 'तेल के डिब्बे का सामने का हिस्सा',
    image: image(),
  });
const setting = async (on: boolean) => {
  await db
    .insert(s.settings)
    .values({ cityId: null, key: 'catalogue.shop_photo_uploads', value: on })
    .onConflictDoUpdate({ target: [s.settings.cityId, s.settings.key], set: { value: on } });
};
const live = async () =>
  (await listProductPhotos(t(), { slug, actor: staff })).photos.map((p) => ({ id: p.id, sort: p.sort }));
const clear = async () => {
  await db.delete(s.productPhotos).where(eq(s.productPhotos.productId, productId));
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const [u] = await db.insert(s.users).values({ firebaseUid: 'fb-photo-staff' }).returning();
  const [v] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'CAS-ACT4T-0900'));
  const [p] = await db.select().from(s.products).where(eq(s.products.id, v!.productId));
  slug = p!.slug;
  productId = p!.id;
  const shops = await db.select().from(s.shops);
  const sellers = new Set(
    (await db.select().from(s.shopInventory).where(eq(s.shopInventory.variantId, v!.id))).map(
      (r) => r.shopId,
    ),
  );
  const seller = shops.find((x) => sellers.has(x.id))!;
  const outsider = shops.find((x) => !sellers.has(x.id))!;
  const [other] = await db
    .select()
    .from(s.products)
    .where(sql`${s.products.id} <> ${productId} and ${s.products.status} = 'live'`)
    .limit(1);
  otherSlug = other!.slug;
  staff = { kind: 'staff', userId: u!.id };
  shopA = { kind: 'shop', userId: u!.id, shopIds: [seller.id] };
  shopB = { kind: 'shop', userId: u!.id, shopIds: [outsider.id] };
});

afterAll(async () => {
  await client.close();
});

describe('staff photos', () => {
  it('adds photos in order, approved, with audit and event rows', async () => {
    const a = await add();
    const b = await add();
    expect([a.sort, b.sort]).toEqual([0, 1]);
    expect(a.status).toBe('approved');
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'product_photo.add'));
    expect(audit).toHaveLength(2);
    const ev = rowsOf<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from events where event = 'product_photo_added'`),
    );
    expect(ev[0]?.n).toBe(2);
    const [media] = await db.select().from(s.mediaObjects).where(eq(s.mediaObjects.id, a.mediaId));
    expect(media).toMatchObject({ ownerKind: 'product_photo', ownerId: productId });
  });

  it('refuses a ninth photo, and two parallel uploads at seven end at eight', async () => {
    await clear();
    for (let i = 0; i < 7; i += 1) await add();
    const results = await Promise.allSettled([add(), add()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'PRODUCT_PHOTO_LIMIT' });
    expect(await live()).toHaveLength(8);
    await expect(add()).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_LIMIT' });
    await expect(prepareProductPhoto(t(), { slug, actor: staff })).rejects.toMatchObject({
      code: 'PRODUCT_PHOTO_LIMIT',
    });
    // positions stay 0..7 and unique
    expect((await live()).map((p) => p.sort)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('needs alt text in English and Hindi', async () => {
    await clear();
    await expect(add(staff, { alt: 'ab' })).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ALT' });
    await expect(add(staff, { altHi: '  ' })).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ALT' });
    await expect(add(staff, { alt: 'x'.repeat(161) })).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ALT' });
    expect(await live()).toHaveLength(0);
    // The database says the same (the check, not only the repository).
    await expect(
      db.insert(s.productPhotos).values({
        productId,
        mediaId: (await add()).mediaId,
        path640: `product/${productId}/${randomUUID()}-640.webp`,
        alt: 'ab',
        altHi: 'हिंदी पाठ',
        width: 10,
        height: 10,
      }),
    ).rejects.toThrow();
  });

  it('reorders by id list and refuses a list that is not exactly the live photos', async () => {
    await clear();
    const [a, b, c] = [await add(), await add(), await add()];
    const out = await reorderProductPhotos(t(), { slug, ids: [c.id, a.id, b.id], userId: staff.userId });
    expect(out.map((p) => [p.id, p.sort])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    await expect(
      reorderProductPhotos(t(), { slug, ids: [c.id, a.id], userId: staff.userId }),
    ).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ORDER' });
    await expect(
      reorderProductPhotos(t(), { slug, ids: [c.id, a.id, a.id], userId: staff.userId }),
    ).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ORDER' });
    await expect(
      reorderProductPhotos(t(), { slug, ids: [c.id, a.id, randomUUID()], userId: staff.userId }),
    ).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ORDER' });
    // a photo of another product is not "live photos of this product"
    await expect(
      reorderProductPhotos(t(), { slug: otherSlug, ids: [c.id], userId: staff.userId }),
    ).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_ORDER' });
  });

  it('removes a photo, closes the gap, stops serving it, and keeps the audit trail', async () => {
    await clear();
    const [a, b, c] = [await add(), await add(), await add()];
    expect(await findProductPhotoForServing(t(), b.id)).toMatchObject({ approved: true });
    await removeProductPhoto(t(), { slug, photoId: b.id, actor: staff });
    expect((await live()).map((p) => [p.id, p.sort])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
    expect(await findProductPhotoForServing(t(), b.id)).toBeNull();
    const [row] = await db.select().from(s.productPhotos).where(eq(s.productPhotos.id, b.id));
    expect(row?.deletedAt).not.toBeNull();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'product_photo.remove'));
    expect(audit.length).toBeGreaterThan(0);
    await expect(removeProductPhoto(t(), { slug, photoId: b.id, actor: staff })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('edits alt text with the version (stale is a conflict)', async () => {
    await clear();
    const a = await add();
    const saved = await updateProductPhotoAlt(t(), {
      slug,
      photoId: a.id,
      version: a.version,
      alt: 'Side view of the can',
      altHi: 'डिब्बे का बग़ल का दृश्य',
      userId: staff.userId,
    });
    expect(saved.alt).toBe('Side view of the can');
    await expect(
      updateProductPhotoAlt(t(), {
        slug,
        photoId: a.id,
        version: a.version,
        alt: 'Again',
        altHi: 'फिर से',
        userId: staff.userId,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PHOTO' });
  });
});

describe('shop photos', () => {
  it('are refused while the setting is off (the default)', async () => {
    await clear();
    await expect(add(shopA)).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_SHOP_UPLOADS_OFF' });
    await expect(prepareProductPhoto(t(), { slug, actor: shopA })).rejects.toMatchObject({
      code: 'PRODUCT_PHOTO_SHOP_UPLOADS_OFF',
    });
  });

  it('wait for approval when on, and only for products the shop sells', async () => {
    await clear();
    await setting(true);
    await expect(add(shopB)).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_NOT_SOLD' });
    const p = await add(shopA);
    expect(p.status).toBe('pending');
    expect(p.submittedByShopId).toBe(shopA.kind === 'shop' ? shopA.shopIds[0] : null);
    // not served, not in the public catalogue
    expect(await findProductPhotoForServing(t(), p.id)).toMatchObject({ approved: false });
    const pub = await getCatalogueProduct(t(), slug, { locale: 'en', pincode: null, cityCode: 'RPR' });
    expect(pub?.photos ?? []).toHaveLength(0);
    // the queue shows it with the shop
    const q = await listPhotoQueue(t());
    expect(q.items.map((i) => i.photoId)).toContain(p.id);
  });

  it('approval makes it public; a refusal removes it with a reason code', async () => {
    await clear();
    await setting(true);
    const a = await add(shopA);
    const b = await add(shopA);
    await reviewProductPhoto(t(), { photoId: a.id, decision: 'approved', userId: staff.userId });
    const served = await findProductPhotoForServing(t(), a.id);
    expect(served).toMatchObject({ approved: true });
    const pub = await getCatalogueProduct(t(), slug, { locale: 'hi', pincode: null, cityCode: 'RPR' });
    expect(pub?.photos).toHaveLength(1);
    expect(pub?.photos[0]).toMatchObject({ path: a.id, alt: 'तेल के डिब्बे का सामने का हिस्सा' });
    await reviewProductPhoto(t(), {
      photoId: b.id,
      decision: 'rejected',
      reasonCode: 'low_quality',
      userId: staff.userId,
    });
    expect(await findProductPhotoForServing(t(), b.id)).toBeNull();
    const [row] = await db.select().from(s.productPhotos).where(eq(s.productPhotos.id, b.id));
    expect(row).toMatchObject({ rejectReason: 'low_quality' });
    expect(row?.deletedAt).not.toBeNull();
    // a decided photo cannot be decided again
    await expect(
      reviewProductPhoto(t(), { photoId: a.id, decision: 'approved', userId: staff.userId }),
    ).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_NOT_PENDING' });
    // a refusal needs a reason code
    const c = await add(shopA);
    await expect(
      reviewProductPhoto(t(), { photoId: c.id, decision: 'rejected', userId: staff.userId }),
    ).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_REASON' });
  });

  it('may remove their own pending photo, never an approved one or another shop’s', async () => {
    await clear();
    await setting(true);
    const mine = await add(shopA);
    await expect(removeProductPhoto(t(), { slug, photoId: mine.id, actor: shopB })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await removeProductPhoto(t(), { slug, photoId: mine.id, actor: shopA });
    const again = await add(shopA);
    await reviewProductPhoto(t(), { photoId: again.id, decision: 'approved', userId: staff.userId });
    await expect(removeProductPhoto(t(), { slug, photoId: again.id, actor: shopA })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // a shop sees the approved photos and its own pending ones, nobody else's pending
    const pendingOfA = await add(shopA);
    const view = await listProductPhotos(t(), { slug, actor: shopA });
    expect(view.photos.map((p) => p.id).sort()).toEqual([again.id, pendingOfA.id].sort());
    await expect(listProductPhotos(t(), { slug, actor: shopB })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('count against the same limit of eight', async () => {
    await clear();
    await setting(true);
    for (let i = 0; i < 8; i += 1) await add(staff);
    await expect(add(shopA)).rejects.toMatchObject({ code: 'PRODUCT_PHOTO_LIMIT' });
    await setting(false);
  });
});

describe('public catalogue', () => {
  it('lists approved photos in order with the cover first and carries the placeholder', async () => {
    await clear();
    const a = await add();
    const b = await add();
    await reorderProductPhotos(t(), { slug, ids: [b.id, a.id], userId: staff.userId });
    const pub = await getCatalogueProduct(t(), slug, { locale: 'en', pincode: null, cityCode: 'RPR' });
    expect(pub?.photos.map((p) => p.path)).toEqual([b.id, a.id]);
    expect(pub?.photos[0]).toMatchObject({
      width: 1200,
      height: 900,
      lqip: expect.stringContaining('data:'),
    });
    const [only] = await db
      .select()
      .from(s.productPhotos)
      .where(and(eq(s.productPhotos.productId, productId), eq(s.productPhotos.sort, 0)));
    expect(only?.id).toBe(b.id);
  });
});
