import type { CompareSignal } from './signal';
import { startNewComparison, type CompareLabel, type CompareList } from './store';

/**
 * The compare tray's question and notices (redesign 2026-11-14). Imported only by the lazily loaded tray, so none
 * of this ships with the shop pages (review C1: the store and toggle are on every shop page, at the JS budget).
 */
export type ComparePrompt =
  | {
      kind: 'switch';
      slug: string;
      category: string;
      /** The category being replaced. */
      from: string;
      name?: string;
      lang?: string;
      fromName?: string;
      fromLang?: string;
      fromCount: number;
    }
  | { kind: 'full' }
  | { kind: 'save_failed' }
  | { kind: 'notice'; text: string };

export type CompareAsk = Exclude<CompareSignal, { say: string }>;

/** A category display name: short plain text with a two-letter language code; anything else is not shown. */
const NAME = /^[^<>{}\p{Cc}]{1,60}$/u;
const LANG = /^[a-z]{2}$/;

export function cleanLabel(name: unknown, lang: unknown): CompareLabel {
  return typeof name === 'string' && typeof lang === 'string' && NAME.test(name) && LANG.test(lang)
    ? { name, lang }
    : {};
}

const ASKS = new Set(['switch', 'full', 'save_failed', 'notice']);

/** The detail of a compare change event that carries a request (the store's own changes carry none). */
export function isCompareSignal(detail: unknown): detail is CompareSignal {
  if (typeof detail !== 'object' || detail === null) return false;
  const d = detail as { ask?: unknown; say?: unknown };
  return typeof d.say === 'string' || (typeof d.ask === 'string' && ASKS.has(d.ask));
}

/** What the tray shows for a request, given the list as it is now; `null` when there is nothing to ask. */
export function toPrompt(req: CompareAsk, list: CompareList): ComparePrompt | null {
  if (req.ask === 'notice') return { kind: 'notice', text: req.text };
  if (req.ask !== 'switch') return { kind: req.ask };
  if (list.category === null || list.category === req.category || list.slugs.length === 0) return null;
  const to = cleanLabel(req.name, req.lang);
  const from = cleanLabel(list.name, list.lang);
  return {
    kind: 'switch',
    slug: req.slug,
    category: req.category,
    from: list.category,
    ...to,
    ...(from.name ? { fromName: from.name, fromLang: from.lang } : {}),
    fromCount: list.slugs.length,
  };
}

/** "Start new": the list becomes this one product, named in the page language. */
export function startNew(p: Extract<ComparePrompt, { kind: 'switch' }>): 'added' | 'save_failed' {
  return startNewComparison(p.slug, p.category, p.name && p.lang ? { name: p.name, lang: p.lang } : {});
}
