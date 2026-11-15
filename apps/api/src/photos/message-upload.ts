import { createHash, randomUUID } from 'node:crypto';
import { uuidv7, type StoredImage } from '@mechdost/db/repo';
import { ApiError } from '../errors';
import { log } from '../logger';
import type { AppDeps } from '../types';
import { processPhoto } from './image';
import type { PhotoStorage } from './storage';
import { signPhotoUrl } from './url-token';

/**
 * Photos on chat messages other than support tickets (bulk quote threads, spec 19; spec 13 "Uploads"). The same one
 * pipeline as every upload: the bytes decide the type (JPEG, PNG, WebP; everything else, PDF included, is refused),
 * EXIF is dropped by the re-encode, objects get random keys in the private bucket, and reads are short-lived signed
 * URLs. On any failure the objects already stored are removed again.
 */
export interface UploadKit {
  keyring: NonNullable<AppDeps['keyring']>;
  storage: PhotoStorage;
}

/** The kit, or 503 when photo storage is not configured. */
export function uploadKit(deps: AppDeps): UploadKit {
  if (!deps.keyring || !deps.photoStorage)
    throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
  return { keyring: deps.keyring, storage: deps.photoStorage };
}

/** The files of a multipart form: `file` once or many times, at most `max`, each within `maxBytes`. */
export function formFiles(value: unknown, max: number, maxBytes: number): File[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const files = list.filter((v): v is File => v instanceof File);
  if (files.length !== list.length) throw new ApiError(422, 'PHOTO_TYPE', 'Send photos as file uploads');
  if (files.length > max)
    throw new ApiError(422, 'ATTACHMENT_LIMIT', `Up to ${String(max)} photos per message`);
  if (files.some((f) => f.size > maxBytes))
    throw new ApiError(
      413,
      'PHOTO_TOO_LARGE',
      `A photo is bigger than ${String(Math.floor(maxBytes / 1048576))} MB`,
    );
  return files;
}

/** Decode and store every file under `<folder>/<random>/<uuid v7>.webp`; the returned `cleanup` removes them. */
export async function storeImages(
  files: File[],
  kit: UploadKit,
  folder: 'quote',
): Promise<{ images: StoredImage[]; cleanup: () => Promise<void> }> {
  const keys: string[] = [];
  const cleanup = async () => {
    await Promise.allSettled(keys.map((key) => kit.storage.remove(key)));
  };
  const images: StoredImage[] = [];
  try {
    for (const file of files) {
      const processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
      const mediaId = uuidv7();
      const dir = randomUUID();
      const path = `${folder}/${dir}/${mediaId}.webp`;
      const thumbPath = `${folder}/${dir}/${mediaId}-thumb.webp`;
      try {
        keys.push(path, thumbPath);
        await kit.storage.put(path, processed.large);
        await kit.storage.put(thumbPath, processed.thumb);
      } catch (err) {
        log('error', 'photo_storage_failed', {
          op: 'put',
          message: err instanceof Error ? err.message : 'unknown',
        });
        throw new ApiError(503, 'PHOTOS_UNAVAILABLE', 'Photos are not available right now');
      }
      images.push({
        mediaId,
        bucket: kit.storage.bucket,
        path,
        thumbPath,
        width: processed.width,
        height: processed.height,
        bytes: processed.large.length,
        thumbBytes: processed.thumb.length,
        sha256: createHash('sha256').update(processed.large).digest('hex'),
      });
    }
  } catch (err) {
    await cleanup();
    throw err;
  }
  return { images, cleanup };
}

/** Signed (10 minutes, one photo) URLs of a quote photo, served by `GET /v1/quote-photos/:id/:variant`. */
export function signQuotePhoto(keyring: UploadKit['keyring'], mediaId: string) {
  const { exp, sig } = signPhotoUrl(keyring, mediaId);
  const q = `?e=${String(exp)}&s=${sig}`;
  return {
    thumbUrl: `/quote-photos/${mediaId}/thumb${q}`,
    largeUrl: `/quote-photos/${mediaId}/large${q}`,
  };
}
