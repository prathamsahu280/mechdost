/**
 * Before/after photos of a workshop job (spec 06 "Job photos", design 2026-11-15): the shared constants, the status
 * windows in which photos may be added, and the response shapes the API returns and the website validates (hard
 * rule 4). No file names, paths or storage keys ever appear here: pictures are reached only through the URLs the API
 * issues after a rights check.
 */
import { z } from 'zod';
import type { ServiceRequestStatus } from './state';

export const PHOTO_STAGES = ['before', 'after'] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];

/** Largest upload (bytes), enforced while the body streams in. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
/** Longest edge of the large and the thumbnail WebP variants (px). */
export const PHOTO_LARGE_EDGE = 1600;
export const PHOTO_THUMB_EDGE = 480;
/** Largest accepted picture in pixels (decompression-bomb guard), checked from the header before decoding. */
export const PHOTO_MAX_PIXELS = 50_000_000;
export const PHOTO_CAPTION_MAX = 80;
/** A page of the public gallery (workshop profile). */
export const PHOTO_GALLERY_MAX = 12;
/** Uploads per workshop user per window (design 2026-11-15). */
export const PHOTO_UPLOADS_PER_WINDOW = 30;
export const PHOTO_UPLOAD_WINDOW_SECONDS = 600;
/** How long an issued image URL works (seconds). */
export const PHOTO_URL_TTL_SECONDS = 600;

/**
 * Statuses in which a stage accepts photos: "before" from confirmed (the workshop may photograph the vehicle on
 * arrival) through in_progress; "after" only while the work is in progress. A photo may be removed until the bill.
 */
const BEFORE_OPEN: readonly ServiceRequestStatus[] = [
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
];
const AFTER_OPEN: readonly ServiceRequestStatus[] = ['in_progress'];

export const photoStageOpen = (stage: PhotoStage, status: ServiceRequestStatus): boolean =>
  (stage === 'before' ? BEFORE_OPEN : AFTER_OPEN).includes(status);

/** Removal stays possible for the "ready" status too (the work is done, the bill is not made yet). */
export const photoRemovable = (status: ServiceRequestStatus): boolean =>
  status === 'ready' || BEFORE_OPEN.includes(status);

/** Stable error codes (the website translates them; hard rule 10). */
export const PHOTO_ERROR_CODES = [
  'PHOTOS_REQUIRED',
  'PHOTO_STAGE_CLOSED',
  'PHOTO_REQUIRED_KEEP',
  'PHOTO_LIMIT',
  'PHOTO_TYPE',
  'PHOTO_HEIC',
  'PHOTO_TOO_LARGE',
  'PHOTO_UNREADABLE',
  'PHOTOS_UNAVAILABLE',
] as const;

export const PhotoStageSchema = z.enum(PHOTO_STAGES);

export const ServicePhotoDto = z.object({
  id: z.string(),
  stage: PhotoStageSchema,
  caption: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  /** 480 px WebP and 1600 px WebP: short-lived URLs issued after the rights check. */
  thumbUrl: z.string(),
  largeUrl: z.string(),
  createdAt: z.string(),
});
export type ServicePhoto = z.infer<typeof ServicePhotoDto>;

export const ServicePhotosDto = z.object({
  photos: z.array(ServicePhotoDto),
  /** Whether the photos gate is on (admin setting) and the per-stage limit. */
  required: z.boolean(),
  maxPerStage: z.number().int(),
});
export type ServicePhotos = z.infer<typeof ServicePhotosDto>;

export const PublicGalleryPhotoDto = z.object({
  id: z.string(),
  stage: PhotoStageSchema,
  width: z.number().int(),
  height: z.number().int(),
  thumbUrl: z.string(),
  largeUrl: z.string(),
});
export const PublicGalleryDto = z.object({
  /** False while the admin keeps job photos private: the profile then shows no gallery at all. */
  enabled: z.boolean(),
  photos: z.array(PublicGalleryPhotoDto),
});
export type PublicGallery = z.infer<typeof PublicGalleryDto>;

export const PhotoAddedDto = z.object({ photo: ServicePhotoDto });
export const PhotoRemovedDto = z.object({ ok: z.boolean() });
