import type { Locale } from '@/i18n/routing';
import { fetchCataloguePage } from './api-source';
import type { CardView } from './view';

/** How many cards "Browse our product range" shows. */
export const HOME_RANGE_COUNT = 4;

/**
 * The home page's product range in API mode: live products that have a photo, one per brand first (so the row does
 * not fill with one maker), then more of the same brands, in the order given (newest first). A product without a
 * photo is never shown here (a card with placeholder art on the home page looked unfinished, audit 2026-11-22).
 */
export function pickHomeRange(items: readonly CardView[], count: number): CardView[] {
  const withPhoto = items.filter((c) => c.photo !== null);
  const seen = new Set<string>();
  const first: CardView[] = [];
  const rest: CardView[] = [];
  for (const c of withPhoto) {
    if (seen.has(c.brand)) rest.push(c);
    else {
      seen.add(c.brand);
      first.push(c);
    }
  }
  return [...first, ...rest].slice(0, count);
}

/** Reads a page of the newest live products and picks the range from it; empty when the API is unreachable. */
export async function homeRangeCards(locale: Locale): Promise<CardView[]> {
  try {
    const page = await fetchCataloguePage({ locale, sort: 'newest', limit: 48 });
    return pickHomeRange(page.items, HOME_RANGE_COUNT);
  } catch {
    return [];
  }
}
