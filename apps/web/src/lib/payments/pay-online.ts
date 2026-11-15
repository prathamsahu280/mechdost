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
        | 'verify_email'
        | 'unavailable'
        | 'cart_changed'
        | 'price_changed'
        /** The coins chosen are no longer allowed (balance or cap changed): re-check them. */
        | 'coins_changed'
        /** The coupon no longer applies (used up, ended, or the cart changed): it is dropped and the total re-quoted. */
        | 'coupon_invalid'
        | 'blocked'
        | 'cancelled'
        | 'failed'
        | 'not_confirmed'
        /** The payment window of this order closed: the next try starts a new order. */
        | 'expired'
        /** Name, phone or address changed since the last try: the next try starts a new order. */
        | 'details_changed';
      orderCode?: string;
    };

export interface PayOnlineInput {
  locale: string;
  /** Same key for a retry of the same attempt: the API returns the same order, never a second one. */
  idempotencyKey: string;
  lines: { sku: string; qty: number }[];
  address: { contactName: string; contactPhone: string; line1: string; pincode: string };
  /** Optional business purchase (GST invoice). */
  business?: { gstin: string; businessName: string } | null;
  /** MechDost Coins to use and the discount they give (spec 20); the API re-checks both. */
  coins?: { count: number; discountPaise: number } | null;
  /** One coupon (spec 03) and the discount it gave on the screen; the API re-checks it and the total. */
  coupon?: { code: string; discountPaise: number } | null;
}

interface RazorpayHandle {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
}

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: () => void): void;
}

export type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<RazorpayConstructor | null> | null = null;

/** Load checkout.js once (allowed by the CSP in real-sign-in builds). */
export function loadCheckout(): Promise<RazorpayConstructor | null> {
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

/** Has the order been paid (by the callback or by Razorpay's webhook)? */
async function orderPaid(code: string, token: string): Promise<boolean> {
  const res = await fetch(`${API}/v1/orders/${encodeURIComponent(code)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return false;
  return ((await res.json()) as { paymentStatus?: string }).paymentStatus === 'paid';
}

const errorCode = async (res: Response) =>
  ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';

export async function payOnline(input: PayOnlineInput): Promise<PayOnlineResult> {
  if (!API) return { ok: false, reason: 'unavailable' };
  const { currentIdToken } = await import('@/lib/auth/firebase-client');
  let token = await currentIdToken(input.locale).catch(() => null);
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
    const order = {
      address: input.address,
      lines: input.lines,
      expectedTotalPaise:
        quote.onlineTotalPaise - (input.coupon?.discountPaise ?? 0) - (input.coins?.discountPaise ?? 0),
      paymentMethod: 'online',
      ...(input.business ? { business: input.business } : {}),
      ...(input.coins && input.coins.count > 0 ? { coins: input.coins.count } : {}),
      ...(input.coupon ? { couponCode: input.coupon.code } : {}),
      locale: input.locale === 'hi' ? 'hi' : 'en',
    };
    const idem = { 'idempotency-key': input.idempotencyKey };
    let placeRes = await api('/orders', token, order, idem);
    let code = placeRes.ok ? '' : await errorCode(placeRes);
    if (code === 'VERIFICATION_REQUIRED') {
      // The sign-in token still carries the old "email not verified" fact when the email link was opened after
      // signing in: refresh it once, then retry with the same key (never a second order).
      const fresh = await currentIdToken(input.locale, true).catch(() => null);
      if (fresh) {
        token = fresh;
        placeRes = await api('/orders', token, order, idem);
        code = placeRes.ok ? '' : await errorCode(placeRes);
      }
    }
    if (!placeRes.ok) {
      if (code === 'PRICE_CHANGED') return { ok: false, reason: 'price_changed' };
      if (code === 'COINS_CHANGED' || code === 'INSUFFICIENT_COINS')
        return { ok: false, reason: 'coins_changed' };
      if (code === 'COUPON_INVALID') return { ok: false, reason: 'coupon_invalid' };
      if (code === 'ORDERS_BLOCKED') return { ok: false, reason: 'blocked' };
      if (code === 'VERIFICATION_REQUIRED') return { ok: false, reason: 'verify_email' };
      if (code === 'AUTH_REQUIRED') return { ok: false, reason: 'sign_in' };
      if (code === 'CHECKOUT_UNAVAILABLE' || code === 'OUT_OF_STOCK')
        return { ok: false, reason: 'cart_changed' };
      if (code === 'IDEMPOTENCY_MISMATCH') return { ok: false, reason: 'details_changed' };
      return { ok: false, reason: 'unavailable' };
    }
    const placed = (await placeRes.json()) as {
      code: string;
      paymentStatus: string;
      razorpay?: RazorpayHandle | null;
    };
    const handle = placed.razorpay;
    // A retry of an attempt that was already paid (for example the confirmation timed out) is a success, never
    // "choose cash on delivery"; an attempt whose window closed starts over (final review 2026-11-12, finding 4).
    if (!handle) {
      if (placed.paymentStatus === 'paid') return { ok: true, orderCode: placed.code };
      if (placed.paymentStatus === 'expired') return { ok: false, reason: 'expired', orderCode: placed.code };
      return { ok: false, reason: 'unavailable', orderCode: placed.code };
    }

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
    // Money may already be taken here: a failure from now on is "not confirmed yet", never "unavailable".
    const outcome = await api('/payments/razorpay/verify', token, {
      razorpayOrderId: success.razorpay_order_id,
      razorpayPaymentId: success.razorpay_payment_id,
      razorpaySignature: success.razorpay_signature,
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { outcome: string }).outcome : null))
      .catch(() => null);
    // The webhook may have confirmed it first (the callback then answers "unchanged").
    if (outcome === 'paid' || (await orderPaid(placed.code, token)))
      return { ok: true, orderCode: placed.code };
    return { ok: false, reason: 'not_confirmed', orderCode: placed.code };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
