/**
 * Scrub free text before it becomes analytics data (spec 12, hard rule 16; security review 2026-11-03). People
 * paste phone numbers and emails into search boxes. Emails and digit runs of 7+ (phone numbers, account or
 * card numbers) become "#"; short codes stay (part numbers like XLTZ4A, tyre sizes like 185/65 R15).
 * Dependency-free so the browser can use it without pulling a validator into the bundle.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LONG_DIGITS = /\+?\d[\d\s-]{5,}\d/g;

export function scrubFreeText(text: string, max = 80): string {
  return text
    .replace(EMAIL, '#')
    .replace(LONG_DIGITS, (m) => (m.replace(/\D/g, '').length >= 7 ? '#' : m))
    .trim()
    .slice(0, max);
}
