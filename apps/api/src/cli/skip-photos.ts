import { readFileSync } from 'node:fs';
import type { BatteryPlan } from '@mechdost/db/battery-import';

/**
 * `--skip-photos-for` of the battery importers (user ruling 2026-11-24: photos are never edited to remove watermarks,
 * site URLs or logos; a photo that carries one is left out and its product imports without it).
 */

/** A picture name as compared by the skip list: forward slashes, lower case. */
const skipKey = (file: string) => file.trim().replaceAll('\\', '/').toLowerCase();

/**
 * The option's value: file names or paths (relative to the folder), comma separated, or `@list.txt` with one per
 * line (names may hold commas; empty lines and lines starting with # are ignored). A name matches the whole path or
 * just the file name, with or without its extension.
 */
export function addSkipFiles(into: Set<string>, value: string): void {
  const items = value.startsWith('@')
    ? readFileSync(value.slice(1), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
    : value.split(',');
  for (const item of items) if (item.trim() !== '') into.add(skipKey(item));
}

export function isSkippedPhoto(skip: ReadonlySet<string>, file: string): boolean {
  const full = skipKey(file);
  const name = full.slice(full.lastIndexOf('/') + 1);
  return [full, name, name.replace(/\.[a-z0-9]+$/, '')].some((k) => skip.has(k));
}

/** The plan without the skipped pictures: the product keeps its status and imports without them. */
export function withoutSkippedPhotos<P extends BatteryPlan>(plan: P, skip: ReadonlySet<string>): P {
  if (skip.size === 0) return plan;
  const products = plan.products.map((p) => {
    const photos = p.photos.filter((ph) => !isSkippedPhoto(skip, ph.file));
    return photos.length === p.photos.length ? p : { ...p, photos, photo: photos[0] ?? null };
  });
  const rows = plan.rows.map((r) =>
    r.photoFile !== '' && isSkippedPhoto(skip, r.photoFile) ? { ...r, photoFile: '' } : r,
  );
  return { ...plan, products, rows };
}
