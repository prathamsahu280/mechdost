/**
 * View helpers for Admin → Site content in real sign-in builds (spec 08 "Content"; Stream D 2026-11-14). The API
 * keeps a draft and a live text per key and language (`GET /v1/admin/content`); the screen edits the live text:
 * saving a field writes its draft and publishes it, emptying a field unpublishes it (the default text shows again).
 */
export interface ContentEntry {
  key: string;
  locale: 'en' | 'hi';
  draft: { value: unknown; version: number } | null;
  published: { value: unknown; version: number } | null;
}

export interface ContentField {
  /** Text in the box: the live text ('' = the default shows). */
  text: string;
  draftVersion: number | null;
  publishedVersion: number | null;
}

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

export function contentField(
  entries: readonly ContentEntry[],
  key: string,
  locale: 'en' | 'hi',
): ContentField {
  const entry = entries.find((e) => e.key === key && e.locale === locale);
  return {
    text: entry?.published ? asText(entry.published.value) : '',
    draftVersion: entry?.draft?.version ?? null,
    publishedVersion: entry?.published?.version ?? null,
  };
}

export type ContentStep =
  | { kind: 'none' }
  | { kind: 'publish'; text: string; draftVersion: number | null }
  | { kind: 'unpublish'; version: number };

/** What saving one field needs: nothing, draft + publish, or unpublish. */
export function contentStep(field: ContentField, typed: string): ContentStep {
  const text = typed.trim();
  if (text === field.text.trim()) return { kind: 'none' };
  if (text === '')
    return field.publishedVersion === null
      ? { kind: 'none' }
      : { kind: 'unpublish', version: field.publishedVersion };
  return { kind: 'publish', text, draftVersion: field.draftVersion };
}
