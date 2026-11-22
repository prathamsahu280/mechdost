import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import {
  PRODUCT_PHOTO_ALT_MAX,
  PRODUCT_PHOTO_ALT_MIN,
  PRODUCT_PHOTO_MAX,
  PRODUCT_PHOTO_REJECT_REASONS,
  type ProductPhotoRejectReason,
  type ProductPhotoStatus,
} from '@mechdost/shared/product-photos';
import {
  auditLog,
  mediaObjects,
  productPhotos,
  productVariants,
  products,
  settings,
  shopInventory,
  shops,
} from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * Product photos (spec 02 "Product photos", design 2026-11-15 item 1). The repository owns every rule: at most
 * `PRODUCT_PHOTO_MAX` live photos per product (counted under the product row lock, so parallel uploads cannot pass
 * it), the explicit `sort` order (reorder takes exactly the live ids; removal closes the gap), alt text in English
 * and Hindi, who may add (staff always; shops only when the setting is on, only for products they sell, and only as
 * `pending` until staff approve), who may remove (staff any; a shop only its own pending photo), and what may be
 * served (approved photos of live products; the API serves anything else only under a signed preview URL). It never
 * sees file bytes or storage credentials: the API processes and stores the image first and hands over the keys.
 */
export type PhotoActor =
  { kind: 'staff'; userId: string } | { kind: 'shop'; userId: string; shopIds: readonly string[] };

/** The finished, stored copies of one uploaded picture (keys only). */
export interface StoredProductImage {
  mediaId: string;
  bucket: string;
  /** 1600 px variant. */
  path: string;
  /** 320 px variant. */
  thumbPath: string;
  path640: string;
  width: number;
  height: number;
  bytes: number;
  thumbBytes: number;
  sha256: string;
  lqip: string | null;
}

export interface ProductPhotoRow {
  id: string;
  mediaId: string;
  status: ProductPhotoStatus;
  alt: string;
  altHi: string;
  sort: number;
  width: number;
  height: number;
  lqip: string | null;
  submittedByShopId: string | null;
  version: number;
  createdAt: Date;
}

const COLUMNS = {
  id: productPhotos.id,
  mediaId: productPhotos.mediaId,
  status: productPhotos.status,
  alt: productPhotos.alt,
  altHi: productPhotos.altHi,
  sort: productPhotos.sort,
  width: productPhotos.width,
  height: productPhotos.height,
  lqip: productPhotos.lqip,
  submittedByShopId: productPhotos.submittedByShopId,
  version: productPhotos.version,
  createdAt: productPhotos.createdAt,
} as const;

const asRow = (r: {
  id: string;
  mediaId: string;
  status: string;
  alt: string;
  altHi: string;
  sort: number;
  width: number;
  height: number;
  lqip: string | null;
  submittedByShopId: string | null;
  version: number;
  createdAt: Date;
}): ProductPhotoRow => ({ ...r, status: r.status === 'pending' ? 'pending' : 'approved' });

/** The site-wide switch for shop uploads (global setting, default off). */
export async function shopPhotoUploadsEnabled(db: Tx): Promise<boolean> {
  const key = 'catalogue.shop_photo_uploads';
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(isNull(settings.cityId), eq(settings.key, key)));
  return typeof row?.value === 'boolean' ? row.value : OPERATIONAL_SETTINGS[key].default;
}

const trimmed = (v: string) => v.trim();
function assertAlt(alt: string, altHi: string): { alt: string; altHi: string } {
  const a = trimmed(alt);
  const h = trimmed(altHi);
  for (const v of [a, h])
    if (v.length < PRODUCT_PHOTO_ALT_MIN || v.length > PRODUCT_PHOTO_ALT_MAX)
      throw new ValidationError(
        `Describe the photo in English and Hindi (${String(PRODUCT_PHOTO_ALT_MIN)} to ${String(PRODUCT_PHOTO_ALT_MAX)} characters each)`,
        'PRODUCT_PHOTO_ALT',
      );
  return { alt: a, altHi: h };
}

/** The product's row, locked when asked (the lock serialises every photo change of one product). */
async function productBySlug(tx: Tx, slug: string, lock: boolean) {
  const q = tx.select({ id: products.id }).from(products).where(eq(products.slug, slug));
  const [p] = lock ? await q.for('update') : await q;
  if (!p) throw new NotFoundError('Product not found');
  return p;
}

/** The shop (of the actor's) that sells a variant of the product, or null. */
async function sellingShop(tx: Tx, productId: string, shopIds: readonly string[]): Promise<string | null> {
  if (shopIds.length === 0) return null;
  const [row] = await tx
    .select({ shopId: shopInventory.shopId })
    .from(shopInventory)
    .innerJoin(productVariants, eq(productVariants.id, shopInventory.variantId))
    .where(and(eq(productVariants.productId, productId), inArray(shopInventory.shopId, [...shopIds])))
    .limit(1);
  return row?.shopId ?? null;
}

async function liveCount(tx: Tx, productId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(productPhotos)
    .where(and(eq(productPhotos.productId, productId), isNull(productPhotos.deletedAt)));
  return row?.n ?? 0;
}

/** Rights, setting and limit (called twice: before the image work, again under the lock). Returns the shop id, if any. */
async function assertCanAdd(
  tx: Tx,
  productId: string,
  actor: PhotoActor,
): Promise<{ shopId: string | null }> {
  let shopId: string | null = null;
  if (actor.kind === 'shop') {
    if (!(await shopPhotoUploadsEnabled(tx)))
      throw new ConflictError('Shops cannot add product photos right now', 'PRODUCT_PHOTO_SHOP_UPLOADS_OFF');
    shopId = await sellingShop(tx, productId, actor.shopIds);
    if (!shopId)
      throw new ValidationError(
        'You can add photos only to products your shop sells',
        'PRODUCT_PHOTO_NOT_SOLD',
      );
  }
  if ((await liveCount(tx, productId)) >= PRODUCT_PHOTO_MAX)
    throw new ConflictError(
      `A product can have up to ${String(PRODUCT_PHOTO_MAX)} photos`,
      'PRODUCT_PHOTO_LIMIT',
    );
  return { shopId };
}

/** Before any image work: the product exists, the actor may add, and there is room. */
export async function prepareProductPhoto(
  db: Tx,
  input: { slug: string; actor: PhotoActor },
): Promise<{ productId: string }> {
  const p = await productBySlug(db, input.slug, false);
  await assertCanAdd(db, p.id, input.actor);
  return { productId: p.id };
}

/** Closes gaps so the live photos of a product are at positions 0..n-1 in their current order. */
async function compact(tx: Tx, productId: string): Promise<void> {
  await tx.execute(sql`
    update product_photos p set sort = r.pos
    from (select id, (row_number() over (order by sort, created_at, id) - 1)::int as pos
          from product_photos where product_id = ${productId} and deleted_at is null) r
    where p.id = r.id and p.sort <> r.pos`);
}

/** Add a photo (the keys of the stored copies). Staff photos are approved at once; a shop's wait for review. */
export async function saveProductPhoto(
  db: Tx,
  input: {
    slug: string;
    actor: PhotoActor;
    alt: string;
    altHi: string;
    image: StoredProductImage;
    /** Admin-only: where the picture came from (catalogue import; never shown to customers). */
    photoSource?: string | null;
  },
): Promise<ProductPhotoRow> {
  const { alt, altHi } = assertAlt(input.alt, input.altHi);
  return db.transaction(async (tx) => {
    const p = await productBySlug(tx, input.slug, true);
    const { shopId } = await assertCanAdd(tx, p.id, input.actor);
    const img = input.image;
    const staff = input.actor.kind === 'staff';
    await tx.insert(mediaObjects).values({
      id: img.mediaId,
      ownerKind: 'product_photo',
      ownerId: p.id,
      bucket: img.bucket,
      path: img.path,
      thumbPath: img.thumbPath,
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      thumbBytes: img.thumbBytes,
      sha256: img.sha256,
      uploadedBy: input.actor.userId,
    });
    const status: ProductPhotoStatus = staff ? 'approved' : 'pending';
    const [row] = await tx
      .insert(productPhotos)
      .values({
        productId: p.id,
        mediaId: img.mediaId,
        path640: img.path640,
        alt,
        altHi,
        sort: await liveCount(tx, p.id),
        lqip: img.lqip,
        photoSource: input.photoSource ?? null,
        width: img.width,
        height: img.height,
        status,
        submittedByShopId: shopId,
        reviewedBy: staff ? input.actor.userId : null,
        reviewedAt: staff ? new Date() : null,
        createdBy: input.actor.userId,
      })
      .returning(COLUMNS);
    if (!row) throw new ConflictError('The photo could not be saved', 'PHOTO_NOT_SAVED');
    await tx.insert(auditLog).values({
      actorUserId: input.actor.userId,
      actorRole: input.actor.kind,
      action: 'product_photo.add',
      entity: 'product',
      entityId: p.id,
      after: { photoId: row.id, status, sort: row.sort, shopId },
    });
    await recordServerEvent(tx, 'product_photo_added', {
      userId: input.actor.userId,
      props: { productId: p.id, photoId: row.id, by: input.actor.kind, status },
    });
    return asRow(row);
  });
}

/**
 * The photos of a product as the actor may see them: staff see every live photo (pending included); a shop must sell
 * the product (else 404) and sees the approved photos and its own pending ones.
 */
export async function listProductPhotos(
  db: Tx,
  input: { slug: string; actor: PhotoActor },
): Promise<{ photos: ProductPhotoRow[]; shopUploadsEnabled: boolean }> {
  const p = await productBySlug(db, input.slug, false);
  const mine = input.actor.kind === 'shop' ? input.actor.shopIds : [];
  if (input.actor.kind === 'shop' && !(await sellingShop(db, p.id, mine)))
    throw new NotFoundError('Product not found');
  const rows = await db
    .select(COLUMNS)
    .from(productPhotos)
    .where(and(eq(productPhotos.productId, p.id), isNull(productPhotos.deletedAt)))
    .orderBy(asc(productPhotos.sort), asc(productPhotos.id));
  const visible =
    input.actor.kind === 'staff'
      ? rows
      : rows.filter(
          (r) =>
            r.status === 'approved' || (r.submittedByShopId !== null && mine.includes(r.submittedByShopId)),
        );
  return { photos: visible.map(asRow), shopUploadsEnabled: await shopPhotoUploadsEnabled(db) };
}

/** Staff: set the order. `ids` must be exactly the product's live photos, each once. */
export async function reorderProductPhotos(
  db: Tx,
  input: { slug: string; ids: readonly string[]; userId: string },
): Promise<ProductPhotoRow[]> {
  return db.transaction(async (tx) => {
    const p = await productBySlug(tx, input.slug, true);
    const current = await tx
      .select({ id: productPhotos.id })
      .from(productPhotos)
      .where(and(eq(productPhotos.productId, p.id), isNull(productPhotos.deletedAt)));
    const want = new Set(input.ids);
    if (
      want.size !== input.ids.length ||
      current.length !== input.ids.length ||
      current.some((c) => !want.has(c.id))
    )
      throw new ValidationError(
        'The order must list each of the product’s photos once',
        'PRODUCT_PHOTO_ORDER',
      );
    const order = input.ids.map((id, ord) => ({ id, ord }));
    await tx.execute(sql`
      update product_photos p set sort = v.ord
      from jsonb_to_recordset(${JSON.stringify(order)}::jsonb) as v(id uuid, ord int)
      where p.id = v.id and p.product_id = ${p.id} and p.sort <> v.ord`);
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'staff',
      action: 'product_photo.reorder',
      entity: 'product',
      entityId: p.id,
      after: { ids: [...input.ids] },
    });
    await recordServerEvent(tx, 'product_photos_reordered', {
      userId: input.userId,
      props: { productId: p.id, count: input.ids.length },
    });
    const rows = await tx
      .select(COLUMNS)
      .from(productPhotos)
      .where(and(eq(productPhotos.productId, p.id), isNull(productPhotos.deletedAt)))
      .orderBy(asc(productPhotos.sort), asc(productPhotos.id));
    return rows.map(asRow);
  });
}

/** Staff: edit the alt text of a photo (compare-and-set on `version`). */
export async function updateProductPhotoAlt(
  db: Tx,
  input: { slug: string; photoId: string; version: number; alt: string; altHi: string; userId: string },
): Promise<ProductPhotoRow> {
  const { alt, altHi } = assertAlt(input.alt, input.altHi);
  return db.transaction(async (tx) => {
    const p = await productBySlug(tx, input.slug, true);
    const [row] = await tx
      .update(productPhotos)
      .set({ alt, altHi })
      .where(
        and(
          eq(productPhotos.id, input.photoId),
          eq(productPhotos.productId, p.id),
          isNull(productPhotos.deletedAt),
          eq(productPhotos.version, input.version),
        ),
      )
      .returning(COLUMNS);
    if (!row) {
      const [exists] = await tx
        .select({ id: productPhotos.id })
        .from(productPhotos)
        .where(
          and(
            eq(productPhotos.id, input.photoId),
            eq(productPhotos.productId, p.id),
            isNull(productPhotos.deletedAt),
          ),
        );
      if (!exists) throw new NotFoundError('Photo not found');
      throw new ConflictError('The photo changed; reload and try again', 'STALE_PHOTO');
    }
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'staff',
      action: 'product_photo.alt',
      entity: 'product',
      entityId: p.id,
      after: { photoId: row.id },
    });
    return asRow(row);
  });
}

/** Object keys of a photo, for the best-effort delete in Storage after the row is gone. */
export interface RemovedPhotoKeys {
  bucket: string;
  paths: string[];
}

/** Soft delete (audited). Staff any photo; a shop only its own pending one. Returns the keys to delete from Storage. */
export async function removeProductPhoto(
  db: Tx,
  input: { slug: string; photoId: string; actor: PhotoActor },
): Promise<RemovedPhotoKeys> {
  return db.transaction(async (tx) => {
    const p = await productBySlug(tx, input.slug, true);
    const [photo] = await tx
      .select({
        id: productPhotos.id,
        status: productPhotos.status,
        shopId: productPhotos.submittedByShopId,
        mediaId: productPhotos.mediaId,
        path640: productPhotos.path640,
      })
      .from(productPhotos)
      .where(
        and(
          eq(productPhotos.id, input.photoId),
          eq(productPhotos.productId, p.id),
          isNull(productPhotos.deletedAt),
        ),
      )
      .for('update');
    if (!photo) throw new NotFoundError('Photo not found');
    if (input.actor.kind === 'shop') {
      const own = photo.shopId !== null && input.actor.shopIds.includes(photo.shopId);
      if (!own || photo.status !== 'pending') throw new NotFoundError('Photo not found');
    }
    const now = new Date();
    await tx.update(productPhotos).set({ deletedAt: now }).where(eq(productPhotos.id, photo.id));
    const [media] = await tx
      .update(mediaObjects)
      .set({ deletedAt: now })
      .where(eq(mediaObjects.id, photo.mediaId))
      .returning({ bucket: mediaObjects.bucket, path: mediaObjects.path, thumbPath: mediaObjects.thumbPath });
    await compact(tx, p.id);
    await tx.insert(auditLog).values({
      actorUserId: input.actor.userId,
      actorRole: input.actor.kind,
      action: 'product_photo.remove',
      entity: 'product',
      entityId: p.id,
      after: { photoId: photo.id, status: photo.status },
    });
    await recordServerEvent(tx, 'product_photo_removed', {
      userId: input.actor.userId,
      props: { productId: p.id, photoId: photo.id },
    });
    return {
      bucket: media?.bucket ?? '',
      paths: media ? [media.path, media.thumbPath, photo.path640] : [],
    };
  });
}

/** Staff: approve or refuse a shop's pending photo. A refusal needs a reason code and removes the photo. */
export async function reviewProductPhoto(
  db: Tx,
  input: {
    photoId: string;
    decision: 'approved' | 'rejected';
    reasonCode?: ProductPhotoRejectReason | undefined;
    userId: string;
  },
): Promise<RemovedPhotoKeys | null> {
  if (
    input.decision === 'rejected' &&
    !(input.reasonCode && PRODUCT_PHOTO_REJECT_REASONS.includes(input.reasonCode))
  )
    throw new ValidationError('Choose why the photo is refused', 'PRODUCT_PHOTO_REASON');
  return db.transaction(async (tx) => {
    const [first] = await tx
      .select({ productId: productPhotos.productId })
      .from(productPhotos)
      .where(eq(productPhotos.id, input.photoId));
    if (!first) throw new NotFoundError('Photo not found');
    // Product lock first, like every other photo change.
    await tx.select({ id: products.id }).from(products).where(eq(products.id, first.productId)).for('update');
    const [photo] = await tx
      .select({
        id: productPhotos.id,
        status: productPhotos.status,
        deletedAt: productPhotos.deletedAt,
        mediaId: productPhotos.mediaId,
        path640: productPhotos.path640,
      })
      .from(productPhotos)
      .where(eq(productPhotos.id, input.photoId))
      .for('update');
    if (!photo || photo.deletedAt) throw new NotFoundError('Photo not found');
    if (photo.status !== 'pending')
      throw new ConflictError('This photo was already reviewed', 'PRODUCT_PHOTO_NOT_PENDING');
    const now = new Date();
    let keys: RemovedPhotoKeys | null = null;
    if (input.decision === 'approved') {
      await tx
        .update(productPhotos)
        .set({ status: 'approved', reviewedBy: input.userId, reviewedAt: now })
        .where(eq(productPhotos.id, photo.id));
    } else {
      await tx
        .update(productPhotos)
        .set({
          deletedAt: now,
          reviewedBy: input.userId,
          reviewedAt: now,
          rejectReason: input.reasonCode ?? null,
        })
        .where(eq(productPhotos.id, photo.id));
      const [media] = await tx
        .update(mediaObjects)
        .set({ deletedAt: now })
        .where(eq(mediaObjects.id, photo.mediaId))
        .returning({
          bucket: mediaObjects.bucket,
          path: mediaObjects.path,
          thumbPath: mediaObjects.thumbPath,
        });
      await compact(tx, first.productId);
      keys = media ? { bucket: media.bucket, paths: [media.path, media.thumbPath, photo.path640] } : null;
    }
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'staff',
      action: `product_photo.${input.decision === 'approved' ? 'approve' : 'reject'}`,
      entity: 'product',
      entityId: first.productId,
      after: { photoId: photo.id, reasonCode: input.reasonCode ?? null },
    });
    await recordServerEvent(tx, 'product_photo_reviewed', {
      userId: input.userId,
      props: {
        productId: first.productId,
        photoId: photo.id,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
      },
    });
    return keys;
  });
}

export interface PhotoQueueItem {
  photoId: string;
  productSlug: string;
  productName: string;
  alt: string;
  altHi: string;
  width: number;
  height: number;
  lqip: string | null;
  shopId: string | null;
  shopName: string | null;
  createdAt: Date;
}

/** Pending shop photos, oldest first (the approval queue). Catalogue is global, so no city scope. */
export async function listPhotoQueue(db: Tx, limit = 100): Promise<{ items: PhotoQueueItem[] }> {
  const rows = await db
    .select({
      photoId: productPhotos.id,
      productSlug: products.slug,
      productName: products.name,
      alt: productPhotos.alt,
      altHi: productPhotos.altHi,
      width: productPhotos.width,
      height: productPhotos.height,
      lqip: productPhotos.lqip,
      shopId: productPhotos.submittedByShopId,
      shopName: shops.name,
      createdAt: productPhotos.createdAt,
    })
    .from(productPhotos)
    .innerJoin(products, eq(products.id, productPhotos.productId))
    .leftJoin(shops, eq(shops.id, productPhotos.submittedByShopId))
    .where(and(eq(productPhotos.status, 'pending'), isNull(productPhotos.deletedAt)))
    .orderBy(asc(productPhotos.createdAt), asc(productPhotos.id))
    .limit(limit);
  return { items: rows };
}

export interface ServedProductPhoto {
  /** May the public see it (approved, product live)? A signed preview URL may serve it anyway. */
  approved: boolean;
  bucket: string;
  paths: { 320: string; 640: string; 1600: string };
}

/** The keys behind a photo id for the image route; null for an unknown or removed photo. */
export async function findProductPhotoForServing(
  db: Tx,
  photoId: string,
): Promise<ServedProductPhoto | null> {
  const [r] = rowsOf<{
    status: string;
    product_status: string;
    bucket: string;
    path: string;
    thumb_path: string;
    path640: string;
  }>(
    await db.execute(sql`
      select ph.status, p.status as product_status, m.bucket, m.path, m.thumb_path, ph.path640
      from product_photos ph
      join products p on p.id = ph.product_id
      join media_objects m on m.id = ph.media_id
      where ph.id = ${photoId} and ph.deleted_at is null and m.deleted_at is null`),
  );
  if (!r) return null;
  return {
    approved: r.status === 'approved' && r.product_status === 'live',
    bucket: r.bucket,
    paths: { 320: r.thumb_path, 640: r.path640, 1600: r.path },
  };
}
