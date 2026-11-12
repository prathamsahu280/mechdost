import {
  applyRazorpayPayment,
  onlineGroupOfUser,
  openPaymentForGroup,
  paymentOfUserGroup,
  recordRazorpayOrder,
  type PaymentOutcome,
  type Tx,
} from '@mechdost/db/repo';
import { ApiError } from '../errors';
import { checkoutSignatureValid, type RazorpayGateway, type RazorpayPayment } from './razorpay';

/** What the browser needs to open Razorpay Checkout for one placed order. */
export interface CheckoutHandle {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
}

/**
 * The Razorpay order for a placed online order: reused while it can still be paid (a retried place never creates a
 * second one), created and stored before the client sees it otherwise. Null once the order is paid or expired.
 */
export async function ensureRazorpayOrder(
  db: Tx,
  gateway: RazorpayGateway,
  input: { userId: string; groupCode: string },
): Promise<CheckoutHandle | null> {
  const group = await onlineGroupOfUser(db, input);
  // Paid, expired, or every part cancelled (the group then expires): nothing to pay.
  if (!['created', 'attempted', 'failed'].includes(group.paymentStatus)) return null;
  const open = await openPaymentForGroup(db, group.id);
  if (open)
    return {
      keyId: gateway.keyId,
      orderId: open.providerOrderId,
      amountPaise: open.amountPaise,
      currency: 'INR',
    };
  // Only the parts still live are charged: a part cancelled before paying is not (final review, finding 3).
  const amountPaise = group.payablePaise;
  if (amountPaise <= 0) return null;
  const created = await gateway.createOrder({
    amountPaise,
    receipt: group.code, // ≤ 40 chars (MD-RPR-2026-XXXXXX)
    notes: { orderCode: group.code },
  });
  if (created.amountPaise !== amountPaise || created.currency !== 'INR')
    throw new ApiError(502, 'PAYMENT_PROVIDER_MISMATCH', 'The payment provider returned a different amount');
  // Two overlapping place calls: the first stored Razorpay order wins and this one is never shown (finding 2).
  const stored = await recordRazorpayOrder(db, {
    groupId: group.id,
    providerOrderId: created.id,
    amountPaise,
  });
  return {
    keyId: gateway.keyId,
    orderId: stored.providerOrderId,
    amountPaise: stored.amountPaise,
    currency: 'INR',
  };
}

/** A Razorpay payment as the fact our repository understands (null for states that change nothing). */
export function paymentFact(p: RazorpayPayment, providerOrderId: string) {
  const status =
    p.status === 'captured'
      ? 'captured'
      : p.status === 'authorized'
        ? 'authorized'
        : p.status === 'failed'
          ? 'failed'
          : null;
  if (!status) return null;
  return {
    providerOrderId,
    providerPaymentId: p.id,
    status,
    amountPaise: p.amountPaise,
    currency: p.currency,
    method: p.method,
  } as const;
}

/**
 * The checkout callback (`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`): only the customer's own
 * order (404 otherwise); the signature is checked against OUR stored order id; then the payment is fetched from
 * Razorpay — a valid signature alone never marks an order paid (Razorpay docs: verify before fulfilling).
 */
export async function verifyCheckout(
  db: Tx,
  gateway: RazorpayGateway,
  keySecret: string,
  input: { userId: string; providerOrderId: string; paymentId: string; signature: string },
): Promise<{ orderCode: string; outcome: PaymentOutcome }> {
  const payment = await paymentOfUserGroup(db, {
    userId: input.userId,
    providerOrderId: input.providerOrderId,
  });
  if (
    !checkoutSignatureValid({
      providerOrderId: payment.providerOrderId,
      paymentId: input.paymentId,
      signature: input.signature,
      keySecret,
    })
  )
    throw new ApiError(400, 'SIGNATURE_INVALID', 'The payment could not be verified');
  const fetched = await gateway.fetchPayment(input.paymentId);
  if (fetched.orderId !== payment.providerOrderId)
    throw new ApiError(400, 'SIGNATURE_INVALID', 'The payment belongs to another order');
  const fact = paymentFact(fetched, payment.providerOrderId);
  if (!fact) return { orderCode: payment.groupCode, outcome: 'unchanged' };
  const { outcome } = await applyRazorpayPayment(db, fact);
  return { orderCode: payment.groupCode, outcome };
}
