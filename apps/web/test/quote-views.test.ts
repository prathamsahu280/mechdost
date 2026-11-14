import { describe, expect, it } from 'vitest';
import { QUOTE_STATES } from '@mechdost/shared/state';
import {
  lowPriceLines,
  offerDraft,
  quoteErrorKey,
  quoteStatusKey,
  quoteWaitsForCustomer,
} from '../src/lib/quote-views';

/** Real-mode bulk quotes (spec 19): API codes and states → translated copy; the staff offer builder's parsing. */
describe('quoteErrorKey', () => {
  it('maps the quote API codes to their own messages', () => {
    expect(quoteErrorKey('QUOTE_MIN_UNITS')).toBe('api_err_min');
    expect(quoteErrorKey('QUOTE_OPEN_LIMIT')).toBe('api_err_openLimit');
    expect(quoteErrorKey('QUOTE_PRODUCT_UNAVAILABLE')).toBe('api_err_product');
    expect(quoteErrorKey('PINCODE_NOT_SERVICEABLE')).toBe('api_err_pincode');
    expect(quoteErrorKey('QUOTE_OFFER_STALE')).toBe('stale');
    expect(quoteErrorKey('QUOTE_OFFER_EXPIRED')).toBe('expired');
    expect(quoteErrorKey('QUOTE_CLOSED')).toBe('api_err_closed');
    expect(quoteErrorKey('CHECKOUT_UNAVAILABLE')).toBe('api_err_stock');
    expect(quoteErrorKey('OUT_OF_STOCK')).toBe('api_err_stock');
    expect(quoteErrorKey('ORDERS_BLOCKED')).toBe('blockedOrders');
    expect(quoteErrorKey('COD_NOT_ALLOWED')).toBe('api_err_cod');
    expect(quoteErrorKey('STALE_QUOTE')).toBe('api_err_staleQuote');
    expect(quoteErrorKey('VERIFICATION_REQUIRED')).toBe('api_err_verify');
    expect(quoteErrorKey('QUOTE_MESSAGE_LIMIT')).toBe('api_err_rate');
    // Review 2026-11-14: COD ceiling, COD block, low-price confirmation.
    expect(quoteErrorKey('QUOTE_COD_CAP')).toBe('api_err_codCap');
    expect(quoteErrorKey('QUOTE_COD_BLOCKED')).toBe('api_err_codBlocked');
    expect(quoteErrorKey('QUOTE_OFFER_CONFIRM_LOW')).toBe('api_admin_confirmLowNeeded');
  });

  it('never returns a raw code', () => {
    expect(quoteErrorKey('HTTP_503')).toBe('api_err_network');
    expect(quoteErrorKey('SOMETHING_NEW')).toBe('api_err_generic');
  });
});

describe('quoteStatusKey', () => {
  it('has a label for every quote state', () => {
    const keys = QUOTE_STATES.map(quoteStatusKey);
    expect(new Set(keys).size).toBe(QUOTE_STATES.length);
    expect(quoteStatusKey('open')).toBe('status_open');
    expect(quoteStatusKey('negotiating')).toBe('api_status_negotiating');
  });
});

describe('quoteWaitsForCustomer', () => {
  it('is true only for an offered quote whose offer is still valid', () => {
    expect(quoteWaitsForCustomer({ status: 'offered', offer: { expired: false } })).toBe(true);
    expect(quoteWaitsForCustomer({ status: 'offered', offer: { expired: true } })).toBe(false);
    expect(quoteWaitsForCustomer({ status: 'negotiating', offer: null })).toBe(false);
  });
});

describe('offerDraft', () => {
  const lines = [
    { lineNo: 1, qty: 10 },
    { lineNo: 2, qty: 2 },
  ];

  it('parses rupees to paise and totals the offer', () => {
    const d = offerDraft(lines, { 1: '400', 2: '₹1,250.50' }, '30', '3');
    expect(d).toEqual({
      ok: true,
      lines: [
        { lineNo: 1, unitPaise: 40_000 },
        { lineNo: 2, unitPaise: 125_050 },
      ],
      deliveryPaise: 3_000,
      validDays: 3,
      totalPaise: 10 * 40_000 + 2 * 125_050 + 3_000,
    });
  });

  it('names every wrong field: empty or ₹0 prices, bad delivery, days outside 1–30', () => {
    const d = offerDraft(lines, { 1: '', 2: '0' }, 'abc', '31');
    expect(d.ok).toBe(false);
    if (!d.ok)
      expect(d.errors).toEqual({ 'price-1': 'empty', 'price-2': 'zero', delivery: 'format', days: 'range' });
  });

  it('allows free delivery', () => {
    expect(offerDraft(lines, { 1: '400', 2: '500' }, '0', '1').ok).toBe(true);
  });
});

describe('lowPriceLines (review I2)', () => {
  const lines = [
    { lineNo: 1, costPaise: 44_000, listUnitPaise: 44_000 },
    { lineNo: 2, costPaise: null, listUnitPaise: 62_000 },
    { lineNo: 3, costPaise: 10_000, listUnitPaise: null },
  ];
  it('names lines below the shop price and lines under a tenth of the list price', () => {
    expect(
      lowPriceLines(lines, [
        { lineNo: 1, unitPaise: 43_000 },
        { lineNo: 2, unitPaise: 6_000 },
        { lineNo: 3, unitPaise: 10_000 },
      ]),
    ).toEqual({ belowCost: [1], belowTenthOfList: [2] });
    expect(
      lowPriceLines(lines, [
        { lineNo: 1, unitPaise: 44_000 },
        { lineNo: 2, unitPaise: 6_200 },
        { lineNo: 3, unitPaise: 12_000 },
      ]),
    ).toEqual({ belowCost: [], belowTenthOfList: [] });
  });
});
