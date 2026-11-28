import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STOCK_MAX, stockStepError, stockStepTarget } from '@/lib/shop-stock';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (l: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/shared/src/i18n/${l}.json`, import.meta.url), 'utf8'),
  ) as Record<string, Record<string, string>>;

describe('shop stock − / + (P2, design § 5.3)', () => {
  it('steps by one from the value the server last sent', () => {
    expect(stockStepTarget(5, 0, 1)).toBe(6);
    expect(stockStepTarget(5, 0, -1)).toBe(4);
  });
  it('never goes below the units held for open orders, nor above the API limit', () => {
    expect(stockStepTarget(3, 3, -1)).toBeNull();
    expect(stockStepTarget(4, 3, -1)).toBe(3);
    expect(stockStepTarget(0, 0, -1)).toBeNull();
    expect(stockStepTarget(STOCK_MAX, 0, 1)).toBeNull();
  });
  it('maps API codes to a plain message and says when to reload the row', () => {
    expect(stockStepError('STALE_OFFER')).toEqual({ key: 'stock_err_stale', reload: true });
    expect(stockStepError('STOCK_BELOW_RESERVED')).toEqual({ key: 'stock_err_reserved', reload: true });
    expect(stockStepError('NETWORK')).toEqual({ key: 'stock_err_generic', reload: false });
  });
  it('writes only through the versioned inventory PATCH, never optimistically', () => {
    const c = src('components/portal/shop-stock-stepper.tsx');
    expect(c).toMatch(/\/shops\/\$\{shopId\}\/inventory\/\$\{sku\}/);
    expect(c).toMatch(/method: 'PATCH'/);
    expect(c).toMatch(/version/);
    expect(c).toMatch(/aria-busy/);
    expect(c).toMatch(/partner_stock_stepped/);
    expect(c).toMatch(/min-h-11|min-h-12/);
  });
  it('has English and Hindi strings with the product name in the button labels', () => {
    const en = json('en').partnerShop ?? {};
    const hi = json('hi').partnerShop ?? {};
    for (const k of [
      'stock_minus',
      'stock_plus',
      'stock_err_stale',
      'stock_err_reserved',
      'stock_err_generic',
    ]) {
      expect(en[k], k).toBeTruthy();
      expect(hi[k], k).toBeTruthy();
    }
    expect(en.stock_minus).toContain('{product}');
    expect(hi.stock_plus).toContain('{product}');
  });
});
