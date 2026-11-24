import { describe, expect, it } from 'vitest';
import { parseCompareParam, parseCompareSizes } from '../src/lib/compare/rows';
import { viewForSize } from '../src/lib/catalogue/size-view';
import { demoProduct } from '../src/lib/catalogue/demo-source';
import { findProduct } from '../src/demo/catalogue';

describe('compare link with sizes (user 2026-11-24)', () => {
  it('slug:SKU names the size; the slug list is unchanged', () => {
    expect(parseCompareParam('milaze:T-14,oil')).toEqual(['milaze', 'oil']);
    expect(parseCompareSizes('milaze:T-14,oil')).toEqual({ milaze: 'T-14' });
  });
  it('a bad size part is ignored, not an error', () => {
    expect(parseCompareSizes('milaze:bad sku!,oil:')).toEqual({});
    expect(parseCompareParam('milaze:bad sku!')).toEqual(['milaze']);
  });
});

describe('a product shown for one size', () => {
  const tyre = () => {
    const p = findProduct('car-tyre-185-65-r15');
    if (!p) throw new Error('demo tyre missing');
    return demoProduct(p, 'en');
  };

  it('takes the price, sku and availability of the chosen size and names the size', () => {
    const view = viewForSize(tyre(), 'TYR-PC-1756514');
    expect(view.sku).toBe('TYR-PC-1756514');
    expect(view.price?.pricePaise).toBe(365_000);
    expect(view.sizeLabel).toBe('175/65 R14 82T TL');
  });

  it('an unknown size falls back to the default size, still named', () => {
    const view = viewForSize(tyre(), 'NOPE');
    expect(view.sku).toBe('TYR-PC-1856515');
    expect(view.sizeLabel).toBe('185/65 R15 88H TL');
  });

  it('a size nobody can buy shows no price and is on request', () => {
    const view = viewForSize(tyre(), 'TYR-PC-1955516');
    expect(view.price).toBeNull();
    expect(view.availability).toBe('on_request');
  });

  it('a single-size product is left as it is, with no size name', () => {
    const oil = findProduct('castrol-activ-4t-20w40-900ml');
    if (!oil) throw new Error('demo oil missing');
    const view = demoProduct(oil, 'en');
    expect(viewForSize(view, 'ANY').sizeLabel).toBeNull();
    expect(viewForSize(view, 'ANY').price).toEqual(view.price);
  });
});
