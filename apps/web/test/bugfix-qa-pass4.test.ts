/** Real-API QA pass 4 (2026-11-16): the new bugs, one describe per bug (numbers as in docs/qa/real-api-pass-4). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { approvedTotalKey } from '../src/lib/estimate-summary';
import { billStepDetailKey } from '../src/lib/bill-paid';
import { orderListTotalPaise } from '../src/lib/order-totals';
import { requestedPartCode } from '../src/lib/order-parts';
import { payNoteShown } from '../src/lib/pay-note';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const both = (ns: string, key: string) => {
  const e = (en as unknown as Record<string, Record<string, string>>)[ns]?.[key];
  const h = (hi as unknown as Record<string, Record<string, string>>)[ns]?.[key];
  return { e, h };
};
const deva = /[ऀ-ॿ]/;

describe('bug 1: "Sell another product" is offered for every shop of the owner', () => {
  const src = read('components/portal/shop-profile-api.tsx');
  it('does not pick the first shop only', () => {
    expect(src).not.toContain('load.shops[0]');
    expect(src).toContain('load.shops.map');
  });
  it('names the shop when there are several', () => {
    const { e, h } = both('portal', 'shops_api_newForShop');
    expect(e).toContain('{shop}');
    expect(h).toContain('{shop}');
    expect(h).toMatch(deva);
  });
});

describe('bug 2: the cart makes no promise about free delivery that checkout can break', () => {
  it('the hint carries no amount, in English and Hindi', () => {
    const { e, h } = both('cart', 'freeDeliveryHint');
    expect(e).not.toContain('{amount}');
    expect(h).not.toContain('{amount}');
    expect(e).not.toMatch(/₹|\d/);
    expect(h).toMatch(deva);
  });
  it('the cart does not print the city setting', () => {
    expect(read('components/commerce/cart-view.tsx')).not.toMatch(/freeDeliveryHint',\s*\{/);
  });
  it('the checkout fallback does not print the city setting either', () => {
    expect(read('components/commerce/checkout-form.tsx')).not.toMatch(/'freeDeliveryHint',\s*\{/);
  });
});

describe('bug 3: "Mark out for delivery" is one request', () => {
  it('the API route accepts the hand-over flag on out_for_delivery', () => {
    expect(readFileSync(join(__dirname, '../../api/src/routes/shop-orders.ts'), 'utf8')).toContain(
      'handOverOwn',
    );
  });
});

describe('bug 4: one payment state at a time on the quote page', () => {
  it('once the server says paid, no warning stays next to "Payment received"', () => {
    for (const note of ['not_confirmed', 'failed', 'cancelled', 'expired', 'unavailable'] as const)
      expect(payNoteShown(note, true)).toBe('paid');
    expect(payNoteShown('paid', true)).toBe('paid');
  });
  it('before it is paid the note is unchanged; nothing to say without a note', () => {
    expect(payNoteShown('not_confirmed', false)).toBe('not_confirmed');
    expect(payNoteShown(null, false)).toBeNull();
    expect(payNoteShown(null, true)).toBeNull();
  });
  it('the page re-reads quickly while the confirmation is missing', () => {
    expect(read('components/quotes/quote-thread-api.tsx')).toContain("payNote === 'not_confirmed'");
  });
});

describe('bug 5: the orders list shows what was placed, also for rejected orders', () => {
  it('uses the placed total', () => {
    expect(orderListTotalPaise({ placedTotalPaise: 104000, totalPaise: 0 })).toBe(104000);
    expect(orderListTotalPaise({ placedTotalPaise: 22000, totalPaise: 22000 })).toBe(22000);
  });
  it('the row hook uses it', () => {
    expect(read('lib/use-order-rows.ts')).toContain('orderListTotalPaise');
  });
});

describe('bug 6: the estimate total says GST only when GST is charged', () => {
  it('chooses the key from the lines', () => {
    expect(approvedTotalKey(true)).toBe('approvedTotal');
    expect(approvedTotalKey(false)).toBe('approvedTotalNoGst');
  });
  it('has the plain wording in English and Hindi without GST', () => {
    const { e, h } = both('request', 'approvedTotalNoGst');
    expect(e).not.toMatch(/GST/);
    expect(h).not.toMatch(/GST/);
    expect(e).toContain('{total}');
    expect(h).toMatch(deva);
  });
  it('the API estimate form no longer assumes a registered workshop', () => {
    expect(read('components/workshops/service-estimate-api.tsx')).toContain('approvedTotalKey');
  });
});

describe('bug 8: the admin overview refreshes its counts', () => {
  it('polls while the tab is visible', () => {
    expect(read('components/portal/admin-overview-api.tsx')).toContain('startPolling');
  });
});

describe('bug 9: the Bill step follows how the bill was paid', () => {
  it('unpaid: online or at the workshop; paid: says how', () => {
    expect(billStepDetailKey(null)).toBe('stepDetail_billed');
    expect(billStepDetailKey({ paidAt: null, method: null })).toBe('stepDetail_billedPay');
    expect(billStepDetailKey({ paidAt: '2026-11-16T10:00:00Z', method: 'online' })).toBe(
      'stepDetail_billedPaidOnline',
    );
    expect(billStepDetailKey({ paidAt: '2026-11-16T10:00:00Z', method: 'cash' })).toBe(
      'stepDetail_billedPaid',
    );
  });
  it('has the three wordings in both languages', () => {
    for (const k of ['stepDetail_billedPay', 'stepDetail_billedPaidOnline', 'stepDetail_billedPaid']) {
      const { e, h } = both('request', k);
      expect(e, k).toBeTruthy();
      expect(h, k).toMatch(deva);
    }
    expect(both('request', 'stepDetail_billedPaidOnline').e).not.toMatch(/at the workshop/i);
  });
});

describe('bug 10: the requested part of a split order is the one highlighted', () => {
  const parts = ['MD-RPR-2026-ABC234-1', 'MD-RPR-2026-ABC234-2'];
  it('finds the part named by the link', () => {
    expect(requestedPartCode('MD-RPR-2026-ABC234-2', parts)).toBe('MD-RPR-2026-ABC234-2');
    expect(requestedPartCode('MD-RPR-2026-ABC234-1', parts)).toBe('MD-RPR-2026-ABC234-1');
  });
  it('is null for the group code or an unknown part', () => {
    expect(requestedPartCode('MD-RPR-2026-ABC234', parts)).toBeNull();
    expect(requestedPartCode('MD-RPR-2026-ABC234-3', parts)).toBeNull();
    expect(requestedPartCode('MD-RPR-2026-ABC234-1', ['MD-RPR-2026-ABC234-1'])).toBeNull();
  });
});
