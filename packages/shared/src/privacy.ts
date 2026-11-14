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

// Pseudonymous ids we keep (review 2026-11-14): time-ordered UUIDs (v7) and public codes such as MD-RPR-2026-7K3Q9X
// are full of digit runs that look like phone numbers to DIGIT_RUN, but they identify rows, not people.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const PUBLIC_CODE = /[A-Z]{2,4}-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}/u;
const ID_ANYWHERE = new RegExp(`(?<![\\w-])(?:${UUID.source}|${PUBLIC_CODE.source})(?![\\w-])`, 'giu');

/** True when the whole value is a UUID or a public code (MD-…, SR-…, REQ-…, QT-…): kept, never masked. */
export function isPseudonymousId(value: string): boolean {
  return new RegExp(`^(?:${UUID.source}|${PUBLIC_CODE.source})$`, 'iu').test(value);
}

// Placeholders: private-use brackets around lowercase letters (a letter ends a digit run, so masking cannot join
// digits across a kept id).
const OPEN = '\uE000';
const CLOSE = '\uE001';
const PLACEHOLDER = /\uE000([a-z]+)\uE001/gu;

/**
 * `maskPersonalData` that leaves embedded UUIDs and public codes intact (error messages: an order code or a row id
 * is what makes a report useful). The ids are swapped for letter-only placeholders while masking, then put back.
 */
export function maskPersonalDataKeepIds(text: string): string {
  const kept: string[] = [];
  const marked = text.replace(ID_ANYWHERE, (m) => {
    kept.push(m);
    return `${OPEN}${placeholder(kept.length - 1)}${CLOSE}`;
  });
  return maskPersonalData(marked).replace(PLACEHOLDER, (whole, key: string) => kept[indexOf(key)] ?? whole);
}

const placeholder = (n: number): string =>
  n < 26
    ? String.fromCharCode(97 + n)
    : placeholder(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));
const indexOf = (key: string): number => {
  let acc = -1;
  for (let i = 0; i < key.length; i += 1) acc = (acc + 1) * 26 + key.charCodeAt(i) - 97;
  return acc;
};

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
