/**
 * Strings for the root error page (`app/[locale]/error.tsx`). The layout writes them into a JSON data block, so
 * the error boundary (bundled into every route) needs no i18n runtime: the JS budget stays met (spec 16).
 */
export const ERROR_COPY_ID = 'error-page-copy';

export interface ErrorCopy {
  title: string;
  body: string;
  tryAgain: string;
  trying: string;
}

const KEYS: readonly (keyof ErrorCopy)[] = ['title', 'body', 'tryAgain', 'trying'];

let remembered: { copy: ErrorCopy; lang: string } | null = null;

/**
 * Keep the copy and the page language for `app/global-error.tsx` (review 2026-11-14): that page replaces the whole
 * document, so the data block is gone by the time it renders. Called on load by the site-wide analytics island; a
 * page without a valid block never erases what was read.
 */
export function rememberErrorCopy(
  doc: Pick<Document, 'getElementById'> & { documentElement: { lang: string } },
): void {
  const copy = readErrorCopy(doc);
  if (copy) remembered = { copy, lang: doc.documentElement.lang || 'en' };
}

/** The remembered copy, or null when no page with the data block has loaded yet. */
export const rememberedErrorCopy = () => remembered;

/** The copy from the page, or null when it is missing or malformed (the caller then renders nothing). */
export function readErrorCopy(doc: Pick<Document, 'getElementById'>): ErrorCopy | null {
  try {
    const parsed: unknown = JSON.parse(doc.getElementById(ERROR_COPY_ID)?.textContent ?? '');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!KEYS.every((k) => typeof record[k] === 'string')) return null;
    return record as unknown as ErrorCopy;
  } catch {
    return null;
  }
}
