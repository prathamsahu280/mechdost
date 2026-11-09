'use server';

import type { ReactNode } from 'react';
import { ProductCard } from '@/components/catalogue/product-card';
import { routing, type Locale } from '@/i18n/routing';
import { fetchCataloguePage, type ApiSort } from '@/lib/catalogue/api-source';
import { DATA_MODE } from '@/lib/data-mode';

/** What the shop listing asks the API for; the same values the page reads from its URL. */
export interface ListingQuery {
  locale: Locale;
  q: string;
  category: string | null;
  sort: ApiSort | null;
}

const SORTS: readonly ApiSort[] = ['relevance', 'newest', 'price_asc', 'price_desc'];

/** Server function input is untrusted (a public POST endpoint): accept only the listing's own shapes. */
function parse(input: ListingQuery, cursor: string): ListingQuery {
  const locale = routing.locales.find((l) => l === input.locale);
  if (!locale) throw new Error('bad locale');
  if (typeof input.q !== 'string' || input.q.length > 120) throw new Error('bad query');
  if (input.category !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.category))
    throw new Error('bad category');
  if (input.sort !== null && !SORTS.includes(input.sort)) throw new Error('bad sort');
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 512) throw new Error('bad cursor');
  return { locale, q: input.q, category: input.category, sort: input.sort };
}

/**
 * "Load more" on the shop listing (data mode `api`): the next page as server-rendered cards, so no catalogue
 * code or schema reaches the browser. Errors propagate; the listing shows its retry message. The card's texts
 * follow the page URL's locale (the POST goes to the page, through the locale proxy).
 */
export async function loadMoreCards(
  input: ListingQuery,
  cursor: string,
): Promise<{ cards: { slug: string; node: ReactNode }[]; nextCursor: string | null }> {
  if (DATA_MODE !== 'api') throw new Error('catalogue API is off');
  const query = parse(input, cursor);
  const page = await fetchCataloguePage({
    locale: query.locale,
    q: query.q,
    category: query.category ?? undefined,
    sort: query.sort ?? undefined,
    cursor,
  });
  return {
    cards: page.items.map((p) => ({ slug: p.slug, node: <ProductCard key={p.slug} product={p} /> })),
    nextCursor: page.nextCursor,
  };
}
