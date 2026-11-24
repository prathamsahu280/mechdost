import { accountPrefill, loadCheckout, type RazorpaySuccess } from './pay-online';

/**
 * Pay the advance or the balance of a roadside request with Razorpay Standard Checkout (spec 22). Loaded only when the
 * customer taps pay (dynamic import), so nothing here is in a page bundle. The server's amount is used (the browser never
 * sends one; a double tap returns the same order); after checkout `POST /v1/payments/razorpay/verify` checks the
 * signature and fetches the payment, and the webhook may confirm first, so the request is read again before a result is
 * called "not confirmed".
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type PayRoadsideResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'sign_in' | 'unavailable' | 'cancelled' | 'failed' | 'not_confirmed' | 'api';
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

/** Has the money been applied: the request moved past the step that was waiting for it. */
async function applied(code: string, purpose: 'advance' | 'balance', token: string): Promise<boolean> {
  const res = await fetch(`${API}/v1/roadside/requests/${encodeURIComponent(code)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return false;
  const body = (await res.json()) as { status?: string };
  return purpose === 'advance' ? body.status !== 'awaiting_payment' : body.status === 'completed';
}

export async function payRoadside(input: {
  code: string;
  purpose: 'advance' | 'balance';
  locale: string;
}): Promise<PayRoadsideResult> {
  if (!API) return { ok: false, reason: 'unavailable' };
  const { currentIdToken } = await import('@/lib/auth/firebase-client');
  const token = await currentIdToken(input.locale).catch(() => null);
  if (!token) return { ok: false, reason: 'sign_in' };
  try {
    const started = await fetch(
      `${API}/v1/roadside/requests/${encodeURIComponent(input.code)}/pay-${input.purpose}`,
      { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
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
    if (verified === 'paid' || (await applied(input.code, input.purpose, token))) return { ok: true };
    return { ok: false, reason: 'not_confirmed' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
