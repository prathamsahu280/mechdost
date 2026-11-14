/**
 * Workshop estimates and bills (spec 06): an itemised estimate the customer approves line by line; the bill is the
 * approved lines plus GST (0% when the workshop is not GST-registered) plus the rupee round-off. Integer paise only.
 * Shared so the API and the browser demo compute the same totals.
 */
import { invoiceRoundOff, splitExclusiveGst } from './money';

/** GST slabs a workshop can put on a line, in basis points. */
export const ESTIMATE_GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;
export const ESTIMATE_MAX_LINES = 20;
/** GST slab on the home visit fee when the workshop is registered (a service, like the labour lines). */
export const VISIT_FEE_GST_RATE_BP = 1800;
export const VISIT_FEE_LINE_ID = 'visit_fee';
export const ESTIMATE_MAX_UNIT_PAISE = 10_000_000; // ₹1,00,000 a unit

export type EstimateDecision = 'pending' | 'approved' | 'declined';

export interface EstimateLine {
  id: string;
  description: string;
  qty: number;
  unitPaise: number;
  gstRateBp: number;
  decision: EstimateDecision;
}

export interface ServiceBillLine {
  id: string;
  /** 'visit_fee' for the home visit fee line (labelled per language on screen). */
  kind?: 'visit_fee';
  description: string;
  qty: number;
  unitPaise: number;
  gstRateBp: number;
  taxablePaise: number;
  gstPaise: number;
}

export interface ServiceBill {
  lines: ServiceBillLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

/** The first invalid field of a line, or null. */
export function estimateLineError(l: EstimateLine): 'description' | 'qty' | 'price' | 'gst' | null {
  const d = l.description.trim();
  if (d.length < 2 || d.length > 120) return 'description';
  if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 99) return 'qty';
  if (!Number.isInteger(l.unitPaise) || l.unitPaise < 1 || l.unitPaise > ESTIMATE_MAX_UNIT_PAISE)
    return 'price';
  if (!(ESTIMATE_GST_RATES_BP as readonly number[]).includes(l.gstRateBp)) return 'gst';
  return null;
}

/**
 * The bill from an estimate: approved lines only, tax on top per line (CGST + SGST — workshops bill within their
 * own state), then the grand total rounded to the rupee.
 */
export function computeServiceBill(
  lines: readonly EstimateLine[],
  workshop: { gstRegistered: boolean },
  /** Home visit: the fee snapshotted on the request; a waived fee stays on the bill as a 0 line. */
  visitFee?: { paise: number; waived: boolean } | null,
): ServiceBill {
  const billed = lines
    .filter((l) => l.decision === 'approved')
    .map((l): ServiceBillLine => {
      const gstRateBp = workshop.gstRegistered ? l.gstRateBp : 0;
      const taxablePaise = l.qty * l.unitPaise;
      const split = splitExclusiveGst(taxablePaise, gstRateBp, false);
      return {
        id: l.id,
        description: l.description,
        qty: l.qty,
        unitPaise: l.unitPaise,
        gstRateBp,
        taxablePaise,
        gstPaise: split.cgst + split.sgst,
      };
    });
  if (visitFee) {
    const unitPaise = visitFee.waived ? 0 : visitFee.paise;
    const gstRateBp = workshop.gstRegistered ? VISIT_FEE_GST_RATE_BP : 0;
    const split = splitExclusiveGst(unitPaise, gstRateBp, false);
    billed.push({
      id: VISIT_FEE_LINE_ID,
      kind: 'visit_fee',
      description: 'Home visit fee',
      qty: 1,
      unitPaise,
      gstRateBp,
      taxablePaise: unitPaise,
      gstPaise: split.cgst + split.sgst,
    });
  }
  const taxablePaise = billed.reduce((s, l) => s + l.taxablePaise, 0);
  const cgstPaise = billed.reduce((s, l) => s + l.gstPaise / 2, 0);
  const { rounded, roundOff } = invoiceRoundOff(taxablePaise + 2 * cgstPaise);
  return {
    lines: billed,
    taxablePaise,
    cgstPaise,
    sgstPaise: cgstPaise,
    roundOffPaise: roundOff,
    totalPaise: rounded,
  };
}
