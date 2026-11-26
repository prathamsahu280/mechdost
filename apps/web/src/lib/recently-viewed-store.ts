import { parseRecent, pushRecent, serialiseRecent, type RecentEntry } from '@mechdost/shared/recently-viewed';

/**
 * The browser copy of "Recently viewed" (shopping personalisation phase 2, design 2026-11-25). Slugs and times only,
 * in `localStorage`; every read and write is wrapped, so blocked storage (private window, cleared site data) gives an
 * empty list and never an error. The off switch ("Remember products I view on this device") clears the list and
 * stops new views from being kept. Loaded only by the lazy list chunk, never by a page's first load.
 */
export const RECENT_KEY = 'mechdost-recent';
export const RECENT_OFF_KEY = 'mechdost-recent-off';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The page's storage, or null where the browser refuses access. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isRecentOff(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(RECENT_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function loadRecent(storage: StorageLike | null): RecentEntry[] {
  if (!storage || isRecentOff(storage)) return [];
  try {
    return parseRecent(storage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

export function saveRecent(storage: StorageLike | null, list: readonly RecentEntry[]): void {
  try {
    if (list.length === 0) storage?.removeItem(RECENT_KEY);
    else storage?.setItem(RECENT_KEY, serialiseRecent(list));
  } catch {
    /* storage full or blocked: the list lives for this page only */
  }
}

/** Off: clears the list and remembers the choice. On: forgets the choice (new views are kept again). */
export function setRecentOff(storage: StorageLike | null, off: boolean): void {
  try {
    if (off) {
      storage?.setItem(RECENT_OFF_KEY, '1');
      storage?.removeItem(RECENT_KEY);
    } else storage?.removeItem(RECENT_OFF_KEY);
  } catch {
    /* blocked storage: nothing is kept anyway */
  }
}

/** Records a view of `slug` now (unless switched off) and returns the new list. */
export function rememberView(storage: StorageLike | null, slug: string, now = Date.now()): RecentEntry[] {
  if (isRecentOff(storage)) return [];
  const next = pushRecent(loadRecent(storage), slug, now);
  saveRecent(storage, next);
  return next;
}
