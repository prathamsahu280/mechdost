/**
 * Scrub free text before it becomes analytics data (spec 12, hard rule 16; security review 2026-11-03). People
 * paste phone numbers and emails into search boxes. Emails and digit runs of 7+ (phone numbers, account or
 * card numbers) become "#"; short codes stay (part numbers like XLTZ4A, tyre sizes like 185/65 R15).
 * Dependency-free so the browser can use it without pulling a validator into the bundle.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/gu;
// Invisible format characters (zero-width space/joiners, BOM) are removed first, so they cannot split a number.
const FORMAT = /\p{Cf}/gu;
// Seven or more decimal digits in any script (Devanagari, full-width, ASCII) separated only by non-letters of any
// length — spaces, dashes, dots, commas, underscores, brackets, slashes … A letter ends the run, so "185/65 R15"
// stays. Linear time: the gap class excludes digits (security reviews 2026-11-03).
const DIGIT_RUN = /\+?\p{Nd}(?:[^\p{L}\p{Nd}]*\p{Nd}){6,}/gu;
const INPUT_MAX = 500;

export function scrubFreeText(text: string, max = 80): string {
  return text
    .slice(0, INPUT_MAX)
    .normalize('NFKC')
    .replace(FORMAT, '')
    .replace(EMAIL, '#')
    .replace(DIGIT_RUN, '#')
    .trim()
    .slice(0, max);
}
