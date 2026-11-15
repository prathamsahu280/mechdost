import { and, eq, sql } from 'drizzle-orm';
import { splitCreditNote, type InvoiceParts } from '@mechdost/shared/invoice';
import { auditLog, invoices } from '../schema';
import { recordServerEvent } from './events';
import { allocateInvoiceNumber } from './invoices';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/** Credit notes are their own gapless series (spec 14 rule 1), apart from the tax invoices they reduce. */
export const CREDIT_NOTE_SERIES = 'CN';

export interface IssuedCreditNote {
  id: string;
  number: string;
  totalPaise: number;
}

/**
 * A refund of an invoiced order was processed: issue its credit note (spec 05 "Credit notes"; CGST Act s.34).
 * Runs inside the transaction that settles the refund, so the number exists if and only if the refund is processed.
 *
 * - One credit note per refund: the unique index on `refund_id` is the arbiter and a replay finds the first one.
 * - Locks the invoice row, so two refunds of one order are issued one after the other and never exceed the invoice.
 * - The number comes from the gapless counter (`allocateInvoiceNumber`) inside a savepoint: if the note cannot be
 *   written the number is released again, the refund still settles, and the failure is an audited alert for finance
 *   (money state never depends on paperwork).
 * Returns null when there is nothing to issue (no tax invoice yet, already issued, the invoice is used up).
 */
export async function issueCreditNoteForRefund(
  tx: Tx,
  input: { refundId: string; orderId: string; amountPaise: number },
): Promise<IssuedCreditNote | null> {
  const [existing] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.refundId, input.refundId))
    .limit(1);
  if (existing) return null;
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.orderId, input.orderId),
        eq(invoices.kind, 'tax_invoice'),
        eq(invoices.status, 'issued'),
      ),
    )
    .orderBy(sql`${invoices.issuedAt} desc`)
    .limit(1)
    .for('update');
  if (!invoice) return null;
  try {
    return await tx.transaction(async (sp) => {
      const [used] = rowsOf<{ taxable: unknown; cgst: unknown; sgst: unknown; igst: unknown }>(
        await sp.execute(sql`select coalesce(sum(taxable_paise), 0) as taxable, coalesce(sum(cgst_paise), 0) as cgst,
            coalesce(sum(sgst_paise), 0) as sgst, coalesce(sum(igst_paise), 0) as igst
          from invoices where credit_note_for = ${invoice.id} and kind = 'credit_note' and status = 'issued'`),
      );
      const remaining: InvoiceParts = {
        taxablePaise: invoice.taxablePaise - Number(used?.taxable ?? 0),
        cgstPaise: invoice.cgstPaise - Number(used?.cgst ?? 0),
        sgstPaise: invoice.sgstPaise - Number(used?.sgst ?? 0),
        igstPaise: invoice.igstPaise - Number(used?.igst ?? 0),
      };
      const left = remaining.taxablePaise + remaining.cgstPaise + remaining.sgstPaise + remaining.igstPaise;
      if (left <= 0) return null;
      const total = Math.min(input.amountPaise, left);
      const parts = splitCreditNote(invoice, remaining, total);
      if (!parts) throw new Error('credit note split does not fit the invoice');
      const num = await allocateInvoiceNumber(sp, CREDIT_NOTE_SERIES);
      const [row] = await sp
        .insert(invoices)
        .values({
          kind: 'credit_note',
          series: num.series,
          fy: num.fy,
          seq: num.seq,
          number: num.number,
          orderId: invoice.orderId,
          creditNoteFor: invoice.id,
          refundId: input.refundId,
          ...parts,
          totalPaise: total,
        })
        .returning({ id: invoices.id });
      if (!row) throw new Error('credit note not stored');
      await sp.insert(auditLog).values({
        actorUserId: null,
        actorRole: 'system',
        action: 'credit_note.issued',
        entity: 'invoice',
        entityId: row.id,
        after: {
          number: num.number,
          refundId: input.refundId,
          invoiceNumber: invoice.number,
          totalPaise: total,
        },
      });
      await recordServerEvent(sp, 'credit_note_issued', {
        props: { refundId: input.refundId, creditNoteNumber: num.number, totalPaise: total },
      });
      return { id: row.id, number: num.number, totalPaise: total };
    });
  } catch {
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'credit_note.alert.not_issued',
      entity: 'refund',
      entityId: input.refundId,
      after: { invoiceNumber: invoice.number, amountPaise: input.amountPaise },
    });
    return null;
  }
}
