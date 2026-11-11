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
