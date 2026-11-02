/**
 * Scrub free text before it becomes analytics data (spec 12, hard rule 16; security review 2026-11-03). People
 * paste phone numbers and emails into search boxes. Emails and digit runs of 7+ (phone numbers, account or
 * card numbers) become "#"; short codes stay (part numbers like XLTZ4A, tyre sizes like 185/65 R15).
 * Dependency-free so the browser can use it without pulling a validator into the bundle.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/gu;
// Any script's decimal digits (Devanagari ९८७…, full-width, ASCII) with spaces, dashes, dots, brackets or slashes
// between them (security review 2026-11-03: "९८७६५ ४३२१०", "98.76.54.32.10", "(0771) 234-5678").
const DIGIT_RUN = /\+?\p{Nd}[\p{Nd}\s\-.()/]{5,}\p{Nd}/gu;
const DIGIT = /\p{Nd}/gu;

export function scrubFreeText(text: string, max = 80): string {
  return text
    .normalize('NFKC')
    .replace(EMAIL, '#')
    .replace(DIGIT_RUN, (m) => ((m.match(DIGIT) ?? []).length >= 7 ? '#' : m))
    .trim()
    .slice(0, max);
}
