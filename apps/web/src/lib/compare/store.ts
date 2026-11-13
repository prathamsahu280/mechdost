import { useSyncExternalStore } from 'react';

/**
 * Compare list (design `docs/superpowers/specs/2026-11-13-product-comparison-design.md`): up to 4 products of one
 * category, kept in this browser like the cart, in both data modes. Deliberately tiny and Zod-free: it ships on
 * every shop page (JS budget, L79). The compare page itself reads the list from its URL, not from here.
 */
export const COMPARE_MAX = 4;
const KEY = 'mechdost-compare';
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

export interface CompareList {
  category: string | null;
  slugs: readonly string[];
}

export type CompareAddResult = 'added' | 'full' | 'other_category' | 'save_failed';

const EMPTY: CompareList = { category: null, slugs: [] };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: CompareList } | null = null;

function parse(raw: string | null): CompareList {
  if (!raw) return EMPTY;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return EMPTY;
    const { category, slugs } = v as { category?: unknown; slugs?: unknown };
    if (typeof category !== 'string' || !SLUG.test(category) || !Array.isArray(slugs)) return EMPTY;
    const valid = [...new Set(slugs.filter((s): s is string => typeof s === 'string' && SLUG.test(s)))];
    const kept = valid.slice(0, COMPARE_MAX);
    return kept.length > 0 ? { category, slugs: kept } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The stored list (validated); the same object until the stored text changes (useSyncExternalStore). */
export function readCompare(): CompareList {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (cache?.raw !== raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function write(list: CompareList): boolean {
  let saved = true;
  try {
    if (list.slugs.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    saved = false;
  }
  for (const l of listeners) l();
  return saved;
}

export function addToCompare(slug: string, category: string): CompareAddResult {
  const list = readCompare();
  if (list.slugs.includes(slug)) return 'added';
  if (list.category !== null && list.category !== category) return 'other_category';
  if (list.slugs.length >= COMPARE_MAX) return 'full';
  return write({ category, slugs: [...list.slugs, slug] }) ? 'added' : 'save_failed';
}

/** Replaces the list with this one product (after "You can compare one category at a time"). */
export function startNewComparison(slug: string, category: string): 'added' | 'save_failed' {
  return write({ category, slugs: [slug] }) ? 'added' : 'save_failed';
}

export function removeFromCompare(slug: string): void {
  const list = readCompare();
  const slugs = list.slugs.filter((s) => s !== slug);
  write(slugs.length > 0 ? { category: list.category, slugs } : EMPTY);
}

export function clearCompare(): void {
  write(EMPTY);
}

export function compareHref(slugs: readonly string[]): string {
  return `/compare?p=${slugs.join(',')}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = (): CompareList => EMPTY;

export function useCompare(): CompareList {
  return useSyncExternalStore(subscribe, readCompare, serverSnapshot);
}
