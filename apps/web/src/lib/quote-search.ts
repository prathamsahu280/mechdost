/** The bulk-quote product search starts as soon as two characters are typed (QA 2026-11-16, bug 13). */
export const QUOTE_SEARCH_DEBOUNCE_MS = 350;

export function shouldSearch(query: string): boolean {
  return query.trim().length >= 2;
}
