import { istDateString, istStartOfDay } from './time';

/**
 * Date ranges of the admin analytics (spec 08 "Analytics"): inclusive IST calendar days (`YYYY-MM-DD`), turned into a
 * half-open UTC interval [from IST midnight, day after `to` IST midnight). Zod-free, so the API, the db layer and the
 * web picker share it. The range is capped so a query never scans more than ~6 monthly event partitions.
 */
export const ANALYTICS_DEFAULT_DAYS = 30;
export const ANALYTICS_MAX_DAYS = 180;

export interface AnalyticsRange {
  fromDate: string;
  toDate: string;
  days: number;
}
export type AnalyticsRangeResult =
  ({ ok: true } & AnalyticsRange) | { ok: false; code: 'RANGE_INVALID' | 'RANGE_TOO_LONG' };

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30 and 2026-13-01). */
function isDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** `date` moved by `n` calendar days (UTC arithmetic on a date string: no time zone involved). */
export function shiftDate(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * The range for `?from=&to=`: missing `to` = today (IST); missing `from` = 30 days ending at `to`. Refused when a date
 * is malformed, `from` is after `to` or in the future, or the range is longer than 180 days.
 */
export function resolveAnalyticsRange(
  input: { from?: string | null; to?: string | null },
  now: Date,
): AnalyticsRangeResult {
  const today = istDateString(now);
  const to = input.to ?? today;
  const from = input.from ?? shiftDate(to, -(ANALYTICS_DEFAULT_DAYS - 1));
  if (!isDate(from) || !isDate(to) || from > to || from > today) return { ok: false, code: 'RANGE_INVALID' };
  const days = daysBetween(from, to);
  if (days > ANALYTICS_MAX_DAYS) return { ok: false, code: 'RANGE_TOO_LONG' };
  return { ok: true, fromDate: from, toDate: to, days };
}

/** The UTC instants of a range ([from, to)) and every IST date in it, oldest first (chart axes, zero-filled series). */
export function analyticsDays(range: AnalyticsRange): {
  fromInstant: Date;
  toInstant: Date;
  dates: string[];
} {
  const dates = Array.from({ length: range.days }, (_, i) => shiftDate(range.fromDate, i));
  return {
    fromInstant: istStartOfDay(range.fromDate),
    toInstant: istStartOfDay(shiftDate(range.toDate, 1)),
    dates,
  };
}
