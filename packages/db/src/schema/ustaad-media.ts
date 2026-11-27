/**
 * Ustaad media (spec 23 § 6.4, § 10; migration `ustaad_foundations`). A new table: the existing `media_objects` is
 * CHECK-locked to WebP ≤ 8 MB and stays unchanged. Object keys are random (`{prefix}/{memberId}/{uuid}.{ext}`), the
 * declared MIME type and size are bound to the signed upload, and the per-kind caps are CHECKs too. Written only by
 * `repo/ustaad/media.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  MEDIA_BUCKETS,
  MEDIA_HARD_CAP_BYTES,
  MEDIA_HOSTS,
  MEDIA_KINDS,
  MEDIA_MIMES,
  MEDIA_REJECT_REASONS,
  MEDIA_VARIANTS,
} from '@mechdost/shared/ustaad/codes';
import { USTAAD_MEDIA_STATUSES } from '@mechdost/shared/state';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { nullOrOneOf, oneOf, quoted } from './ustaad-common';
import { ustaadMembers } from './ustaad-members';

const mimeByKind = sql.raw(
  (Object.keys(MEDIA_MIMES) as (keyof typeof MEDIA_MIMES)[])
    .map((k) => `(kind = '${k}' and declared_mime in (${quoted(MEDIA_MIMES[k])}))`)
    .join(' or '),
);
const capByKind = sql.raw(
  (Object.keys(MEDIA_HARD_CAP_BYTES) as (keyof typeof MEDIA_HARD_CAP_BYTES)[])
    .map((k) => `(kind = '${k}' and declared_bytes <= ${String(MEDIA_HARD_CAP_BYTES[k])})`)
    .join(' or '),
);

export const ustaadMedia = pgTable(
  'ustaad_media',
  {
    id: id(),
    ownerMemberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'restrict' }),
    host: text().notNull(),
    bucket: text().notNull().default('quarantine'),
    kind: text().notNull(),
    status: text().notNull().default('pending_upload'),
    declaredBytes: bigint({ mode: 'number' }).notNull(),
    declaredMime: text().notNull(),
    sha256: text().notNull(),
    durationMs: integer(),
    width: integer(),
    height: integer(),
    objectKey: text().notNull(),
    /** Multipart upload id while a resumable upload is open. */
    uploadId: text(),
    uploadExpiresAt: ts().notNull(),
    uploadedAt: ts(),
    verifiedAt: ts(),
    rejectReasonCode: text(),
    /** Removed content keeps its file until then (archive, 180 days); null = no archive hold. */
    removedRetainUntil: ts(),
    /** Purge job deletes the object after this (story expiry + grace, video archive, pending > 1 h). */
    purgeAfter: ts(),
    legalHold: text(),
    /** ≤ 400 bytes base64 WebP placeholder for images and video posters. */
    lqip: text(),
    /** Author's typed summary of a voice note or video (≤ 200 chars; founder 2026-11-27 night, spec 23 § 10a). */
    summary: text(),
    /** Video only: the captions as typed ("time — text" lines or one block); WebVTT is built when read. */
    captions: text(),
    captionsLang: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_media_object_key_uq').on(t.objectKey),
    index().on(t.ownerMemberId, t.createdAt),
    index('ustaad_media_pending_idx')
      .on(t.uploadExpiresAt)
      .where(sql`${t.status} = 'pending_upload'`),
    index('ustaad_media_purge_idx')
      .on(t.purgeAfter)
      .where(sql`${t.purgeAfter} is not null and ${t.status} <> 'purged'`),
    check('ustaad_media_host_valid', oneOf(t.host, MEDIA_HOSTS)),
    check('ustaad_media_bucket_valid', oneOf(t.bucket, MEDIA_BUCKETS)),
    check('ustaad_media_kind_valid', oneOf(t.kind, MEDIA_KINDS)),
    check('ustaad_media_status_valid', oneOf(t.status, USTAAD_MEDIA_STATUSES)),
    check('ustaad_media_mime_per_kind', sql`${mimeByKind}`),
    check('ustaad_media_bytes_cap', sql`${t.declaredBytes} > 0 and (${capByKind})`),
    check('ustaad_media_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    // q/ m/ d/ e/ prefix, the owner's id, a uuid and a known extension: nothing guessable, nothing user-typed.
    check(
      'ustaad_media_object_key_format',
      sql`${t.objectKey} ~ '^[qmde]/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|jpg|mp4|webm|ogg|m4a|pdf)$'`,
    ),
    check('ustaad_media_reject_reason_valid', nullOrOneOf(t.rejectReasonCode, MEDIA_REJECT_REASONS)),
    check(
      'ustaad_media_rejected_reason',
      sql`(${t.status} = 'rejected') = (${t.rejectReasonCode} is not null)`,
    ),
    check('ustaad_media_duration', sql`${t.durationMs} is null or ${t.durationMs} between 1 and 600000`),
    check('ustaad_media_lqip_size', sql`${t.lqip} is null or octet_length(${t.lqip}) <= 400`),
    check(
      'ustaad_media_summary',
      sql`${t.summary} is null or (${t.kind} in ('audio', 'video') and char_length(${t.summary}) between 1 and 200)`,
    ),
    check(
      'ustaad_media_captions',
      sql`(${t.captions} is null and ${t.captionsLang} is null) or (${t.kind} = 'video' and ${t.captionsLang} in ('hi', 'en') and char_length(${t.captions}) between 1 and 4000)`,
    ),
  ],
);

/** Server-written image variants (re-encoded with sharp, metadata stripped). */
export const ustaadMediaVariants = pgTable(
  'ustaad_media_variants',
  {
    id: id(),
    mediaId: uuid()
      .notNull()
      .references(() => ustaadMedia.id, { onDelete: 'cascade' }),
    variant: text().notNull(),
    objectKey: text().notNull(),
    bytes: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ustaad_media_variants_uq').on(t.mediaId, t.variant),
    uniqueIndex('ustaad_media_variants_key_uq').on(t.objectKey),
    check('ustaad_media_variants_valid', oneOf(t.variant, MEDIA_VARIANTS)),
    check('ustaad_media_variants_bytes', sql`${t.bytes} > 0 and ${t.bytes} <= 3145728`),
  ],
);

/** Per-member daily quota, IST day (conditional increment; SR-20). */
export const ustaadMediaUsage = pgTable(
  'ustaad_media_usage',
  {
    memberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    bytes: bigint({ mode: 'number' }).notNull().default(0),
    uploads: integer().notNull().default(0),
    videos: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.day] }),
    index().on(t.day),
    check('ustaad_media_usage_non_negative', sql`${t.bytes} >= 0 and ${t.uploads} >= 0 and ${t.videos} >= 0`),
  ],
);

/**
 * Network-wide stored bytes per kind (SR-20 budget): one row per kind, changed by conditional increments in the same
 * transaction as the media row, so the budget check never sums the whole media table.
 */
export const ustaadMediaTotals = pgTable(
  'ustaad_media_totals',
  {
    kind: text().primaryKey(),
    bytes: bigint({ mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('ustaad_media_totals_kind_valid', oneOf(t.kind, MEDIA_KINDS)),
    check('ustaad_media_totals_non_negative', sql`${t.bytes} >= 0`),
  ],
);
