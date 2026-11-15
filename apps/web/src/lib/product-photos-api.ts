import {
  AdminProductPhotoDto,
  AdminProductPhotosDto,
  PhotoQueueDto,
  PhotoRemovedDto,
  PRODUCT_PHOTO_ERROR_CODES,
  type ProductPhotoRejectReason,
} from '@mechdost/shared/product-photos';
import { PHOTO_MAX_BYTES } from '@mechdost/shared/service-photos';
import { adminApi } from './admin-api';

/**
 * Product photos on the MechDost API (spec 02 "Product photos"), for the admin catalogue editor, the approval queue and
 * the shop portal. `scope` picks the staff routes (`/admin/catalogue/products/{slug}/photos`) or the shop routes
 * (`/shop/products/{slug}/photos`). Images are reached only through the signed `previewUrl` of each row. Loaded only
 * by real-mode screens (dynamic imports).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type PhotoScope = 'staff' | 'shop';
const base = (scope: PhotoScope, slug: string) =>
  scope === 'staff'
    ? `/admin/catalogue/products/${encodeURIComponent(slug)}/photos`
    : `/shop/products/${encodeURIComponent(slug)}/photos`;

export const fetchProductPhotos = (locale: string, scope: PhotoScope, slug: string) =>
  adminApi(locale, base(scope, slug), AdminProductPhotosDto);

export const reorderProductPhotos = (locale: string, slug: string, ids: readonly string[]) =>
  adminApi(locale, `${base('staff', slug)}/order`, AdminProductPhotosDto, { method: 'PUT', body: { ids } });

export const removeProductPhoto = (locale: string, scope: PhotoScope, slug: string, photoId: string) =>
  adminApi(locale, `${base(scope, slug)}/${encodeURIComponent(photoId)}`, PhotoRemovedDto, {
    method: 'DELETE',
  });

export const fetchPhotoQueue = (locale: string) =>
  adminApi(locale, '/admin/catalogue/photo-queue', PhotoQueueDto);

export const approvePhoto = (locale: string, photoId: string) =>
  adminApi(locale, `/admin/catalogue/photos/${encodeURIComponent(photoId)}/approve`, PhotoRemovedDto, {
    method: 'POST',
  });

export const rejectPhoto = (locale: string, photoId: string, reasonCode: ProductPhotoRejectReason) =>
  adminApi(locale, `/admin/catalogue/photos/${encodeURIComponent(photoId)}/reject`, PhotoRemovedDto, {
    method: 'POST',
    body: { reasonCode },
  });

export type UploadResult = { ok: true } | { ok: false; code: string };

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

/** Upload one photo with its two descriptions (multipart). A file over the limit is refused here first. */
export async function uploadProductPhoto(
  locale: string,
  scope: PhotoScope,
  slug: string,
  input: { file: File; alt: string; altHi: string },
): Promise<UploadResult> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  if (input.file.size > PHOTO_MAX_BYTES) return { ok: false, code: 'PHOTO_TOO_LARGE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
  const form = new FormData();
  form.set('alt', input.alt);
  form.set('altHi', input.altHi);
  form.set('file', input.file);
  let res: Response;
  try {
    res = await fetch(`${API}/v1${base(scope, slug)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, code: errorCodeOf(body) ?? `HTTP_${String(res.status)}` };
  return AdminProductPhotoDto.safeParse((body as { photo?: unknown } | null)?.photo).success
    ? { ok: true }
    : { ok: false, code: 'BAD_RESPONSE' };
}

/** `storefront.*` key for a photo error (unknown codes: a generic message). */
export function productPhotoErrorKey(code: string): string {
  if ((PRODUCT_PHOTO_ERROR_CODES as readonly string[]).includes(code)) return `err_${code}`;
  if (code === 'RATE_LIMITED' || code === 'HTTP_429') return 'err_RATE_LIMITED';
  if (code === 'HTTP_413') return 'err_PHOTO_TOO_LARGE';
  if (code === 'STALE_PHOTO') return 'err_STALE';
  return 'err_generic';
}
