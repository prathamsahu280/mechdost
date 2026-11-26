import { fitWithin } from '../ustaad/media-core';

export interface PreparedPhoto {
  blob: Blob;
  mime: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
}

/** Long edge after shrinking: enough to read a battery serial or a parcel label, small on 4G. */
const MAX_EDGE = 1600;

/**
 * A pickup, delivery, failure or document photo, prepared on the phone (spec 24): drawn on a canvas and encoded
 * again, so the upload carries no EXIF (no GPS position, no phone model), is turned the right way up and is at most
 * 1600 px on the long edge. WebP where the browser can encode it, else JPEG. (Same steps as the Ustaad photo picker,
 * kept here so the delivery screens do not load the Ustaad UI.)
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const encode = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, q);
    });
  const webp = await encode('image/webp', 0.8);
  if (webp?.type === 'image/webp') return { blob: webp, mime: 'image/webp', ...size };
  const jpeg = await encode('image/jpeg', 0.82);
  if (!jpeg) throw new Error('encode');
  return { blob: jpeg, mime: 'image/jpeg', ...size };
}
