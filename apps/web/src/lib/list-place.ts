import type { StorageLike } from './recently-viewed-store';

/**
 * "Back keeps your place" (shopping personalisation phase 2): the scroll position of a product list (shop, category,
 * search; the "Show more" pages are already in the address as `?pages=N`), kept per list address in session storage
 * and given back once, on a Back/Forward visit. Pure helpers; `list-place-runtime.ts` wires them to the page.
 */
const PREFIX = 'mechdost-list-place:';

/** One key per list: path and query; the hash is not part of the list. */
export function listPlaceKey(url: string): string {
  const u = new URL(url, 'https://x.invalid');
  return `${PREFIX}${u.pathname}${u.search}`;
}

export function saveListPlace(storage: StorageLike | null, url: string, scrollY: number): void {
  try {
    storage?.setItem(listPlaceKey(url), String(Math.max(0, Math.round(scrollY))));
  } catch {
    /* blocked storage: Back starts at the top, as before */
  }
}

/** The saved position for this list, once (it is removed when read); null when none. */
export function readListPlace(storage: StorageLike | null, url: string): number | null {
  try {
    const key = listPlaceKey(url);
    const raw = storage?.getItem(key) ?? null;
    if (raw === null) return null;
    storage?.removeItem(key);
    const y = Number(raw);
    return Number.isFinite(y) && y >= 0 ? y : null;
  } catch {
    return null;
  }
}
