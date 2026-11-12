/**
 * Pay online (final review 2026-11-12, finding 4): retries must never tell a customer who already paid to choose
 * cash on delivery, and a closed or changed attempt starts over instead of getting stuck. The API and Razorpay
 * Checkout are fakes; nothing leaves the test.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { payOnline as PayOnlineFn } from '@/lib/payments/pay-online';

vi.mock('@/lib/auth/firebase-client', () => ({
  currentIdToken: () => Promise.resolve('token-test'),
}));

let payOnline: typeof PayOnlineFn;

const API = 'http://api.test';
const INPUT = {
  locale: 'en',
  idempotencyKey: 'pay-online-test-000001',
  lines: [{ sku: 'SKU-1', qty: 1 }],
  address: { contactName: 'Ravi', contactPhone: '+919876543210', line1: 'House 12', pincode: '492004' },
};
const HANDLE = { keyId: 'rzp_test_Fake', orderId: 'order_Fake000001', amountPaise: 48900, currency: 'INR' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake API: quote always fine; the place answer, the verify answer and the order status are per test. */
function fakeApi(opts: { place: () => Response; verify?: () => Promise<Response>; orderStatus?: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/checkout/quote'))
        return Promise.resolve(json(200, { ok: true, onlineTotalPaise: 48900 }));
      if (url.endsWith('/v1/orders') && init?.method === 'POST') return Promise.resolve(opts.place());
      if (url.endsWith('/v1/payments/razorpay/verify'))
        return opts.verify ? opts.verify() : Promise.resolve(json(200, { outcome: 'paid' }));
      if (url.includes('/v1/orders/'))
        return Promise.resolve(json(200, { paymentStatus: opts.orderStatus ?? 'created' }));
      return Promise.reject(new Error(`unexpected ${url}`));
    }),
  );
}

/** Razorpay Checkout that completes the payment as soon as it opens. */
class PayingCheckout {
  constructor(private readonly options: { handler: (r: unknown) => void; order_id: string }) {}
  /** Failure events never fire in these tests. */
  on(): void {
    return undefined;
  }
  open() {
    this.options.handler({
      razorpay_payment_id: 'pay_Fake000001',
      razorpay_order_id: this.options.order_id,
      razorpay_signature: 'sig',
    });
  }
}

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  ({ payOnline } = await import('@/lib/payments/pay-online'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payOnline retries', () => {
  it('a retry of an attempt that was already paid is a success', async () => {
    fakeApi({
      place: () => json(200, { code: 'MD-RPR-2026-AAAAAA', paymentStatus: 'paid', razorpay: null }),
    });
    expect(await payOnline(INPUT)).toEqual({ ok: true, orderCode: 'MD-RPR-2026-AAAAAA' });
  });

  it('a retry after the payment window closed starts over', async () => {
    fakeApi({
      place: () => json(200, { code: 'MD-RPR-2026-BBBBBB', paymentStatus: 'expired', razorpay: null }),
    });
    expect(await payOnline(INPUT)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('changed details under the same attempt start over instead of "unavailable"', async () => {
    fakeApi({ place: () => json(409, { error: { code: 'IDEMPOTENCY_MISMATCH' } }) });
    expect(await payOnline(INPUT)).toMatchObject({ ok: false, reason: 'details_changed' });
  });
});

describe('after Razorpay took the payment', () => {
  const placed = () => json(201, { code: 'MD-RPR-2026-CCCCCC', paymentStatus: 'created', razorpay: HANDLE });

  it('a failed confirmation call is "not confirmed yet", never "unavailable"', async () => {
    vi.stubGlobal('window', { Razorpay: PayingCheckout });
    fakeApi({ place: placed, verify: () => Promise.reject(new Error('timeout')) });
    expect(await payOnline(INPUT)).toMatchObject({ ok: false, reason: 'not_confirmed' });
  });

  it('counts as paid when the webhook confirmed it first', async () => {
    vi.stubGlobal('window', { Razorpay: PayingCheckout });
    fakeApi({
      place: placed,
      verify: () => Promise.resolve(json(200, { outcome: 'unchanged' })),
      orderStatus: 'paid',
    });
    expect(await payOnline(INPUT)).toEqual({ ok: true, orderCode: 'MD-RPR-2026-CCCCCC' });
  });
});
