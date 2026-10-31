/**
 * GST invoice numbering (CGST Rule 46(b)): consecutive serial, ≤ 16 characters, only A–Z 0–9 / -,
 * unique per financial year, one or more series. The sequence itself comes from a gapless counter row in
 * Postgres assigned at invoice finalisation (docs/research/data-integrity.md §1) — never from a sequence.
 */
import { istParts } from './time';

const INVOICE_RE = /^[A-Z0-9][A-Z0-9/-]{0,15}$/;

/** Indian financial year code in IST, April–March: 1 Apr 2026 → "2627". */
export function financialYear(at: Date): string {
  const { year, month } = istParts(at);
  const start = month >= 4 ? year : year - 1;
  const two = (n: number) => String(n % 100).padStart(2, '0');
  return `${two(start)}${two(start + 1)}`;
}

export function isValidGstInvoiceNumber(value: string): boolean {
  return value.length <= 16 && INVOICE_RE.test(value);
}

/** e.g. formatInvoiceNumber('MDR', '2627', 123) → "MDR/2627/000123". Throws if non-compliant. */
export function formatInvoiceNumber(seriesPrefix: string, fy: string, sequence: number): string {
  if (!/^[A-Z0-9]{1,6}$/.test(seriesPrefix)) throw new RangeError(`Invalid series prefix: ${seriesPrefix}`);
  if (!/^\d{4}$/.test(fy)) throw new RangeError(`Invalid FY code: ${fy}`);
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new RangeError('sequence must be a positive integer');
  const value = `${seriesPrefix}/${fy}/${String(sequence).padStart(6, '0')}`;
  if (!isValidGstInvoiceNumber(value))
    throw new RangeError(`Invoice number exceeds Rule 46 limits: ${value}`);
  return value;
}
