/** Real-API QA pass 3 (2026-11-16), bugs 7 to 15: delivery hint, routing reasons, cancel help, live support, totals. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { freeDeliveryHints } from '../src/lib/free-delivery-hint';
import { nextShopAction, routeEmptyReason } from '../src/lib/order-views';
import { cancelHelpShown } from '../src/lib/order-status';
import { orderTotalLines } from '../src/lib/order-totals';
import { shouldSearch } from '../src/lib/quote-search';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const both = (ns: string, key: string) => {
  const e = (en as unknown as Record<string, Record<string, string>>)[ns]?.[key];
  const h = (hi as unknown as Record<string, Record<string, string>>)[ns]?.[key];
  return { e, h };
};

describe('bug 7: the checkout hint states the threshold that actually applied to each group', () => {
  const g = (seller: string, shippingPaise: number, freeDeliveryMinPaise: number | null) => ({
    seller,
    shippingPaise,
    freeDeliveryMinPaise,
  });
  it('lists only groups that are charged and could still become free', () => {
    expect(freeDeliveryHints([g('A', 4000, 150000), g('B', 0, 50000), g('C', 4000, null)])).toEqual([
      { seller: 'A', minPaise: 150000 },
    ]);
  });
  it('is empty when nothing is charged', () => {
    expect(freeDeliveryHints([g('A', 0, 99900)])).toEqual([]);
  });
  it('the checkout summary uses the per-group hint, not the city setting', () => {
    const src = read('components/commerce/checkout-form.tsx');
    expect(src).toContain('freeDeliveryHints');
    expect(src).toContain('freeDeliveryGroupHint');
  });
  it('has cart.freeDeliveryGroupHint in English and Hindi', () => {
    const { e, h } = both('cart', 'freeDeliveryGroupHint');
    expect(e).toContain('{amount}');
    expect(e).not.toContain('{seller}');
    expect(h).toContain('{amount}');
    expect(h).toMatch(/[ऀ-ॿ]/);
  });
});

describe('bug 8: the routing screen says why nobody can be offered the order', () => {
  const shop = (
    o: Partial<{ eligible: boolean; triedBefore: boolean; stockedItems: number; totalItems: number }>,
  ) => ({
    eligible: false,
    triedBefore: false,
    stockedItems: 0,
    totalItems: 1,
    ...o,
  });
  it('no shop covers the PIN', () => {
    expect(routeEmptyReason([])).toBe('none_cover');
  });
  it('every covering shop already declined or timed out', () => {
    expect(routeEmptyReason([shop({ triedBefore: true, stockedItems: 1 })])).toBe('all_tried');
  });
  it('the other shops do not stock the item', () => {
    expect(routeEmptyReason([shop({ triedBefore: true, stockedItems: 1 }), shop({})])).toBe('none_stock');
  });
  it.each(['noShopCover', 'noShopStock', 'noShopUntried'])('has portal.%s in English and Hindi', (key) => {
    const { e, h } = both('portal', key);
    expect(e).toBeTruthy();
    expect(h).toMatch(/[ऀ-ॿ]/);
  });
  it('the screen picks the message by reason', () => {
    expect(read('components/portal/admin-orders-api.tsx')).toContain('routeEmptyReason');
  });
});

describe('bug 9: a customer who cannot cancel is told why and what to do next', () => {
  it('shows the help for an open part that cannot be cancelled', () => {
    expect(cancelHelpShown({ status: 'confirmed', canCancel: false })).toBe(true);
    expect(cancelHelpShown({ status: 'out_for_delivery', canCancel: false })).toBe(true);
  });
  it('not when cancelling is allowed, or the part is closed or delivered', () => {
    expect(cancelHelpShown({ status: 'confirmed', canCancel: true })).toBe(false);
    expect(cancelHelpShown({ status: 'cancelled', canCancel: false })).toBe(false);
    expect(cancelHelpShown({ status: 'rejected', canCancel: false })).toBe(false);
    expect(cancelHelpShown({ status: 'delivered', canCancel: false })).toBe(false);
  });
  it('the order page renders it', () => {
    const src = read('components/commerce/order-view-api.tsx');
    expect(src).toContain('cancelHelpShown');
    expect(src).toContain('cancelUnavailable');
  });
  it.each(['cancelUnavailable', 'cancelUnavailableSupport'])('has order.%s in English and Hindi', (key) => {
    const { e, h } = both('order', key);
    expect(e).toBeTruthy();
    expect(h).toMatch(/[ऀ-ॿ]/);
  });
});

describe('bug 10: the support list refreshes on its own', () => {
  it('polls while visible and catches up when the tab returns', () => {
    const src = read('components/account/support-section-api.tsx');
    expect(src).toContain('setInterval');
    expect(src).toContain("visibilityState === 'visible'");
    expect(src).toContain("addEventListener('visibilitychange'");
  });
});

describe('bug 12: one click on a fulfilment button is never two submits of the same step', () => {
  it('packed to out for delivery is ONE request (the API does hand-over + out for delivery together; pass 4)', () => {
    const a = nextShopAction('packed');
    expect(a && 'steps' in a ? a.steps : null).toEqual(['out_for_delivery']);
  });
  it('the card guards the second press with a ref, not only state', () => {
    expect(read('components/portal/shop-portal-api.tsx')).toContain('busyRef');
  });
});

describe('bug 13: the bulk quote search starts while typing', () => {
  it('needs two characters', () => {
    expect(shouldSearch('a')).toBe(false);
    expect(shouldSearch(' a ')).toBe(false);
    expect(shouldSearch('oil')).toBe(true);
  });
  it('the form debounces the query in an effect', () => {
    const src = read('components/quotes/quote-request-form-api.tsx');
    expect(src).toMatch(/setTimeout\(/);
    expect(src).toContain('shouldSearch');
  });
});

describe('bug 14: a rejected order shows what was placed and what is still payable', () => {
  it('shows only the placed total when nothing was cancelled', () => {
    expect(orderTotalLines({ placedTotalPaise: 104000, totalPaise: 104000 })).toEqual({
      placedPaise: 104000,
      payablePaise: null,
    });
  });
  it('adds the payable amount when parts were rejected or cancelled', () => {
    expect(orderTotalLines({ placedTotalPaise: 104000, totalPaise: 0 })).toEqual({
      placedPaise: 104000,
      payablePaise: 0,
    });
  });
  it.each(['api_placedTotal', 'api_payableTotal'])('has order.%s in English and Hindi', (key) => {
    const { e, h } = both('order', key);
    expect(e).toContain('{amount}');
    expect(h).toContain('{amount}');
  });
});

describe('bug 15: Hindi stock-upload hint explains the column names', () => {
  const hiRules = (hi as unknown as Record<string, Record<string, string>>).shopTier2?.csvRules ?? '';
  it('keeps every column name inside <code>', () => {
    for (const col of ['sku', 'stock', 'active', 'requested_price'])
      expect(hiRules).toContain(`<code>${col}</code>`);
  });
  it('has no Latin letters outside <code> (except units)', () => {
    const outside = hiRules
      .replace(/<code>.*?<\/code>/g, '')
      .replace(/\b\d+\s*MB\b/g, '')
      .replace('{rows}', '');
    expect(outside).not.toMatch(/[A-Za-z]/);
  });
  it('explains each column in Hindi', () => {
    for (const col of ['sku', 'stock', 'active', 'requested_price'])
      expect(hiRules).toMatch(new RegExp(`<code>${col}</code>[^<]*[\\u0900-\\u097F]`));
  });
});
