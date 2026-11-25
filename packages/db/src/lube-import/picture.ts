import type { CsvRow } from '../battery-import';
import { nameKey } from './adapter';
import { cleanLubeName } from './text';
import type { DraftReason } from './types';

/**
 * The picture rules of the HP and BPCL MAK imports (user ruling 2026-11-25: a photo the source marks as generic, shared
 * by many products, is never a product photo; that product is a draft with reason `generic_photo_only`).
 *
 * Decided by what the files really are (their bytes), not only by the source's "Picture note":
 *  - the same picture on {@link GENERIC_PHOTO_AT} or more products, or also on a product that is not imported (an
 *    industrial one), is the maker's stock photo -> `generic_photo_only`;
 *  - the same picture on two or three different products is a pack photo of one of them (a "Gear Oil XP 80W-90" can on
 *    the "EP 80" page): it would show the wrong label -> `photo_of_another_product`;
 *  - grades of one page, and one product listed twice, share their own photo and that is fine.
 */
export const GENERIC_PHOTO_AT = 4;

export interface PictureSeen {
  /** Distinct products (by name) the maker shows this picture on. */
  products: number;
  /** One of them is a row that is not imported. */
  withSkipped: boolean;
}
export type PictureShare = (file: string) => PictureSeen;

/** `hashOf` is the content hash of a picture file (null = unreadable); without it every file counts once. */
export function pictureShares(
  rows: readonly CsvRow[],
  kept: (row: CsvRow) => boolean,
  hashOf?: (file: string) => string | null,
): PictureShare {
  const groups = new Map<string, { names: Set<string>; withSkipped: boolean }>();
  const hashes = new Map<string, string>();
  for (const row of rows) {
    const file = (row['Picture file'] ?? '').trim();
    const hash = file === '' || !hashOf ? null : hashOf(file);
    if (hash === null) continue;
    hashes.set(file, hash);
    const g = groups.get(hash) ?? { names: new Set<string>(), withSkipped: false };
    g.names.add(nameKey(cleanLubeName(row.Product ?? '')));
    if (!kept(row)) g.withSkipped = true;
    groups.set(hash, g);
  }
  return (file) => {
    const hash = hashes.get(file);
    const g = hash === undefined ? undefined : groups.get(hash);
    return g ? { products: g.names.size, withSkipped: g.withSkipped } : { products: 1, withSkipped: false };
  };
}

export interface PictureChoice {
  file: string | null;
  reason: DraftReason | null;
  /** How many products the maker's site shows this picture on (1 = its own). */
  sharedBy: number;
  /** An oddity of the source about this picture, for the report. */
  note: string | null;
}

export function pictureOf(
  row: CsvRow,
  exists: (file: string) => boolean,
  share: PictureShare,
): PictureChoice {
  const file = (row['Picture file'] ?? '').trim();
  const note = (row['Picture note'] ?? '').trim();
  const stated = /Same photo used for (\d+) products?/.exec(note);
  const statedBy = stated?.[1] ? Number(stated[1]) : 1;
  if (file === '') return { file: null, reason: 'no_photo_on_site', sharedBy: statedBy, note: null };
  const seen = share(file);
  const sharedBy = Math.max(statedBy >= GENERIC_PHOTO_AT ? statedBy : 1, seen.products);
  const disagree =
    seen.products >= GENERIC_PHOTO_AT && statedBy < GENERIC_PHOTO_AT
      ? `The source says "${note === '' ? 'Own photo' : note}" but the file is identical to the picture of ${String(seen.products - 1)} other products.`
      : null;
  if (sharedBy >= GENERIC_PHOTO_AT || seen.withSkipped)
    return { file, reason: 'generic_photo_only', sharedBy, note: disagree };
  if (seen.products > 1) return { file, reason: 'photo_of_another_product', sharedBy, note: null };
  if (!exists(file)) return { file: null, reason: 'no_photo_file', sharedBy, note: null };
  return { file, reason: null, sharedBy, note: null };
}
