/**
 * Product photos (spec 02 "Product photos", design 2026-11-15 item 1): the constants, the shapes the API returns and
 * the website validates (hard rule 4). Unlike job photos these are public once approved, so a photo is reached by its
 * id alone: `/v1/product-photos/{id}/{width}` where the width is one of the three stored variants. No storage key or
 * bucket name ever appears here.
 */
import { z } from 'zod';

/** At most this many photos per product (live rows, pending and approved together). */
export const PRODUCT_PHOTO_MAX = 8;
/** The stored WebP variants (px, longest edge); `next/image` picks one through the loader. */
export const PRODUCT_PHOTO_WIDTHS = [320, 640, 1600] as const;
export type ProductPhotoWidth = (typeof PRODUCT_PHOTO_WIDTHS)[number];
/** Alt text limits, in English and in Hindi (both required, hard rule 10). */
export const PRODUCT_PHOTO_ALT_MIN = 3;
export const PRODUCT_PHOTO_ALT_MAX = 160;
/** Longest edge of the low-quality placeholder (a tiny WebP stored inline as a data URL). */
export const PRODUCT_PHOTO_LQIP_EDGE = 16;
/** Uploads per user per window (staff and shops). */
export const PRODUCT_PHOTO_UPLOADS_PER_WINDOW = 40;
export const PRODUCT_PHOTO_UPLOAD_WINDOW_SECONDS = 600;

export const PRODUCT_PHOTO_STATUSES = ['pending', 'approved'] as const;
export type ProductPhotoStatus = (typeof PRODUCT_PHOTO_STATUSES)[number];

/** Why staff refuse a shop's photo (a code, never free text; hard rule 16). */
export const PRODUCT_PHOTO_REJECT_REASONS = [
  'not_this_product',
  'low_quality',
  'text_or_watermark',
  'other',
] as const;
export type ProductPhotoRejectReason = (typeof PRODUCT_PHOTO_REJECT_REASONS)[number];

/** Stable error codes (the website translates them; hard rule 10). */
export const PRODUCT_PHOTO_ERROR_CODES = [
  'PRODUCT_PHOTO_LIMIT',
  'PRODUCT_PHOTO_ALT',
  'PRODUCT_PHOTO_ORDER',
  'PRODUCT_PHOTO_NOT_PENDING',
  'PRODUCT_PHOTO_SHOP_UPLOADS_OFF',
  'PRODUCT_PHOTO_NOT_SOLD',
  'PHOTO_TYPE',
  'PHOTO_HEIC',
  'PHOTO_TOO_LARGE',
  'PHOTO_UNREADABLE',
  'PHOTOS_UNAVAILABLE',
] as const;

/** The public path of one variant, relative to the API's `/v1` prefix. */
export const productPhotoPath = (photoId: string, width: ProductPhotoWidth): string =>
  `/product-photos/${photoId}/${String(width)}`;

/** Which stored width serves a requested pixel width: the smallest that is at least as wide, else the largest. */
export const variantForWidth = (px: number): ProductPhotoWidth =>
  PRODUCT_PHOTO_WIDTHS.find((w) => w >= px) ?? 1600;

export const ProductPhotoAltSchema = z.string().trim().min(PRODUCT_PHOTO_ALT_MIN).max(PRODUCT_PHOTO_ALT_MAX);

export const AdminProductPhotoDto = z.object({
  id: z.uuid(),
  status: z.enum(PRODUCT_PHOTO_STATUSES),
  alt: z.string(),
  altHi: z.string(),
  /** 0-based position among the product's photos (0 is the cover). */
  sort: z
    .number()
    .int()
    .min(0)
    .max(PRODUCT_PHOTO_MAX - 1),
  width: z.number().int(),
  height: z.number().int(),
  lqip: z.string().nullable(),
  /** Set when a shop added it (shown to staff in the queue). */
  submittedByShopId: z.uuid().nullable(),
  version: z.number().int(),
});
export type AdminProductPhoto = z.infer<typeof AdminProductPhotoDto>;

export const AdminProductPhotosDto = z.object({
  photos: z.array(AdminProductPhotoDto),
  max: z.number().int(),
  /** The setting `catalogue.shop_photo_uploads` (so the editor can say who may add photos). */
  shopUploadsEnabled: z.boolean(),
});

export const PhotoOrderBody = z.object({ ids: z.array(z.uuid()).min(1).max(PRODUCT_PHOTO_MAX) }).strict();
export const PhotoRejectBody = z.object({ reasonCode: z.enum(PRODUCT_PHOTO_REJECT_REASONS) }).strict();
export const PhotoPatchBody = z
  .object({ version: z.number().int().min(1), alt: ProductPhotoAltSchema, altHi: ProductPhotoAltSchema })
  .strict();

export const PhotoQueueDto = z.object({
  items: z.array(
    z.object({
      photoId: z.uuid(),
      productSlug: z.string(),
      productName: z.string(),
      alt: z.string(),
      altHi: z.string(),
      width: z.number().int(),
      height: z.number().int(),
      lqip: z.string().nullable(),
      shopId: z.uuid().nullable(),
      shopName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const PhotoRemovedDto = z.object({ ok: z.literal(true) });
