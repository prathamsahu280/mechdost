/**
 * GST identifiers (research/compare-gstin-onboarding.md §2). No Zod here: browser forms import these checks.
 * - GSTIN: 2-digit state code, 10-character PAN, entity number, `Z`, check character (Luhn mod 36).
 * - Enrolment number (Notification 34/2023-CT): for sellers below the GST threshold who sell through an
 *   e-commerce operator; 12 characters starting with the state code.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ENROLMENT_PATTERN = /^[0-9]{2}[A-Z0-9]{10}$/;

/** State and union-territory codes in use (01–38) and 97 "other territory"; names in i18n `gstStates`. */
export const GST_STATE_CODES: readonly string[] = [
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97',
];

function knownStateCode(code: string): boolean {
  return GST_STATE_CODES.includes(code);
}

/** What people type → the stored form: no spaces, upper case (a GSTIN has no lower-case letters). */
export function normaliseGstin(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** The check character for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(first14.charAt(i));
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET.charAt((36 - (sum % 36)) % 36);
}

export function isGstin(value: string): boolean {
  return (
    GSTIN_PATTERN.test(value) &&
    knownStateCode(value.slice(0, 2)) &&
    gstinCheckChar(value.slice(0, 14)) === value.charAt(14)
  );
}

export function gstinStateCode(gstin: string): string {
  return gstin.slice(0, 2);
}

export function isGstEnrolmentNumber(value: string): boolean {
  return ENROLMENT_PATTERN.test(value) && knownStateCode(value.slice(0, 2));
}
