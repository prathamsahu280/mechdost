/**
 * Razorpay Standard Checkout for the order of an accepted bulk quote (spec 19 "Online payment"; spec 03). The API has
 * already placed the order and stored the Razorpay order; this opens Checkout with it and, on success, asks the API to
 * verify (signature, then a server fetch) before the order counts as paid. The amount is never sent by the browser.
 * Loaded only when the customer pays online (dynamic import), so the thread screen stays inside its JS budget.
 */
import type { QuotePay } from '@mechdost/shared/quote-api';
import { accountPrefill, loadCheckout, razorpayPrefill, type RazorpaySuccess } from './pay-online';

export type QuoteCheckoutResult =
  { ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' | 'not_confirmed' | 'expired' };

export interface QuoteCheckoutInput {
  locale: string;
  orderCode: string;
  handle: NonNullable<QuotePay['razorpay']>;
  prefill: { name: string; phone: string };
}

export async function checkoutQuote(input: QuoteCheckoutInput): Promise<QuoteCheckoutResult> {
  const Razorpay = await loadCheckout();
  if (!Razorpay) return { ok: false, reason: 'unavailable' };
  const prefill = razorpayPrefill({
    ...(await accountPrefill()),
    name: input.prefill.name,
    contact: input.prefill.phone,
  });
  const outcome = await new Promise<RazorpaySuccess | 'cancelled' | 'failed'>((resolve) => {
    let failedOnce = false;
    const rzp = new Razorpay({
      key: input.handle.keyId,
      order_id: input.handle.orderId,
      amount: input.handle.amountPaise,
      currency: input.handle.currency,
      name: 'MechDost',
      description: input.orderCode,
      prefill,
      theme: { color: '#ea5728' },
      handler: (res: RazorpaySuccess) => {
        resolve(res);
      },
      modal: {
        // Escape or the close button: a failed attempt counts as failed, closing before trying as cancelled.
        ondismiss: () => {
          resolve(failedOnce ? 'failed' : 'cancelled');
        },
      },
    });
    rzp.on('payment.failed', () => {
      failedOnce = true;
    });
    rzp.open();
  });
  if (outcome === 'cancelled' || outcome === 'failed') return { ok: false, reason: outcome };

  // Money may already be taken: from here a failure is "not confirmed yet", never "unavailable".
  const { verifyQuotePayment } = await import('@/lib/quote-api');
  const res = await verifyQuotePayment(input.locale, {
    razorpayOrderId: outcome.razorpay_order_id,
    razorpayPaymentId: outcome.razorpay_payment_id,
    razorpaySignature: outcome.razorpay_signature,
  });
  // "unchanged" means the webhook got there first: the refreshed thread shows the truth either way.
  if (res.ok && res.data.outcome === 'paid') return { ok: true };
  return { ok: false, reason: 'not_confirmed' };
}
