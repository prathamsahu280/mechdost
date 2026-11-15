import {
  PHOTO_ERROR_CODES,
  PHOTO_MAX_BYTES,
  PhotoAddedDto,
  PhotoRemovedDto,
  PublicGalleryDto,
  ServicePhotosDto,
  type PhotoStage,
  type PublicGallery,
  type ServicePhoto,
  type ServicePhotos,
} from '@mechdost/shared/service-photos';
import { adminApi, type AdminResult } from './admin-api';
import { call, authed, type ApiResult } from './orders-api';

/**
 * Job photos on the MechDost API (spec 06 "Job photos"). Pictures reach the page only as the short-lived URLs the API
 * issued after its rights check (`photoSrc`); nothing here knows a storage address. Uploads are multipart with the
 * caller's token; every answer is validated with the shared schemas (hard rule 4). Loaded only by real-mode screens.
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export const fetchWorkshopPhotos = (locale: string, code: string): Promise<AdminResult<ServicePhotos>> =>
  adminApi(locale, `/workshop/requests/${encodeURIComponent(code)}/photos`, ServicePhotosDto);

export const fetchCustomerPhotos = (locale: string, code: string): Promise<ApiResult<ServicePhotos>> =>
  authed(locale, `/service-requests/${encodeURIComponent(code)}/photos`, ServicePhotosDto);

export const removePhoto = (locale: string, code: string, photoId: string) =>
  adminApi(
    locale,
    `/workshop/requests/${encodeURIComponent(code)}/photos/${encodeURIComponent(photoId)}`,
    PhotoRemovedDto,
    {
      method: 'DELETE',
    },
  );

export const fetchWorkshopGallery = (slug: string): Promise<ApiResult<PublicGallery>> =>
  call(`/workshops/${encodeURIComponent(slug)}/photos`, PublicGalleryDto);

export type UploadResult = { ok: true; photo: ServicePhoto } | { ok: false; code: string };

/** Upload one picture. A file over the limit is refused here first (the API checks again while streaming). */
export async function uploadPhoto(
  locale: string,
  code: string,
  stage: PhotoStage,
  file: File,
): Promise<UploadResult> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, code: 'PHOTO_TOO_LARGE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
  const form = new FormData();
  form.set('stage', stage);
  form.set('file', file);
  let res: Response;
  try {
    res = await fetch(`${API}/v1/workshop/requests/${encodeURIComponent(code)}/photos`, {
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
  const parsed = PhotoAddedDto.safeParse(body);
  return parsed.success ? { ok: true, photo: parsed.data.photo } : { ok: false, code: 'BAD_RESPONSE' };
}

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

/** `photos.*` key for an upload or load error (unknown codes: a generic message). */
export function photoErrorKey(code: string): string {
  if ((PHOTO_ERROR_CODES as readonly string[]).includes(code) && code !== 'PHOTOS_REQUIRED')
    return `err_${code}`;
  if (code === 'RATE_LIMITED' || code === 'HTTP_429') return 'err_RATE_LIMITED';
  if (code === 'HTTP_413') return 'err_PHOTO_TOO_LARGE';
  return 'err_generic';
}
