import { accountPrefill, loadCheckout, type RazorpaySuccess } from './pay-online';

/**
 * Pay a workshop service bill online with Razorpay Standard Checkout (spec 03 "Service bill payments"). Loaded only
 * when the customer taps "Pay online" (dynamic import, like the order flow), so nothing here is in a page bundle.
 * 1. `POST /v1/service-requests/{code}/pay` returns the Razorpay order for the bill total (the server's amount; the
 *    browser never sends one; a double tap returns the same order);
 * 2. Razorpay Checkout opens with that order;
 * 3. on success `POST /v1/payments/razorpay/verify` checks the signature and fetches the payment before the bill counts
 *    as paid; the webhook may confirm first, so the request is read again before a result is called "not confirmed".
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type PayBillResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'sign_in' | 'unavailable' | 'cancelled' | 'failed' | 'not_confirmed' | 'api';
      /** The API error code when `reason` is `api` (shown through the `request.api_err_*` messages). */
      code?: string;
    };

interface Handle {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return body.error?.code ?? `HTTP_${String(res.status)}`;
}

async function billPaid(code: string, token: string): Promise<boolean> {
  const res = await fetch(`${API}/v1/service-requests/${encodeURIComponent(code)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return false;
  const body = (await res.json()) as { status?: string };
  return body.status === 'paid' || body.status === 'completed';
}

export async function payBill(input: { code: string; locale: string }): Promise<PayBillResult> {
  if (!API) return { ok: false, reason: 'unavailable' };
  const { currentIdToken } = await import('@/lib/auth/firebase-client');
  const token = await currentIdToken(input.locale).catch(() => null);
  if (!token) return { ok: false, reason: 'sign_in' };
  try {
    const started = await fetch(`${API}/v1/service-requests/${encodeURIComponent(input.code)}/pay`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!started.ok) return { ok: false, reason: 'api', code: await errorCode(started) };
    const handle = (await started.json()) as Handle;
    const Razorpay = await loadCheckout();
    if (!Razorpay) return { ok: false, reason: 'unavailable' };
    const prefill = await accountPrefill();
    const success = await new Promise<RazorpaySuccess | 'cancelled' | 'failed'>((resolve) => {
      let failedOnce = false;
      const rzp = new Razorpay({
        key: handle.keyId,
        order_id: handle.orderId,
        amount: handle.amountPaise,
        currency: handle.currency,
        name: 'MechDost',
        description: input.code,
        prefill,
        theme: { color: '#ea5728' },
        handler: (res: RazorpaySuccess) => {
          resolve(res);
        },
        modal: {
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
    if (success === 'cancelled' || success === 'failed') return { ok: false, reason: success };
    // Money may already be taken: from here a failure is "not confirmed yet", never "unavailable".
    const verified = await fetch(`${API}/v1/payments/razorpay/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        razorpayOrderId: success.razorpay_order_id,
        razorpayPaymentId: success.razorpay_payment_id,
        razorpaySignature: success.razorpay_signature,
      }),
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { outcome: string }).outcome : null))
      .catch(() => null);
    if (verified === 'paid' || (await billPaid(input.code, token))) return { ok: true };
    return { ok: false, reason: 'not_confirmed' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
