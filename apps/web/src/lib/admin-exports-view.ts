import { exportRangeError } from '@mechdost/shared/exports';
import { istDateString } from '@mechdost/shared/time';

/**
 * Small pure helpers of the Exports screen (design 2026-11-15 item 4): the default range, the client-side range
 * check (the API checks again) and the API error codes to message keys. Kept out of the component so they are
 * unit-tested.
 */
export type ExportErrorKey =
  | 'err_rangeLong'
  | 'err_rangeOrder'
  | 'err_rangeDate'
  | 'err_tooLarge'
  | 'err_linkExpired'
  | 'err_unavailable'
  | 'err_cityCustomers';

const BY_CODE: Record<string, ExportErrorKey> = {
  EXPORT_RANGE_TOO_LONG: 'err_rangeLong',
  EXPORT_RANGE_ORDER: 'err_rangeOrder',
  EXPORT_RANGE_DATE: 'err_rangeDate',
  EXPORT_TOO_LARGE: 'err_tooLarge',
  EXPORT_LINK_EXPIRED: 'err_linkExpired',
  EXPORT_LINK_INVALID: 'err_linkExpired',
  EXPORT_CITY_NOT_FOR_CUSTOMERS: 'err_cityCustomers',
  EXPORTS_UNAVAILABLE: 'err_unavailable',
};

/** The screen's own message for an API error code, or null (the screen then uses the shared common errors). */
export const exportErrorKey = (code: string): ExportErrorKey | null => BY_CODE[code] ?? null;

/** The last 30 IST days ending today (both inclusive). */
export function defaultExportRange(now: Date): { from: string; to: string } {
  return { from: istDateString(new Date(now.getTime() - 29 * 86_400_000)), to: istDateString(now) };
}

const RANGE_KEY = {
  RANGE_DATE: 'err_rangeDate',
  RANGE_ORDER: 'err_rangeOrder',
  RANGE_TOO_LONG: 'err_rangeLong',
} as const satisfies Record<string, ExportErrorKey>;

/** A message key when the range is empty, reversed, impossible or over 180 days; otherwise null. */
export function localRangeError(from: string, to: string): ExportErrorKey | null {
  const bad = exportRangeError(from, to);
  return bad ? RANGE_KEY[bad] : null;
}
