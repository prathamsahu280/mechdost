/**
 * Seller price requests in the demo (plan 2026-11-13 Task 8, design § Prices): every price is a request the admin
 * approves or rejects, mirroring `priceRequestMachine` and the DB repository. The live price stays until a change
 * is decided; a rejected change on a live product takes it off sale for that shop.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  decidePriceRequest,
  listingOf,
  pendingPriceRequests,
  submitPriceRequest,
  withdrawPriceRequest,
} from '../src/demo/price-requests';

function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}

const line = { shopSlug: 'sahu-auto', productSlug: 'castrol-activ-4t', mrpPaise: 46_000 };

beforeEach(() => {
  fakeWindow();
});

describe('demo price requests', () => {
  it('refuses a price above the MRP or not above zero', () => {
    expect(submitPriceRequest({ ...line, pricePaise: 46_001 })).toEqual({ error: 'PRICE_ABOVE_MRP' });
    expect(submitPriceRequest({ ...line, pricePaise: 0 })).toEqual({ error: 'PRICE_INVALID' });
    expect(submitPriceRequest({ ...line, pricePaise: 12.5 })).toEqual({ error: 'PRICE_INVALID' });
    expect(pendingPriceRequests()).toHaveLength(0);
  });

  it('an approved request puts the product on sale at that price', () => {
    const r = submitPriceRequest({ ...line, pricePaise: 44_000 });
    if ('error' in r) throw new Error(r.error);
    expect(listingOf(line.shopSlug, line.productSlug)).toEqual({ status: 'pending', pending: 44_000 });
    expect(decidePriceRequest(r.id, { decision: 'approved' })).toBe(true);
    expect(listingOf(line.shopSlug, line.productSlug)).toEqual({ status: 'on_sale', livePaise: 44_000 });
  });

  it('a later change waits and the old price stays live until it is decided', () => {
    const first = submitPriceRequest({ ...line, pricePaise: 44_000 });
    if ('error' in first) throw new Error(first.error);
    decidePriceRequest(first.id, { decision: 'approved' });
    submitPriceRequest({ ...line, pricePaise: 45_000 });
    expect(listingOf(line.shopSlug, line.productSlug)).toEqual({
      status: 'on_sale',
      livePaise: 44_000,
      pending: 45_000,
    });
  });

  it('a newer request supersedes the pending one (one pending per shop and product)', () => {
    const a = submitPriceRequest({ ...line, pricePaise: 44_000 });
    const b = submitPriceRequest({ ...line, pricePaise: 43_000 });
    if ('error' in a || 'error' in b) throw new Error('unexpected');
    expect(pendingPriceRequests().map((p) => p.id)).toEqual([b.id]);
    expect(decidePriceRequest(a.id, { decision: 'approved' })).toBe(false);
  });

  it('rejecting a change to a live product takes it off sale with the reason', () => {
    const a = submitPriceRequest({ ...line, pricePaise: 44_000 });
    if ('error' in a) throw new Error(a.error);
    decidePriceRequest(a.id, { decision: 'approved' });
    const b = submitPriceRequest({ ...line, pricePaise: 45_500 });
    if ('error' in b) throw new Error(b.error);
    decidePriceRequest(b.id, { decision: 'rejected', reason: 'above_market' });
    expect(listingOf(line.shopSlug, line.productSlug)).toEqual({ status: 'blocked', reason: 'above_market' });
  });

  it('rejecting a first price leaves the product not on sale, with the reason', () => {
    const a = submitPriceRequest({ ...line, pricePaise: 45_900 });
    if ('error' in a) throw new Error(a.error);
    decidePriceRequest(a.id, { decision: 'rejected', reason: 'above_market' });
    expect(listingOf(line.shopSlug, line.productSlug)).toEqual({
      status: 'rejected',
      reason: 'above_market',
    });
  });

  it('the shop can withdraw a pending request; decided ones cannot change', () => {
    const a = submitPriceRequest({ ...line, pricePaise: 44_000 });
    if ('error' in a) throw new Error(a.error);
    expect(withdrawPriceRequest(a.id)).toBe(true);
    expect(listingOf(line.shopSlug, line.productSlug)).toEqual({ status: 'none' });
    expect(decidePriceRequest(a.id, { decision: 'approved' })).toBe(false);
    expect(withdrawPriceRequest(a.id)).toBe(false);
  });
});
