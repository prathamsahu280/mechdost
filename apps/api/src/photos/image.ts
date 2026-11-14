import sharp from 'sharp';
import { PHOTO_LARGE_EDGE, PHOTO_MAX_PIXELS, PHOTO_THUMB_EDGE } from '@mechdost/shared/service-photos';
import { ApiError } from '../errors';

/**
 * The only door pictures come through (spec 13 "Uploads"). The file name and the declared MIME type are never
 * trusted: the first bytes decide the type, and only JPEG, PNG and WebP are decoded. SVG, GIF, AVIF, TIFF and PDF are
 * refused outright. HEIC (iPhone default) is refused with a clear message: the libvips bundled with sharp decodes
 * AVIF but has no HEVC decoder (checked 2026-11-15, sharp 0.35.5). Every accepted picture is decoded, auto-rotated
 * from its EXIF orientation, then re-encoded as WebP (large and thumbnail), which drops all metadata (GPS, camera,
 * owner) and any trailing or embedded payload. The original bytes are never stored.
 */
export type SniffedKind = 'jpeg' | 'png' | 'webp' | 'heic' | 'other';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function sniffImage(b: Uint8Array): SniffedKind {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'png';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(8, 12))) return 'heic';
  return 'other';
}

export interface ProcessedImage {
  large: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

// Two pictures at a time per instance: decoding a 50 MP photo needs a few hundred MB.
const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

sharp.cache(false);
sharp.concurrency(2);

export async function processPhoto(input: Buffer): Promise<ProcessedImage> {
  const kind = sniffImage(input);
  if (kind === 'heic') throw new ApiError(422, 'PHOTO_HEIC', 'Please upload JPG or PNG');
  if (kind === 'other') throw new ApiError(422, 'PHOTO_TYPE', 'Please upload a JPG, PNG or WebP photo');
  return slot(async () => {
    try {
      const base = () =>
        sharp(input, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: 'error', animated: false }).rotate();
      const meta = await sharp(input, { limitInputPixels: PHOTO_MAX_PIXELS }).metadata();
      if (meta.format !== kind)
        throw new ApiError(422, 'PHOTO_TYPE', 'Please upload a JPG, PNG or WebP photo');
      const edge = (n: number) => ({ width: n, height: n, fit: 'inside' as const, withoutEnlargement: true });
      const large = await base()
        .resize(edge(PHOTO_LARGE_EDGE))
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      const thumb = await base().resize(edge(PHOTO_THUMB_EDGE)).webp({ quality: 72 }).toBuffer();
      return { large: large.data, thumb, width: large.info.width, height: large.info.height };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(422, 'PHOTO_UNREADABLE', 'The photo could not be read');
    }
  });
}
