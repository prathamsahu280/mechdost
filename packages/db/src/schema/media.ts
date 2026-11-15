/**
 * Uploaded pictures (spec 06 "Job photos", spec 13 "Uploads", design 2026-11-15). `media_objects` is the generic
 * record of one stored image (owner kind + id, bucket, object keys, metadata of the re-encoded copy); it never holds
 * the original. `service_photos` ties one to a service request with its stage. Rows are written only by
 * `repo/service-photos.ts`; objects live in a private Supabase Storage bucket and are reached only through the API.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PHOTO_STAGES } from '@mechdost/shared/service-photos';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { serviceRequests } from './services';

export const MEDIA_OWNER_KINDS = ['service_photo', 'ticket_message'] as const;

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
