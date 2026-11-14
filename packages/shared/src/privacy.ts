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
  return maskPersonalData(text.slice(0, INPUT_MAX)).trim().slice(0, max);
}

/** Emails and 7+ digit runs become "#", with no length cap (error messages; callers cap the input). */
export function maskPersonalData(text: string): string {
  return text.normalize('NFKC').replace(FORMAT, '').replace(EMAIL, '#').replace(DIGIT_RUN, '#');
}

/**
 * The privacy notice a visitor accepted when they chose "Allow analytics" (the web stores it with the choice and
 * sends it with every event). `2026-11-14` is the first notice that names PostHog (EU) as the analytics provider
 * (decision 2026-11-14), so only events consented under it or a later notice are forwarded there; older choices
 * are asked again by the banner.
 */
export const CONSENT_NOTICE_VERSION = '2026-11-14';

const NOTICE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u;

/** True when the consent was given under the notice that names PostHog, or a later one. */
export function consentAllowsForwarding(version: string | null | undefined): boolean {
  const m = version ? NOTICE.exec(version) : null;
  if (!m) return false;
  const key = `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? '00'}`;
  return key >= CONSENT_NOTICE_VERSION;
}
