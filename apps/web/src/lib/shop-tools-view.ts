import type { SHOP_CSV_ERROR_CODES } from '@mechdost/shared/shop-csv';

/**
 * Pure helpers of the shop portal's next tier, part 2 (design 2026-11-15, items 4 to 7): words for API codes and the
 * numbers on the performance page. No React, no i18n runtime: unit-tested.
 */

const FILE_CODES = [
  'EMPTY',
  'MALFORMED',
  'TOO_MANY_ROWS',
  'HEADER',
  'TOO_LARGE',
  'TYPE',
  'HAS_ERRORS',
  'STALE_OFFER',
  'RATE_LIMITED',
  'NETWORK',
] as const;
export type CsvFileKey = `csvFile_${(typeof FILE_CODES)[number] | 'generic'}`;
export type CsvProblemKey = `csvErr_${(typeof SHOP_CSV_ERROR_CODES)[number]}`;

/** An API error code from a CSV upload → the `shopTier2.csvFile_*` key (`CSV_HEADER` and `HEADER` alike). */
export function csvFileKey(code: string): CsvFileKey {
  const bare = code.startsWith('CSV_') ? code.slice(4) : code;
  if (code === 'HTTP_429') return 'csvFile_RATE_LIMITED';
  const known = FILE_CODES.find((c) => c === bare);
  return known ? `csvFile_${known}` : 'csvFile_generic';
}

/** A line-level problem code → `shopTier2.csvErr_*`. */
export function csvProblemKey(code: (typeof SHOP_CSV_ERROR_CODES)[number]): CsvProblemKey {
  return `csvErr_${code}`;
}

const STATUS_ERRORS = ['NOT_FOUND', 'RATE_LIMITED', 'PHONE_REQUIRED'] as const;
export type StatusErrorKey = `statusErr_${(typeof STATUS_ERRORS)[number] | 'generic'}`;

/** An API error code from the status lookup → `shopTier2.statusErr_*`. */
export function statusErrorKey(code: string): StatusErrorKey {
  if (code === 'HTTP_429') return 'statusErr_RATE_LIMITED';
  const known = STATUS_ERRORS.find((c) => c === code);
  return known ? `statusErr_${known}` : 'statusErr_generic';
}

/** The reference printed on the confirmation: PA-{CITY}-{YYYY}-{6 base32}. */
export const APPLICATION_REF = /^PA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/;
export const normaliseRef = (raw: string): string => raw.trim().toUpperCase();

/** Basis points as a whole percent for the screen (8333 → 83). */
export const percentOf = (bp: number): number => Math.round(bp / 100);

/** Width of a bar for a basis-point value, kept inside 0 to 100. */
export const barWidth = (bp: number | null): number =>
  bp === null ? 0 : Math.min(100, Math.max(0, percentOf(bp)));

/** Seconds as the unit the screen says: under two minutes in seconds, otherwise whole minutes. */
export function acceptTime(seconds: number): { unit: 'seconds' | 'minutes'; count: number } {
  return seconds < 120
    ? { unit: 'seconds', count: seconds }
    : { unit: 'minutes', count: Math.round(seconds / 60) };
}

/** Stars × 100 as one decimal ("4.4"); null stays null. */
export const ratingText = (x100: number | null): string | null =>
  x100 === null ? null : (x100 / 100).toFixed(1);

/** The application stage as an index into the timeline (new, in review, approved), or a closed "rejected". */
export function stageIndex(stage: 'new' | 'in_review' | 'approved' | 'rejected'): number {
  return stage === 'new' ? 0 : stage === 'in_review' ? 1 : 2;
}
