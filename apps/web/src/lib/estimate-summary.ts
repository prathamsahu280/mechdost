import { computeServiceBill, type EstimateDecision, type EstimateLine } from '@mechdost/shared/service-bill';

/**
 * What the workshop's job card shows for an estimate (QA 2026-11-16, bug 5). Once the customer decided, the total is
 * the approved lines only, exactly the bill's maths; a bill that exists is the stored truth. While the customer has
 * not decided, every line counts. "With GST" only when a line actually carries GST (the rate is 0 for a workshop
 * that is not registered).
 */
export function estimateSummary(
  est: { status: 'sent' | 'decided'; items: readonly EstimateLine[] },
  bill: { totalPaise: number; gstRegistered: boolean } | null,
): {
  totalPaise: number;
  withGst: boolean;
  lines: { id: string; decision: EstimateDecision }[];
} {
  const counted = est.items.map((l) => ({
    ...l,
    decision: est.status === 'decided' ? l.decision : ('approved' as const),
  }));
  const computed = computeServiceBill(counted, { gstRegistered: true });
  return {
    totalPaise: bill ? bill.totalPaise : computed.totalPaise,
    withGst: bill ? bill.gstRegistered : computed.lines.some((l) => l.gstRateBp > 0),
    lines: est.items.map((l) => ({ id: l.id, decision: l.decision })),
  };
}

/** "Approved total (incl. GST)" only when a line carries GST; a workshop without GST gets the plain total (pass 4, bug 6). */
export function approvedTotalKey(hasGst: boolean): 'approvedTotal' | 'approvedTotalNoGst' {
  return hasGst ? 'approvedTotal' : 'approvedTotalNoGst';
}
