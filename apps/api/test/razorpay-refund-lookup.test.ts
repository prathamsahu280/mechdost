/**
 * Looking a refund up at Razorpay (security review 2026-11-15): only a **complete** scan of the payment's refunds with
 * no match may count as "no such refund". A partial page, a scan cut off at the page cap, or an error mid-scan is
 * "unknown", so the refund stays reserved (needs reconciliation) instead of being failed and freed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpRazorpay } from '../src/payments/razorpay';

const ours = '0190e5a0-1111-7aaa-8bbb-123456789abc';
const PAY = 'pay_Test000000001';
const item = (n: number, ref?: string) => ({
  id: `rfnd_${String(n).padStart(12, '0')}`,
  payment_id: PAY,
  amount: 1000,
  currency: 'INR',
  status: 'processed',
  notes: ref ? { refundId: ref } : [],
});
const page = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200 });
const gateway = () => httpRazorpay('rzp_test_Fake0123456789', 'test_key_secret_0123456789');
const find = () => gateway().findRefund({ paymentId: PAY, refundId: ours });

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubPages(pages: (() => Response | Promise<Response>)[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      const next = pages[urls.length - 1];
      return Promise.resolve(next ? next() : page([]));
    }),
  );
  return urls;
}

describe('refund lookup scans every page', () => {
  it('finds our refund on the second page (skip moves on by a full page)', async () => {
    const full = Array.from({ length: 100 }, (_, i) => item(i));
    const urls = stubPages([() => page(full), () => page([item(200), item(201, ours)])]);
    const found = await find();
    expect(found).toMatchObject({ id: item(201).id, amountPaise: 1000 });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('count=100');
    expect(urls[1]).toContain('skip=100');
  });

  it('a short last page with no match is a confirmed absence (null)', async () => {
    const full = Array.from({ length: 100 }, (_, i) => item(i));
    stubPages([() => page(full), () => page([item(300)])]);
    expect(await find()).toBeNull();
  });

  it('a full page and no match at the page cap is unknown, never absent', async () => {
    const full = Array.from({ length: 100 }, (_, i) => item(i));
    const urls = stubPages(Array.from({ length: 12 }, () => () => page(full)));
    await expect(find()).rejects.toThrow(/incomplete/i);
    expect(urls).toHaveLength(10); // capped
  });

  it('an error in the middle of the scan is unknown, never absent', async () => {
    const full = Array.from({ length: 100 }, (_, i) => item(i));
    stubPages([() => page(full), () => Promise.reject(new Error('network down'))]);
    await expect(find()).rejects.toThrow();
    stubPages([() => page(full), () => new Response('{}', { status: 503 })]);
    await expect(find()).rejects.toThrow();
  });
});
