/**
 * Magic bytes (spec 23 § 10 step 3; SR-17, AT-UP-2). The declared MIME type is never trusted: the first bytes decide.
 * SVG, HTML, XML, ZIP (and so JPEG+ZIP polyglots are caught by the trailing-archive check in `verify.ts`), PE/ELF
 * executables and HLS playlists are named explicitly so the reason is logged; anything else unknown is `unknown`.
 */
import type { UstaadMediaKind } from '@mechdost/shared/ustaad/codes';

export type Sniffed =
  | 'image/webp'
  | 'image/jpeg'
  | 'mp4'
  | 'webm'
  | 'audio/ogg'
  | 'application/pdf'
  | 'svg'
  | 'html'
  | 'zip'
  | 'executable'
  | 'hls'
  | 'unknown';

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export function sniff(b: Uint8Array): Sniffed {
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') return 'mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07))
    return 'zip';
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return 'executable';
  if (b.length >= 4 && b[0] === 0x7f && ascii(b, 1, 4) === 'ELF') return 'executable';
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(b.subarray(0, 512))
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  if (head.startsWith('#extm3u')) return 'hls';
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml'))
    return 'html';
  return 'unknown';
}

/** Does what the bytes say fit the declared kind and MIME type? */
export function matchesDeclared(kind: UstaadMediaKind, mime: string, s: Sniffed): boolean {
  switch (kind) {
    case 'image':
      return s === mime;
    case 'video':
      return (mime === 'video/mp4' && s === 'mp4') || (mime === 'video/webm' && s === 'webm');
    case 'audio':
      return (
        (mime === 'audio/ogg' && s === 'audio/ogg') ||
        (mime === 'audio/webm' && s === 'webm') ||
        (mime === 'audio/mp4' && s === 'mp4')
      );
    case 'document':
      return mime === 'application/pdf' && s === 'application/pdf';
  }
}
