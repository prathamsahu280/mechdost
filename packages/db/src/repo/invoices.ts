import { sql } from 'drizzle-orm';
import { financialYear, formatInvoiceNumber } from '@mechdost/shared/invoice';
import type { Tx } from './orders';

/** Normalise the result of `tx.execute()` across drivers (postgres-js returns an array, PGlite `{ rows }`). */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
  return rows?.[0] as Record<string, unknown> | undefined;
}

/**
 * Allocate the next gapless GST invoice number for a series (CGST Rule 46). MUST be called inside the same
 * transaction that inserts the invoice row: if that transaction rolls back, the number is released.
 */
export async function allocateInvoiceNumber(tx: Tx, series: string, at: Date = new Date()) {
  const fy = financialYear(at);
  const row = firstRow(await tx.execute(sql`select public.allocate_invoice_seq(${series}, ${fy}) as seq`));
  const seq = Number(row?.seq);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('allocate_invoice_seq returned no sequence');
  return { series, fy, seq, number: formatInvoiceNumber(series, fy, seq) };
}
