import { describe, expect, it } from 'vitest';
import {
  cityFloorPaise,
  errorKey,
  pinView,
  readPriceInput,
  type BoardPin,
  type BoardVariant,
} from '../src/lib/admin-prices-view';

/** Admin → Catalogue → Prices (plan 2026-11-13 Task 5, Q26): what each PIN row shows and what a typed price means. */
const pin = (over: Partial<BoardPin> = {}): BoardPin => ({
  pincode: '492001',
  override: null,
  nearestShopPaise: 44_000,
  lowestShopPaise: 43_000,
  highestShopPaise: 46_000,
  ...over,
});
const variant = (pins: BoardPin[], city: BoardVariant['city'] = null): BoardVariant => ({
  sku: 'CAS-ACT4T-0900',
  mrpPaise: 47_500,
  city,
  pins,
});

describe('price board view', () => {
  it('a PIN follows its override, else the city price, else the nearest shop (interim, Q83)', () => {
    expect(pinView(pin(), null)).toMatchObject({ customerPaise: 44_000, source: 'shop' });
    expect(pinView(pin(), { pricePaise: 45_000, version: 1 })).toMatchObject({
      customerPaise: 45_000,
      source: 'city',
    });
    expect(
      pinView(pin({ override: { pricePaise: 43_500, version: 2 } }), { pricePaise: 45_000, version: 1 }),
    ).toMatchObject({ customerPaise: 43_500, source: 'pin' });
  });

  it('shows the best-case margin over the lowest shop price, and the three suggestions without repeats', () => {
    const v = pinView(pin({ highestShopPaise: 44_000 }), { pricePaise: 45_000, version: 1 });
    expect(v.marginPaise).toBe(2_000);
    expect(v.suggestions).toEqual([
      { kind: 'nearest', paise: 44_000 },
      { kind: 'lowest', paise: 43_000 },
    ]);
    expect(
      pinView(pin({ nearestShopPaise: null, lowestShopPaise: null, highestShopPaise: null }), null),
    ).toMatchObject({ customerPaise: null, source: 'none', marginPaise: null, suggestions: [] });
  });

  it('the city price floor is the lowest shop price across the PINs (the server rule)', () => {
    expect(cityFloorPaise(variant([pin(), pin({ pincode: '492004', lowestShopPaise: 42_500 })]))).toBe(
      42_500,
    );
    expect(cityFloorPaise(variant([]))).toBeNull();
  });

  it('checks a typed price with the shared rules before sending it', () => {
    const rules = { mrpPaise: 47_500, lowestShopPaise: 43_000 };
    expect(readPriceInput('₹450', rules)).toEqual({ ok: true, paise: 45_000 });
    expect(readPriceInput('', rules)).toEqual({ ok: false, issue: 'empty' });
    expect(readPriceInput('4,80', rules)).toEqual({ ok: false, issue: 'MRP_EXCEEDED' });
    expect(readPriceInput('429.99', rules)).toEqual({ ok: false, issue: 'BELOW_SHOP_PRICE' });
    expect(readPriceInput('450', { mrpPaise: 47_500, lowestShopPaise: null })).toEqual({
      ok: false,
      issue: 'NO_SHOP',
    });
  });

  it('turns API error codes into locale keys, never the API’s English message', () => {
    expect(errorKey('MRP_EXCEEDED')).toBe('cat_err_MRP_EXCEEDED');
    expect(errorKey('STALE_PRODUCT')).toBe('cat_err_STALE');
    expect(errorKey('STALE_PRICE')).toBe('cat_err_STALE');
    expect(errorKey('FORBIDDEN')).toBe('cat_err_FORBIDDEN');
    expect(errorKey('SOMETHING_NEW')).toBe('cat_err_generic');
  });
});
