import { describe, expect, it } from 'vitest';
import { findProduct } from '../src/demo/catalogue';
import { demoCard, demoProduct } from '../src/lib/catalogue/demo-source';

const tyre = () => {
  const p = findProduct('car-tyre-185-65-r15');
  if (!p) throw new Error('demo tyre missing');
  return p;
};

describe('demo product with three sizes (user 2026-11-24)', () => {
  it('lists every size, the default size is the product own sku', () => {
    const view = demoProduct(tyre(), 'en');
    expect(view.variants.map((v) => v.label)).toEqual([
      '175/65 R14 82T TL',
      '185/65 R15 88H TL',
      '195/55 R16 87V TL',
    ]);
    expect(view.defaultSku).toBe(tyre().sku);
    expect(view.variants.map((v) => v.inStock)).toEqual([true, true, false]);
  });

  it('the card says from the lowest price with the size count', () => {
    expect(demoCard(tyre(), 'en').sizes).toEqual({ count: 3, fromPaise: 365_000 });
  });

  it('a single-size demo product has one variant and no sizes line', () => {
    const oil = findProduct('castrol-activ-4t-20w40-900ml');
    if (!oil) throw new Error('demo oil missing');
    expect(demoCard(oil, 'en').sizes).toBeNull();
    expect(demoProduct(oil, 'en').variants).toHaveLength(1);
  });
});
