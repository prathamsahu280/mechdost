/**
 * CSV exports (design 2026-11-15 item 4, specs 08/13/14). Pure helpers shared by the repository, the API and the
 * Exports screen: the dataset catalogue, the request/response DTOs, the 180-day rule, and the CSV writer
 * (RFC 4180 quoting, formula neutralising, UTF-8 BOM, exact rupee strings from integer paise, IST times).
 */
import { z } from 'zod';
import type { Permission } from './rbac';
import { istStartOfDay } from './time';

export const EXPORT_DATASETS = [
  'orders',
  'sub_orders',
  'refunds',
  'service_requests',
  'partners',
  'customers',
  'coupon_usage',
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** Longest range one export may cover, both days inclusive. */
export const MAX_EXPORT_DAYS = 180;
/** Hard cap on rows in one file: a bigger range is refused with a message to narrow it, never truncated silently. */
export const MAX_EXPORT_ROWS = 50_000;
/** How long a download link stays valid. */
export const EXPORT_LINK_TTL_SECONDS = 600;

/**
 * What a dataset needs on top of `exports:run`. Customers carry no city yet, so that dataset also needs an
 * all-cities grant (like the customer screens).
 */
export const EXPORT_DATASET_PERMISSION = {
  orders: 'orders:read',
  sub_orders: 'orders:read',
  refunds: 'refunds:read',
  service_requests: 'service:read',
  partners: 'partners:read',
  customers: 'customers:read',
  /** One row per coupon use (2026-11-16); the people who manage coupons read their usage. */
  coupon_usage: 'coupons:write',
} as const satisfies Record<ExportDataset, Permission>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ExportRequestDto = z
  .object({
    dataset: z.enum(EXPORT_DATASETS),
    /** City code (`RPR`); omitted = every city the staff member may export. */
    cityCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    /** IST calendar days, both inclusive. */
    from: Day,
    to: Day,
  })
  .strict();
export type ExportRequest = z.infer<typeof ExportRequestDto>;

export const ExportTicketDto = z.object({
  /** Path (under /v1) to fetch, with the same bearer token, within 10 minutes. */
  downloadPath: z.string(),
  expiresAt: z.string(),
  fileName: z.string(),
  rowCount: z.number().int().min(0),
  /** True when phone and email columns are masked (the viewer lacks `customers:read_pii`). */
  masked: z.boolean(),
});
export type ExportTicket = z.infer<typeof ExportTicketDto>;

export const ExportOptionsDto = z.object({
  /** Datasets this staff member may export (exports:run plus the dataset's own read permission and scope). */
  datasets: z.array(z.enum(EXPORT_DATASETS)),
  /** Cities they may pick (the cities their grants cover). */
  cities: z.array(z.object({ code: z.string(), name: z.string(), nameHi: z.string().nullable() })),
  /** Customer phone and email columns are masked for this viewer. */
  contactsMasked: z.boolean(),
});
export type ExportOptions = z.infer<typeof ExportOptionsDto>;

export type ExportRangeError = 'RANGE_DATE' | 'RANGE_ORDER' | 'RANGE_TOO_LONG';

function realDay(day: string): number | null {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

/** Null when `from`..`to` (IST days, inclusive) is a real range of at most 180 days. */
export function exportRangeError(from: string, to: string): ExportRangeError | null {
  const a = realDay(from);
  const b = realDay(to);
  if (a === null || b === null) return 'RANGE_DATE';
  if (b < a) return 'RANGE_ORDER';
  if ((b - a) / 86_400_000 + 1 > MAX_EXPORT_DAYS) return 'RANGE_TOO_LONG';
  return null;
}

/** The instants an export reads: start of `from` (IST) up to, excluding, the start of the day after `to`. */
export function exportWindow(from: string, to: string): { start: Date; end: Date } {
  return { start: istStartOfDay(from), end: new Date(istStartOfDay(to).getTime() + 86_400_000) };
}

/** Excel opens a UTF-8 CSV correctly (Hindi included) only with this byte order mark first. */
export const CSV_BOM = String.fromCharCode(0xfeff);

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One CSV cell. A text starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` so a spreadsheet treats it
 * as text (OWASP CSV injection); then RFC 4180 quoting when it holds a comma, quote, CR or LF. Numbers and booleans
 * come from our own typed columns and are never user text, so they are written as they are.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvLine(cells: readonly CsvValue[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

/** Integer paise as a rupee string with two decimals ("1234.56"), by string maths only. */
export function paiseToRupees(paise: number | bigint | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  if (typeof paise === 'number' && !Number.isSafeInteger(paise))
    throw new RangeError(`paise must be a safe integer, got ${String(paise)}`);
  const big = BigInt(paise);
  const abs = big < 0n ? -big : big;
  const rupees = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${big < 0n ? '-' : ''}${rupees.toString()}.${rest}`;
}
