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

/** The money parts of an invoice or credit note: taxable value plus GST, all integer paise, total = their sum. */
export interface InvoiceParts {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/**
 * Split a credit note's total across the components of the invoice it reduces (spec 05 "Credit notes").
 * `remaining` is what the invoice has left after earlier credit notes. A credit note that uses up the whole remainder
 * takes each component's exact remainder, so all credit notes together add up to the invoice to the paisa. Otherwise
 * the taxable part is proportional (round half up) and the tax is CGST = SGST (intra-state) or all IGST. Returns null
 * when the proportional split would overdraw a component (rounding corner): the caller raises an alert instead.
 */
export function splitCreditNote(
  invoice: InvoiceParts,
  remaining: InvoiceParts,
  totalPaise: number,
): InvoiceParts | null {
  const invoiceTotal = invoice.taxablePaise + invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
  const left = remaining.taxablePaise + remaining.cgstPaise + remaining.sgstPaise + remaining.igstPaise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1 || invoiceTotal < 1 || totalPaise > left)
    return null;
  if (totalPaise === left) return { ...remaining };
  const t = BigInt(totalPaise);
  const whole = BigInt(invoiceTotal);
  let taxable = Number((2n * t * BigInt(invoice.taxablePaise) + whole) / (2n * whole));
  const intra = invoice.igstPaise === 0;
  if (intra && (totalPaise - taxable) % 2 === 1) taxable = taxable < totalPaise ? taxable + 1 : taxable - 1;
  const tax = totalPaise - taxable;
  const parts: InvoiceParts = intra
    ? { taxablePaise: taxable, cgstPaise: tax / 2, sgstPaise: tax / 2, igstPaise: 0 }
    : { taxablePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
  const fits =
    parts.taxablePaise >= 0 &&
    parts.taxablePaise <= remaining.taxablePaise &&
    parts.cgstPaise <= remaining.cgstPaise &&
    parts.sgstPaise <= remaining.sgstPaise &&
    parts.igstPaise <= remaining.igstPaise;
  return fits ? parts : null;
}
