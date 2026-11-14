import { useSyncExternalStore } from 'react';
import { COMPARE_MAX } from '@mechdost/shared/compare-max';
import { COMPARE_EVENT, COMPARE_KEY } from './signal';

/**
 * Compare list (design `docs/superpowers/specs/2026-11-13-product-comparison-design.md`): up to 4 products of one
 * category, kept in this browser like the cart, in both data modes. Deliberately tiny and Zod-free: it ships on
 * every shop page (JS budget, L79). The compare page itself reads the list from its URL, not from here.
 *
 * One shared list for every card, the product page and the tray (redesign 2026-11-14). Result codes only: what the
 * shopper is told about another category, a full list or a refused save is the tray's job (`prompt.ts`).
 */
export { COMPARE_MAX };
const KEY = COMPARE_KEY;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** The category's display name and the page language it was written in (the tray validates both). */
export interface CompareLabel {
  name?: string;
  lang?: string;
}

export interface CompareList extends CompareLabel {
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
    const { category, slugs, name, lang } = v as Record<string, unknown>;
    if (typeof category !== 'string' || !SLUG.test(category) || !Array.isArray(slugs)) return EMPTY;
    const valid = [...new Set(slugs.filter((s): s is string => typeof s === 'string' && SLUG.test(s)))];
    const kept = valid.slice(0, COMPARE_MAX);
    if (kept.length === 0) return EMPTY;
    return typeof name === 'string' && typeof lang === 'string'
      ? { category, slugs: kept, name, lang }
      : { category, slugs: kept };
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
  window.dispatchEvent(new Event(COMPARE_EVENT));
  return saved;
}

/** Adds a product; `label` names the category when this product starts the list. */
export function addToCompare(slug: string, category: string, label: CompareLabel = {}): CompareAddResult {
  const list = readCompare();
  if (list.slugs.includes(slug)) return 'added';
  if (list.category !== null && list.category !== category) return 'other_category';
  if (list.slugs.length >= COMPARE_MAX) return 'full';
  const { name, lang } = list.category === null ? label : list;
  return write({ category, slugs: [...list.slugs, slug], name, lang }) ? 'added' : 'save_failed';
}

/** Replaces the list with this one product (the tray's "Start new"). */
export function startNewComparison(
  slug: string,
  category: string,
  label: CompareLabel = {},
): 'added' | 'save_failed' {
  return write({ category, slugs: [slug], ...label }) ? 'added' : 'save_failed';
}

export function removeFromCompare(slug: string): void {
  const list = readCompare();
  const slugs = list.slugs.filter((s) => s !== slug);
  write(slugs.length > 0 ? { ...list, slugs } : EMPTY);
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
