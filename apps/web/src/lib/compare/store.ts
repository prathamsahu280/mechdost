import { useSyncExternalStore } from 'react';
import { COMPARE_MAX } from '@mechdost/shared/compare-max';
import { COMPARE_EVENT, COMPARE_KEY } from './signal';

/**
 * Compare list (design `docs/superpowers/specs/2026-11-13-product-comparison-design.md`): up to 4 products of one
 * category, kept in this browser like the cart, in both data modes. Deliberately tiny and Zod-free: it ships on
 * every shop page (JS budget, L79). The compare page itself reads the list from its URL, not from here.
 *
 * One shared store for every card, the product page and the tray (redesign 2026-11-14): another category, a
 * fifth product or a refused save becomes the tray's prompt, never a message inside one card.
 */
export { COMPARE_MAX };
const KEY = COMPARE_KEY;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
/** A category display name: plain text, short (it is shown in the tray). */
const NAME = /^[^<>{}\p{Cc}]{1,60}$/u;
const LANG = /^[a-z]{2}$/;

/** The category's display name and the page language it was written in (shown by the tray in that language). */
export interface CompareLabel {
  name?: string;
  lang?: string;
}

export interface CompareList extends CompareLabel {
  category: string | null;
  slugs: readonly string[];
}

export type CompareAddResult = 'added' | 'full' | 'other_category' | 'save_failed';

/** What the tray asks ("Start a new comparison with …?") or tells (list full, save refused). */
export type ComparePrompt =
  | {
      kind: 'switch';
      slug: string;
      category: string;
      name?: string;
      lang?: string;
      fromName?: string;
      fromLang?: string;
      fromCount: number;
    }
  | { kind: 'full' }
  | { kind: 'save_failed' };

const EMPTY: CompareList = { category: null, slugs: [] };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: CompareList } | null = null;
let prompt: ComparePrompt | null = null;

const label = (l: CompareLabel): CompareLabel =>
  l.name && l.lang && NAME.test(l.name) && LANG.test(l.lang) ? { name: l.name, lang: l.lang } : {};

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
    return {
      category,
      slugs: kept,
      ...(typeof name === 'string' && typeof lang === 'string' ? label({ name, lang }) : {}),
    };
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

/** The tray's current question or notice; the same object until it changes. */
export function readPrompt(): ComparePrompt | null {
  return prompt;
}

/** Tells every subscriber, and the tray loader (`prompt`: load the tray even while the list is empty). */
function notify(withPrompt = false) {
  for (const l of listeners) l();
  window.dispatchEvent(
    withPrompt ? new CustomEvent(COMPARE_EVENT, { detail: 'prompt' }) : new Event(COMPARE_EVENT),
  );
}

function ask(next: ComparePrompt) {
  prompt = next;
  notify(true);
}

/** Closes the tray's question or notice without touching the list ("Keep current", Escape, "OK"). */
export function dismissPrompt(): void {
  if (prompt === null) return;
  prompt = null;
  for (const l of listeners) l();
}

function write(list: CompareList): boolean {
  let saved = true;
  try {
    if (list.slugs.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    saved = false;
  }
  // Any change to the list answers whatever the tray was asking.
  prompt = null;
  notify();
  return saved;
}

/** Adds a product; `name`/`lang` label the category when this product starts the list. */
export function addToCompare(slug: string, category: string, name: CompareLabel = {}): CompareAddResult {
  const list = readCompare();
  if (list.slugs.includes(slug)) return 'added';
  if (list.category !== null && list.category !== category) {
    const to = label(name);
    ask({
      kind: 'switch',
      slug,
      category,
      ...to,
      ...(list.name && list.lang ? { fromName: list.name, fromLang: list.lang } : {}),
      fromCount: list.slugs.length,
    });
    return 'other_category';
  }
  if (list.slugs.length >= COMPARE_MAX) {
    ask({ kind: 'full' });
    return 'full';
  }
  const kept = list.category === null ? label(name) : label(list);
  if (write({ category, slugs: [...list.slugs, slug], ...kept })) return 'added';
  ask({ kind: 'save_failed' });
  return 'save_failed';
}

/** Replaces the list with this one product. */
export function startNewComparison(
  slug: string,
  category: string,
  name: CompareLabel = {},
): 'added' | 'save_failed' {
  return write({ category, slugs: [slug], ...label(name) }) ? 'added' : 'save_failed';
}

/** The answer to "Start a new comparison with …?"; `null` when nothing was being asked. */
export function answerSwitch(startNew: boolean): 'added' | 'save_failed' | 'kept' | null {
  const p = prompt;
  if (p?.kind !== 'switch') return null;
  if (!startNew) {
    dismissPrompt();
    return 'kept';
  }
  const r = startNewComparison(p.slug, p.category, p);
  if (r === 'save_failed') ask({ kind: 'save_failed' });
  return r;
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
const noPrompt = (): ComparePrompt | null => null;

export function useCompare(): CompareList {
  return useSyncExternalStore(subscribe, readCompare, serverSnapshot);
}

export function useComparePrompt(): ComparePrompt | null {
  return useSyncExternalStore(subscribe, readPrompt, noPrompt);
}
