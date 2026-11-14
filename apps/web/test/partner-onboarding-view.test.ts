import { describe, expect, it } from 'vitest';
import {
  applyErrorView,
  maskedPhone,
  newestRequestBySku,
  parseCoverage,
  priceRowState,
  shopIdFromRoles,
  type PriceRequestLite,
} from '../src/lib/partner-onboarding-view';

describe('applyErrorView (seller form on the API)', () => {
  it('APPLICATION_INVALID with fields → errors next to those fields, no form message', () => {
    expect(applyErrorView('APPLICATION_INVALID', ['gstNumber', 'pincode'])).toEqual({
      fields: { gstNumber: null, pincode: null },
      form: null,
    });
  });

  it('APPLICATION_INVALID without fields falls back to a form message, never a blank', () => {
    expect(applyErrorView('APPLICATION_INVALID')).toEqual({ fields: {}, form: 'api_errGeneric' });
  });

  it('PIN, product and invite-city refusals land on their field with a specific message', () => {
    expect(applyErrorView('PINCODE_NOT_SERVED').fields).toEqual({ pincode: 'api_errPincodeNotServed' });
    expect(applyErrorView('INVITE_CITY').fields).toEqual({ pincode: 'api_errInviteCity' });
    expect(applyErrorView('PRODUCTS').fields).toEqual({ productSlugs: 'api_errProductsGone' });
  });

  it('bot check, limits, outages and invite states are form-level messages', () => {
    expect(applyErrorView('TURNSTILE_FAILED').form).toBe('api_errBotCheck');
    expect(applyErrorView('RATE_LIMITED').form).toBe('api_errRate');
    expect(applyErrorView('HTTP_429').form).toBe('api_errRate');
    expect(applyErrorView('UNAVAILABLE').form).toBe('api_errUnavailable');
    expect(applyErrorView('NETWORK').form).toBe('api_errUnavailable');
    expect(applyErrorView('HTTP_503').form).toBe('api_errUnavailable');
    expect(applyErrorView('INVITE_USED').form).toBe('inviteUsed');
    expect(applyErrorView('INVITE_EXPIRED').form).toBe('inviteExpired');
    expect(applyErrorView('INVITE_REVOKED').form).toBe('inviteRevoked');
    expect(applyErrorView('NOT_FOUND').form).toBe('inviteNotFound');
    expect(applyErrorView('SOMETHING_NEW').form).toBe('api_errGeneric');
  });
});

describe('parseCoverage (approve with delivery area)', () => {
  it('splits on commas, spaces and new lines, drops duplicates, converts rupees to paise', () => {
    expect(parseCoverage('492001, 492001\n492004', '40', '2')).toEqual([
      { pincode: '492001', shippingPaise: 4000, leadDays: 2 },
      { pincode: '492004', shippingPaise: 4000, leadDays: 2 },
    ]);
  });

  it('allows ₹0 and 0 days', () => {
    expect(parseCoverage('492001', '0', '0')).toEqual([{ pincode: '492001', shippingPaise: 0, leadDays: 0 }]);
  });

  it('refuses no PIN, a bad PIN, a charge above ₹500 or more than 14 days (same limits as the API)', () => {
    expect(parseCoverage('  ', '40', '2')).toBeNull();
    expect(parseCoverage('092001', '40', '2')).toBeNull();
    expect(parseCoverage('49200', '40', '2')).toBeNull();
    expect(parseCoverage('492001', '500.01', '2')).toBeNull();
    expect(parseCoverage('492001', 'abc', '2')).toBeNull();
    expect(parseCoverage('492001', '40', '15')).toBeNull();
    expect(parseCoverage('492001', '40', '-1')).toBeNull();
  });
});

const req = (over: Partial<PriceRequestLite>): PriceRequestLite => ({
  id: 'r1',
  sku: 'SKU-1',
  status: 'pending',
  requestedPaise: 40_000,
  reasonCode: null,
  createdAt: '2026-11-14T10:00:00.000Z',
  ...over,
});

describe('Your prices on the API', () => {
  it('keeps the newest request per SKU whatever the order', () => {
    const old = req({ id: 'old', createdAt: '2026-11-13T10:00:00.000Z' });
    const neu = req({ id: 'new' });
    const other = req({ id: 'o', sku: 'SKU-2' });
    const map = newestRequestBySku([old, neu, other]);
    expect(map.get('SKU-1')?.id).toBe('new');
    expect(newestRequestBySku([neu, old]).get('SKU-1')?.id).toBe('new');
    expect(map.get('SKU-2')?.id).toBe('o');
  });

  it('on sale with a waiting request shows both', () => {
    const pending = req({});
    expect(priceRowState({ active: true, sellingPaise: 45_000 }, pending)).toEqual({
      kind: 'on_sale',
      livePaise: 45_000,
      pending,
    });
  });

  it('a refused change on a live offer shows the reason; an inactive offer is off sale', () => {
    expect(
      priceRowState(
        { active: true, sellingPaise: 45_000 },
        req({ status: 'rejected', reasonCode: 'above_market' }),
      ),
    ).toEqual({ kind: 'rejected', livePaise: 45_000, reasonCode: 'above_market' });
    expect(
      priceRowState(
        { active: false, sellingPaise: 45_000 },
        req({ status: 'rejected', reasonCode: 'other' }),
      ),
    ).toEqual({ kind: 'off_sale', reasonCode: 'other' });
    expect(priceRowState({ active: false, sellingPaise: 45_000 }, undefined)).toEqual({
      kind: 'off_sale',
      reasonCode: null,
    });
  });

  it('approved, withdrawn or superseded requests leave just the live price', () => {
    for (const status of ['approved', 'withdrawn', 'superseded'] as const)
      expect(priceRowState({ active: true, sellingPaise: 45_000 }, req({ status }))).toEqual({
        kind: 'on_sale',
        livePaise: 45_000,
        pending: null,
      });
  });

  it('finds the shop on the account and masks the invite phone', () => {
    expect(shopIdFromRoles([{ shopId: null }, { shopId: 'shop-1' }])).toBe('shop-1');
    expect(shopIdFromRoles([{ shopId: null }])).toBeNull();
    expect(maskedPhone('3210')).toBe('••••••3210');
  });
});
