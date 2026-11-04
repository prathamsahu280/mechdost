/**
 * Admin-editable site text (hard rule 8; spec 08 "Content"). One registry for the demo editor and the content
 * API, so both accept the same keys and the same limits (demo/API parity, advisor L58). A value is plain text
 * per key and locale; an empty or missing value means "use the default text from the locale files".
 * Hindi is edited and published separately per key (hard rule 10): `/hi` falls back to the Hindi default, never
 * to English.
 */
export const CONTENT_LOCALES = ['en', 'hi'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export const CONTENT_KEYS = [
  'announcement.orders',
  'announcement.workshops',
  'hero.eyebrow',
  'hero.titleLine1',
  'hero.titleLine2',
  'hero.lead',
] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

const CONTENT_MAX: Partial<Record<ContentKey, number>> = { 'hero.lead': 280 };
export const CONTENT_MAX_DEFAULT = 80;

export function isContentKey(key: string): key is ContentKey {
  return (CONTENT_KEYS as readonly string[]).includes(key);
}

export function contentMax(key: ContentKey): number {
  return CONTENT_MAX[key] ?? CONTENT_MAX_DEFAULT;
}

/** Plain text only: control and format characters dropped, whitespace collapsed, trimmed, length capped. */
export function cleanContentText(key: ContentKey, value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, contentMax(key));
}
