import { describe, expect, it } from 'vitest';
import { sizeOptions, type SizeText } from '../src/lib/catalogue/size-options';
import type { VariantView } from '../src/lib/catalogue/view';

const text: SizeText = {
  price: (p) => `Rs ${String(p / 100)}`,
  mrp: (p) => `MRP ${p}`,
  mrpOnly: (p) => `MRP only ${p}`,
  save: (n) => `Save ${String(n)}%`,
  unit: (per, p) => `${p} per ${per}`,
  inStock: 'In stock',
  onRequest: 'Price on request',
  outOfStock: 'Out of stock',
  delivery: (d) => `Delivery in ${String(d)} days`,
  askHref: (label) => `wa:${label}`,
};

const base: VariantView = {
  sku: 'T-1',
  label: '145/70 R12 69T TL',
  pricePaise: 280_000,
  mrpPaise: 300_000,
  priceOnRequest: false,
  inStock: true,
  leadDays: 2,
  shippingPaise: 0,
  pack: null,
};

describe('size options for the picker', () => {
  it('a size with an offer shows price, MRP, saving and delivery', () => {
    const [o] = sizeOptions([base], text);
    expect(o).toMatchObject({
      sku: 'T-1',
      label: '145/70 R12 69T TL',
      inStock: true,
      priceText: 'Rs 2800',
      mrpText: 'MRP 300000',
      saveText: 'Save 7%',
      availabilityText: 'In stock',
      deliveryText: 'Delivery in 2 days',
      askHref: 'wa:145/70 R12 69T TL',
    });
  });

  it('a size with an MRP but no offer shows MRP only, no price, marked out of stock', () => {
    const [o] = sizeOptions([{ ...base, pricePaise: null, inStock: false, leadDays: null }], text);
    expect(o).toMatchObject({
      priceText: null,
      mrpOnlyText: 'MRP only 300000',
      inStock: false,
      availabilityText: 'Out of stock',
      deliveryText: null,
    });
  });

  it('a size with no MRP is price on request: no price and no MRP anywhere', () => {
    const [o] = sizeOptions(
      [{ ...base, pricePaise: null, mrpPaise: null, priceOnRequest: true, inStock: false }],
      text,
    );
    expect(o).toMatchObject({
      priceText: null,
      mrpText: null,
      mrpOnlyText: null,
      priceOnRequest: true,
      availabilityText: 'Price on request',
    });
  });

  it('keeps the order of the sizes', () => {
    const list = sizeOptions([base, { ...base, sku: 'T-2' }, { ...base, sku: 'T-3' }], text);
    expect(list.map((o) => o.sku)).toEqual(['T-1', 'T-2', 'T-3']);
  });
});
