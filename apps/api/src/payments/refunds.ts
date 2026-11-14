import {
  applyRazorpayRefund,
  claimRefundDispatch,
  claimRefundReconcile,
  dueReconciliationIds,
  dueRefundIds,
  recordRefundDispatchError,
  recordRefundNeedsReconciliation,
  recordRefundSent,
  resolveRefundAbsent,
  type Tx,
} from '@mechdost/db/repo';
import { RazorpayError, type RazorpayGateway, type RazorpayRefund } from './razorpay';

/**
 * Sending an approved refund to Razorpay (spec 05; razorpay-payments skill). Only approved refunds are ever sent; the
 * claim lets one sender work on a refund at a time; Razorpay's `X-Refund-Idempotency` header (our idem key) makes a
 * retry after a lost answer return the same refund.
 *
 * **An uncertain outcome never frees the money** (security review 2026-11-15): a timeout can mean Razorpay did create
 * the refund. After any failed call we look the refund up at Razorpay (by our refund id in its notes):
 * - found: it is recorded (and settled, if Razorpay already says so); never created a second time;
 * - confirmed absent and the call was a refusal (4xx): only then is it failed and its amount freed;
 * - absent after a temporary error: tried again later (eight tries, then `needs_reconciliation`, amount still held);
 * - the lookup itself failed, or Razorpay reported another amount: `needs_reconciliation`, amount still held, alert.
 */
export type DispatchResult = 'sent' | 'retry' | 'failed' | 'reconcile' | 'skipped';

const isRefusal = (err: unknown): err is RazorpayError =>
  err instanceof RazorpayError &&
  err.httpStatus >= 400 &&
  err.httpStatus < 500 &&
  err.httpStatus !== 408 &&
  err.httpStatus !== 429;

type Job = { refundId: string; amountPaise: number; providerPaymentId: string };
type Lookup = { kind: 'found'; refund: RazorpayRefund } | { kind: 'absent' } | { kind: 'unknown' };

async function lookup(gateway: RazorpayGateway, job: Job): Promise<Lookup> {
  try {
    const refund = await gateway.findRefund({ paymentId: job.providerPaymentId, refundId: job.refundId });
    return refund ? { kind: 'found', refund } : { kind: 'absent' };
  } catch {
    return { kind: 'unknown' };
  }
}

/** Razorpay holds a refund for it: record its id, settle it if Razorpay already says so, or flag a different amount. */
async function recordHeld(db: Tx, job: Job, refund: RazorpayRefund): Promise<'sent' | 'reconcile'> {
  if (refund.amountPaise !== job.amountPaise) {
    await recordRefundNeedsReconciliation(db, job.refundId, {
      code: 'provider_amount_mismatch',
      providerRefundId: refund.id,
      reportedPaise: refund.amountPaise,
    });
    return 'reconcile';
  }
  await recordRefundSent(db, job.refundId, refund.id);
  if (refund.status === 'processed' || refund.status === 'failed')
    await applyRazorpayRefund(db, {
      providerRefundId: refund.id,
      providerPaymentId: job.providerPaymentId,
      refundId: job.refundId,
      status: refund.status,
      amountPaise: refund.amountPaise,
      currency: 'INR',
    });
  return 'sent';
}

export async function dispatchRefund(
  db: Tx,
  gateway: RazorpayGateway,
  refundId: string,
): Promise<DispatchResult> {
  const claimed = await claimRefundDispatch(db, refundId);
  if (!claimed) return 'skipped';
  const job: Job = {
    refundId,
    amountPaise: claimed.amountPaise,
    providerPaymentId: claimed.providerPaymentId,
  };
  if (!job.providerPaymentId) {
    // Nothing was ever sent for a payment that was not captured: safe to fail.
    await recordRefundDispatchError(db, refundId, { permanent: true, code: 'payment_not_captured' });
    return 'failed';
  }
  try {
    const created = await gateway.createRefund({
      paymentId: job.providerPaymentId,
      amountPaise: job.amountPaise,
      idemKey: claimed.idemKey,
      refundId,
    });
    return await recordHeld(db, job, created);
  } catch (err) {
    const code = err instanceof RazorpayError ? `razorpay_${String(err.httpStatus)}` : 'network';
    const looked = await lookup(gateway, job);
    if (looked.kind === 'found') return recordHeld(db, job, looked.refund);
    if (isRefusal(err)) {
      if (looked.kind === 'absent') {
        await recordRefundDispatchError(db, refundId, { permanent: true, code });
        return 'failed';
      }
      await recordRefundNeedsReconciliation(db, refundId, { code });
      return 'reconcile';
    }
    // Temporary error and no refund seen: try again later (the idempotency key makes the retry safe).
    await recordRefundDispatchError(db, refundId, { permanent: false, code });
    return 'retry';
  }
}

/** The worker's sweep: approved refunds that were never sent (a crash after the approval) or whose retry is due. */
export async function dispatchDueRefunds(
  db: Tx,
  gateway: RazorpayGateway,
): Promise<{ sent: number; retry: number; failed: number; reconcile: number }> {
  const out = { sent: 0, retry: 0, failed: 0, reconcile: 0 };
  for (const id of await dueRefundIds(db, 20)) {
    const r = await dispatchRefund(db, gateway, id);
    if (r === 'sent' || r === 'retry' || r === 'failed' || r === 'reconcile') out[r] += 1;
  }
  return out;
}

/**
 * Unsure refunds without a Razorpay id: look each up again. Found: recorded and settled. Confirmed absent: failed and
 * its amount freed (the only way an unsure refund fails). The lookup unanswered: left for the next look.
 */
export async function reconcileDueRefunds(
  db: Tx,
  gateway: RazorpayGateway,
): Promise<{ found: number; absent: number; unknown: number }> {
  const out = { found: 0, absent: 0, unknown: 0 };
  for (const id of await dueReconciliationIds(db, 20)) {
    const claimed = await claimRefundReconcile(db, id);
    if (!claimed?.providerPaymentId) continue;
    const job: Job = {
      refundId: id,
      amountPaise: claimed.amountPaise,
      providerPaymentId: claimed.providerPaymentId,
    };
    const looked = await lookup(gateway, job);
    if (looked.kind === 'found') {
      await recordHeld(db, job, looked.refund);
      out.found += 1;
    } else if (looked.kind === 'absent') {
      if (await resolveRefundAbsent(db, id)) out.absent += 1;
    } else out.unknown += 1;
  }
  return out;
}
