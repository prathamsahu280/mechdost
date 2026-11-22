/** Pure helpers of the shop's "Load more" (spec 02 "Pagination"): append without duplicates, keep `?pages=N` honest. */

/** The most pages one list may show; also the server's cap for a shared `?pages=N` link. */
export const MAX_LIST_PAGES = 10;

/** Appends the next page, dropping slugs already shown (a list that shifted between requests never repeats a card). */
export function appendFresh<T extends { slug: string }>(
  shown: readonly string[],
  appended: readonly T[],
  page: readonly T[],
): T[] {
  const seen = new Set([...shown, ...appended.map((card) => card.slug)]);
  const fresh: T[] = [];
  for (const card of page) {
    if (seen.has(card.slug)) continue;
    seen.add(card.slug);
    fresh.push(card);
  }
  return fresh;
}

/** The address of the list with `pages` pages open: the listing's own URL plus `pages` (omitted for page 1). */
export function withPages(listingUrl: string, pages: number): string {
  const url = new URL(listingUrl, 'https://x.invalid');
  if (pages > 1) url.searchParams.set('pages', String(Math.min(MAX_LIST_PAGES, pages)));
  else url.searchParams.delete('pages');
  return `${url.pathname}${url.search}`;
}
