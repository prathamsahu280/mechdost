import { sql } from 'drizzle-orm';
import { financialYear, formatInvoiceNumber } from '@mechdost/shared/invoice';
import type { Tx } from './orders';

/**
 * Allocate the next gapless GST invoice number for a series (CGST Rule 46). MUST be called inside the same
 * transaction that inserts the invoice row: if that transaction rolls back, the number is released.
 */
export async function allocateInvoiceNumber(tx: Tx, series: string, at: Date = new Date()) {
  const fy = financialYear(at);
  const result = (await tx.execute(sql`select public.allocate_invoice_seq(${series}, ${fy}) as seq`)) as unknown;
  const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
  const seq = Number((rows[0] as { seq: number | string }).seq);
  return { series, fy, seq, number: formatInvoiceNumber(series, fy, seq) };
}
