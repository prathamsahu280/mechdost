import {
  claimRefundDispatch,
  dueRefundIds,
  recordRefundDispatchError,
  recordRefundSent,
  type Tx,
} from '@mechdost/db/repo';
import { RazorpayError, type RazorpayGateway } from './razorpay';

/**
 * Sending an approved refund to Razorpay (spec 05; razorpay-payments skill). Only approved refunds are ever sent; the
 * claim lets one sender work on a refund at a time; Razorpay's `X-Refund-Idempotency` header (our idem key) makes a
 * retry after a lost answer return the same refund. A refusal (4xx other than 408/429) fails the refund, anything else
 * (5xx, 429, network, timeout) is tried again by the worker with a growing delay, eight times at most.
 */
export type DispatchResult = 'sent' | 'retry' | 'failed' | 'skipped';

const isRefusal = (err: unknown): err is RazorpayError =>
  err instanceof RazorpayError &&
  err.httpStatus >= 400 &&
  err.httpStatus < 500 &&
  err.httpStatus !== 408 &&
  err.httpStatus !== 429;

export async function dispatchRefund(
  db: Tx,
  gateway: RazorpayGateway,
  refundId: string,
): Promise<DispatchResult> {
  const job = await claimRefundDispatch(db, refundId);
  if (!job) return 'skipped';
  if (!job.providerPaymentId) {
    await recordRefundDispatchError(db, refundId, { permanent: true, code: 'payment_not_captured' });
    return 'failed';
  }
  try {
    const created = await gateway.createRefund({
      paymentId: job.providerPaymentId,
      amountPaise: job.amountPaise,
      idemKey: job.idemKey,
      refundId: job.refundId,
    });
    if (created.amountPaise !== job.amountPaise) {
      // Razorpay refunded a different amount than we asked for: never trust it silently.
      await recordRefundDispatchError(db, refundId, { permanent: true, code: 'provider_amount_mismatch' });
      return 'failed';
    }
    await recordRefundSent(db, refundId, created.id);
    return 'sent';
  } catch (err) {
    if (isRefusal(err)) {
      await recordRefundDispatchError(db, refundId, {
        permanent: true,
        code: `razorpay_${String(err.httpStatus)}`,
      });
      return 'failed';
    }
    const code = err instanceof RazorpayError ? `razorpay_${String(err.httpStatus)}` : 'network';
    await recordRefundDispatchError(db, refundId, { permanent: false, code });
    return 'retry';
  }
}

/** The worker's sweep: approved refunds that were never sent (a crash after the approval) or whose retry is due. */
export async function dispatchDueRefunds(
  db: Tx,
  gateway: RazorpayGateway,
): Promise<{ sent: number; retry: number; failed: number }> {
  const out = { sent: 0, retry: 0, failed: 0 };
  for (const id of await dueRefundIds(db, 20)) {
    const r = await dispatchRefund(db, gateway, id);
    if (r === 'sent') out.sent += 1;
    else if (r === 'retry') out.retry += 1;
    else if (r === 'failed') out.failed += 1;
  }
  return out;
}
