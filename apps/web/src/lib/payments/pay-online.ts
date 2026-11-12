/**
 * Pay online with Razorpay Standard Checkout (spec 03 § Online payment; plan 2026-11-12). Loaded only when the
 * customer chooses "Pay online" (dynamic import: keeps the checkout page inside the JS budget). Steps:
 * 1. the API quotes the cart (server prices) and places the order (`paymentMethod: 'online'`, idempotency key);
 * 2. Razorpay Checkout opens with the order id the API created;
 * 3. on success the API verifies the signature and fetches the payment before marking the order paid.
 * The amount is never sent by the browser. Needs real sign-in (Firebase): the API knows who is paying.
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';

export type PayOnlineResult =
  | { ok: true; orderCode: string }
  | {
      ok: false;
      reason:
        | 'sign_in'
        | 'unavailable'
        | 'cart_changed'
        | 'price_changed'
        | 'blocked'
        | 'cancelled'
        | 'failed'
        | 'not_confirmed';
      orderCode?: string;
    };

export interface PayOnlineInput {
  locale: string;
  /** Same key for a retry of the same attempt: the API returns the same order, never a second one. */
  idempotencyKey: string;
  lines: { sku: string; qty: number }[];
  address: { contactName: string; contactPhone: string; line1: string; pincode: string };
}

interface RazorpayHandle {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
}

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: () => void): void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<RazorpayConstructor | null> | null = null;

/** Load checkout.js once (allowed by the CSP in real-sign-in builds). */
function loadCheckout(): Promise<RazorpayConstructor | null> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_JS;
    script.async = true;
    script.onload = () => {
      resolve(window.Razorpay ?? null);
    };
    script.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

async function api(path: string, token: string | null, body: unknown, extra: Record<string, string> = {}) {
  return fetch(`${API}/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

const errorCode = async (res: Response) =>
  ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';

export async function payOnline(input: PayOnlineInput): Promise<PayOnlineResult> {
  if (!API) return { ok: false, reason: 'unavailable' };
  const { currentIdToken } = await import('@/lib/auth/firebase-client');
  const token = await currentIdToken(input.locale).catch(() => null);
  if (!token) return { ok: false, reason: 'sign_in' };

  try {
    // 1. Server prices (the customer's demo cart lines, re-priced by the API).
    const quoteRes = await api('/checkout/quote', null, {
      pincode: input.address.pincode,
      lines: input.lines,
      locale: input.locale === 'hi' ? 'hi' : 'en',
    });
    if (!quoteRes.ok) return { ok: false, reason: 'cart_changed' };
    const quote = (await quoteRes.json()) as { ok: boolean; onlineTotalPaise: number };
    if (!quote.ok) return { ok: false, reason: 'cart_changed' };

    // 2. Place the order paid online; the API creates and stores the Razorpay order.
    const placeRes = await api(
      '/orders',
      token,
      {
        address: input.address,
        lines: input.lines,
        expectedTotalPaise: quote.onlineTotalPaise,
        paymentMethod: 'online',
        locale: input.locale === 'hi' ? 'hi' : 'en',
      },
      { 'idempotency-key': input.idempotencyKey },
    );
    if (!placeRes.ok) {
      const code = await errorCode(placeRes);
      if (code === 'PRICE_CHANGED') return { ok: false, reason: 'price_changed' };
      if (code === 'ORDERS_BLOCKED') return { ok: false, reason: 'blocked' };
      if (code === 'AUTH_REQUIRED' || code === 'VERIFICATION_REQUIRED')
        return { ok: false, reason: 'sign_in' };
      if (code === 'CHECKOUT_UNAVAILABLE' || code === 'OUT_OF_STOCK')
        return { ok: false, reason: 'cart_changed' };
      return { ok: false, reason: 'unavailable' };
    }
    const placed = (await placeRes.json()) as { code: string; razorpay?: RazorpayHandle | null };
    const handle = placed.razorpay;
    if (!handle) return { ok: false, reason: 'unavailable', orderCode: placed.code };

    // 3. Razorpay Checkout.
    const Razorpay = await loadCheckout();
    if (!Razorpay) return { ok: false, reason: 'unavailable', orderCode: placed.code };
    const success = await new Promise<RazorpaySuccess | 'cancelled' | 'failed'>((resolve) => {
      let failedOnce = false;
      const rzp = new Razorpay({
        key: handle.keyId,
        order_id: handle.orderId,
        amount: handle.amountPaise,
        currency: handle.currency,
        name: 'MechDost',
        description: placed.code,
        prefill: { name: input.address.contactName, contact: input.address.contactPhone },
        theme: { color: '#ea5728' },
        handler: (res: RazorpaySuccess) => {
          resolve(res);
        },
        modal: {
          // Closing after a failed attempt is a failure; closing without trying is a cancel.
          ondismiss: () => {
            resolve(failedOnce ? 'failed' : 'cancelled');
          },
        },
      });
      // Razorpay keeps the modal open after a failed attempt so the customer can retry.
      rzp.on('payment.failed', () => {
        failedOnce = true;
      });
      rzp.open();
    });
    if (success === 'cancelled' || success === 'failed')
      return { ok: false, reason: success, orderCode: placed.code };

    // 4. The API verifies (signature, then a server fetch) before the order counts as paid.
    const verifyRes = await api('/payments/razorpay/verify', token, {
      razorpayOrderId: success.razorpay_order_id,
      razorpayPaymentId: success.razorpay_payment_id,
      razorpaySignature: success.razorpay_signature,
    });
    const verified = verifyRes.ok ? ((await verifyRes.json()) as { outcome: string }) : null;
    if (verified?.outcome !== 'paid') return { ok: false, reason: 'not_confirmed', orderCode: placed.code };
    return { ok: true, orderCode: placed.code };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
