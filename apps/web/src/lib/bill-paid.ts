/** Which "paid" sentence a service bill gets: the Razorpay payment is "online"; cash, UPI and card were taken at the workshop. */
export function billPaidKey(method: string | null): 'billPaid' | 'billPaidOnline' {
  return method === 'online' ? 'billPaidOnline' : 'billPaid';
}

/**
 * The line under the "Bill" step (QA pass 4, bug 9): an unpaid bill can be paid online or at the workshop; a paid bill
 * says how. `null` = no bill data (the demo): the original sentence.
 */
export function billStepDetailKey(
  bill: { paidAt: string | null; method: string | null } | null,
): 'stepDetail_billed' | 'stepDetail_billedPay' | 'stepDetail_billedPaidOnline' | 'stepDetail_billedPaid' {
  if (!bill) return 'stepDetail_billed';
  if (!bill.paidAt) return 'stepDetail_billedPay';
  return bill.method === 'online' ? 'stepDetail_billedPaidOnline' : 'stepDetail_billedPaid';
}
