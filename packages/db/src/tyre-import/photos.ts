import type { PlannedPhoto } from '../battery-import';

/** The view a picture file shows, from its name ("CEAT MILAZE X3 - Angle 60.jpg" → "angle 60"; "MRF ZWYDE - Left (2).jpg" → "left (2)"). */
export function viewOf(file: string): string {
  const base = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const at = base.lastIndexOf(' - ');
  return (at < 0 ? base : base.slice(at + 3)).trim().toLowerCase();
}

const VIEW_HI: Readonly<Record<string, string>> = {
  front: 'सामने का दृश्य',
  side: 'बगल का दृश्य',
  left: 'बाएँ से तिरछा दृश्य',
  right: 'दाएँ से तिरछा दृश्य',
  'angle 60': 'तिरछा दृश्य',
  'angle 120': 'दूसरा तिरछा दृश्य',
};
const VIEW_EN: Readonly<Record<string, string>> = {
  front: 'front view',
  side: 'side view',
  left: 'left angle view',
  right: 'right angle view',
  'angle 60': 'angle view',
  'angle 120': 'second angle view',
};

/** Gallery order of the CEAT views (front, the two angles, side) and the MRF views (angled left, right, side, front). */
export const CEAT_VIEW_ORDER: readonly string[] = ['front', 'angle 60', 'angle 120', 'side'];
export const MRF_VIEW_ORDER: readonly string[] = ['left', 'right', 'side', 'front'];

/**
 * The pictures of one tyre in gallery order (the first is the main picture). A file that does not exist is left out and
 * returned in `missing`. Unknown views (Thumbnail, "Left (2)") follow the known ones in source order.
 */
export function planTyrePhotos(opts: {
  files: readonly string[];
  urls: readonly string[];
  name: string;
  nameHi: string;
  order: readonly string[];
  exists: (file: string) => boolean;
}): { photos: PlannedPhoto[]; missing: string[] } {
  const entries = opts.files
    .map((file, i) => ({ file: file.trim(), url: (opts.urls[i] ?? '').trim(), view: viewOf(file) }))
    .filter((e) => e.file !== '');
  const rank = (view: string) => {
    const k = opts.order.indexOf(view);
    return k < 0 ? opts.order.length : k;
  };
  const sorted = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => rank(a.view) - rank(b.view) || a.i - b.i);
  const missing: string[] = [];
  const photos: PlannedPhoto[] = [];
  for (const e of sorted) {
    if (!opts.exists(e.file)) {
      missing.push(e.file);
      continue;
    }
    if (photos.some((p) => p.file === e.file)) continue;
    const en = VIEW_EN[e.view];
    const hi = VIEW_HI[e.view];
    const n = String(photos.length + 1);
    photos.push({
      file: e.file,
      sourceUrl: e.url.slice(0, 500),
      alt: en ? `${opts.name} (${en})` : photos.length === 0 ? opts.name : `${opts.name} (photo ${n})`,
      altHi: hi
        ? `${opts.nameHi} (${hi})`
        : photos.length === 0
          ? opts.nameHi
          : `${opts.nameHi} (फ़ोटो ${n})`,
    });
  }
  return { photos, missing };
}
