/**
 * Uploaded pictures (spec 06 "Job photos", spec 13 "Uploads", design 2026-11-15). `media_objects` is the generic
 * record of one stored image (owner kind + id, bucket, object keys, metadata of the re-encoded copy); it never holds
 * the original. `service_photos` ties one to a service request with its stage. Rows are written only by
 * `repo/service-photos.ts`; objects live in a private Supabase Storage bucket and are reached only through the API.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PRODUCT_PHOTO_MAX, PRODUCT_PHOTO_STATUSES } from '@mechdost/shared/product-photos';
import { PHOTO_STAGES } from '@mechdost/shared/service-photos';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { productVariants, products, shops } from './catalogue';
import { users } from './identity';
import { serviceRequests } from './services';

export const MEDIA_OWNER_KINDS = [
  'service_photo',
  'ticket_message',
  'product_photo',
  'quote_message',
] as const;

export const mediaObjects = pgTable(
  'media_objects',
  {
    id: id(),
    ownerKind: text().notNull(),
    /** Id of the owning row (not a foreign key: the table is generic across owner kinds). */
    ownerId: uuid().notNull(),
    bucket: text().notNull(),
    /** Random object keys, never derived from the file name. */
    path: text().notNull(),
    thumbPath: text().notNull(),
    mime: text().notNull().default('image/webp'),
    width: integer().notNull(),
    height: integer().notNull(),
    bytes: integer().notNull(),
    thumbBytes: integer().notNull(),
    /** SHA-256 (hex) of the re-encoded large copy; the original is never kept. */
    sha256: text().notNull(),
    uploadedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [
    check(
      'media_objects_owner_kind_valid',
      sql`${t.ownerKind} in (${sql.raw(MEDIA_OWNER_KINDS.map((k) => `'${k}'`).join(','))})`,
    ),
    check('media_objects_mime_valid', sql`${t.mime} = 'image/webp'`),
    check('media_objects_dims', sql`${t.width} between 1 and 4000 and ${t.height} between 1 and 4000`),
    check(
      'media_objects_bytes',
      sql`${t.bytes} between 1 and 8388608 and ${t.thumbBytes} between 1 and 8388608`,
    ),
    check('media_objects_sha_hex', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'media_objects_path_safe',
      sql`${t.path} ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$' and ${t.thumbPath} ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}-thumb[.]webp$'`,
    ),
    uniqueIndex('media_objects_path_uq').on(t.bucket, t.path),
    index().on(t.ownerKind, t.ownerId),
    index().on(t.uploadedBy),
  ],
);

export const servicePhotos = pgTable(
  'service_photos',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'restrict' }),
    stage: text().notNull(),
    mediaId: uuid()
      .notNull()
      .references(() => mediaObjects.id, { onDelete: 'restrict' }),
    caption: text(),
    sortOrder: smallint().notNull().default(0),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [
    check(
      'service_photos_stage_valid',
      sql`${t.stage} in (${sql.raw(PHOTO_STAGES.map((s) => `'${s}'`).join(','))})`,
    ),
    check(
      'service_photos_caption_len',
      sql`${t.caption} is null or char_length(${t.caption}) between 1 and 80`,
    ),
    uniqueIndex('service_photos_media_uq').on(t.mediaId),
    index('service_photos_request_stage_idx')
      .on(t.requestId, t.stage, t.sortOrder)
      .where(sql`${t.deletedAt} is null`),
    index().on(t.createdBy),
  ],
);

/**
 * A product's photos (spec 02 "Product photos", design 2026-11-15). One row per picture: the 1600 and 320 WebP live in
 * its `media_objects` row (`path`, `thumb_path`), the 640 here, plus a tiny inline placeholder. Position is the explicit
 * `sort` (0 = cover), changed only by the repository under the product row lock, which also holds the limit of
 * `PRODUCT_PHOTO_MAX` live rows. A shop's photo is `pending` until staff approve it; a refused or removed photo is
 * soft deleted (kept for the audit trail) and never served.
 */
export const productPhotos = pgTable(
  'product_photos',
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => productVariants.id, { onDelete: 'cascade' }),
    mediaId: uuid()
      .notNull()
      .references(() => mediaObjects.id, { onDelete: 'restrict' }),
    /** Object key of the 640 px variant (the 1600 and 320 keys are on the media row). */
    path640: text().notNull(),
    alt: text().notNull(),
    altHi: text().notNull(),
    sort: smallint().notNull().default(0),
    /** A 16 px WebP as a data URL, shown while the photo loads. */
    lqip: text(),
    width: integer().notNull(),
    height: integer().notNull(),
    status: text().notNull().default('approved'),
    submittedByShopId: uuid().references(() => shops.id, { onDelete: 'set null' }),
    reviewedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: ts(),
    /** Admin-only: where the picture came from (maker page, marketplace URL); never shown to customers. */
    photoSource: text(),
    /** Why staff refused it (a code); set together with `deleted_at`. */
    rejectReason: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [
    check(
      'product_photos_status_valid',
      sql`${t.status} in (${sql.raw(PRODUCT_PHOTO_STATUSES.map((s) => `'${s}'`).join(','))})`,
    ),
    check(
      'product_photos_sort_range',
      sql`${t.sort} between 0 and ${sql.raw(String(PRODUCT_PHOTO_MAX - 1))}`,
    ),
    check(
      'product_photos_alt_len',
      sql`char_length(${t.alt}) between 3 and 160 and char_length(${t.altHi}) between 3 and 160`,
    ),
    check('product_photos_lqip_len', sql`${t.lqip} is null or char_length(${t.lqip}) <= 2000`),
    check(
      'product_photos_path640_safe',
      sql`${t.path640} ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}-640[.]webp$'`,
    ),
    check('product_photos_rejected_has_reason', sql`${t.rejectReason} is null or ${t.deletedAt} is not null`),
    // A stored image may serve several products (a tyre pattern's pictures, shared by every size), but only once each.
    uniqueIndex('product_photos_product_media_uq').on(t.productId, t.mediaId),
    index('product_photos_media_idx').on(t.mediaId),
    index('product_photos_product_live_idx')
      .on(t.productId, t.sort)
      .where(sql`${t.deletedAt} is null`),
    index('product_photos_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending' and ${t.deletedAt} is null`),
    index().on(t.variantId),
    index().on(t.submittedByShopId),
  ],
);
