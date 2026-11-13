import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '../src/analytics';
import {
  attributeDefs,
  isNetQuantity,
  readAttributes,
  unitPrice,
  validateAttributes,
} from '../src/product-attributes';

describe('unitPrice (design 2026-11-13: integer paise, half up, same pack as the price)', () => {
  it('works out ₹ per litre for millilitre packs', () => {
    expect(unitPrice(44_000, { qty: 900, unit: 'ml' })).toEqual({ paise: 48_889, per: 'litre' });
    expect(unitPrice(52_000, { qty: 1000, unit: 'ml' })).toEqual({ paise: 52_000, per: 'litre' });
    expect(unitPrice(33_000, { qty: 900, unit: 'ml' })).toEqual({ paise: 36_667, per: 'litre' });
  });

  it('rounds half up and works per kg for grams', () => {
    expect(unitPrice(1, { qty: 2, unit: 'g' })).toEqual({ paise: 500, per: 'kg' });
  });

  it('gives per piece only for multi-piece packs, always per metre for lengths', () => {
    expect(unitPrice(100_000, { qty: 1, unit: 'piece' })).toBeNull();
    expect(unitPrice(50_000, { qty: 5, unit: 'piece' })).toEqual({ paise: 10_000, per: 'piece' });
    expect(unitPrice(50_000, { qty: 5, unit: 'm' })).toEqual({ paise: 10_000, per: 'metre' });
  });

  it('has no unit price without a pack', () => {
    expect(unitPrice(44_000, null)).toBeNull();
  });

  it('accepts only whole positive quantities in a known unit', () => {
    expect(isNetQuantity({ qty: 900, unit: 'ml' })).toBe(true);
    expect(isNetQuantity({ qty: 0, unit: 'ml' })).toBe(false);
    expect(isNetQuantity({ qty: 1.5, unit: 'ml' })).toBe(false);
    expect(isNetQuantity({ qty: 1, unit: 'l' })).toBe(false);
    expect(isNetQuantity(null)).toBe(false);
  });
});

describe('validateAttributes (strict, per category)', () => {
  it('accepts a full engine oil', () => {
    const r = validateAttributes('lubricants', {
      saeGrade: '20W40',
      apiClass: 'SL',
      jasoClass: 'MA2',
      baseType: 'mineral',
    });
    expect(r).toEqual({
      ok: true,
      values: { saeGrade: '20W40', apiClass: 'SL', jasoClass: 'MA2', baseType: 'mineral' },
    });
  });

  it('refuses unknown keys and bad values', () => {
    expect(validateAttributes('lubricants', { viscosity: 'x' })).toEqual({
      ok: false,
      key: 'viscosity',
      code: 'UNKNOWN_KEY',
    });
    expect(validateAttributes('lubricants', { saeGrade: '99W99' })).toEqual({
      ok: false,
      key: 'saeGrade',
      code: 'BAD_VALUE',
    });
    expect(validateAttributes('batteries', { capacityAh: 2.55 })).toMatchObject({
      ok: false,
      code: 'BAD_VALUE',
    });
    expect(validateAttributes('batteries', { capacityAh: 3, voltage: 12 })).toMatchObject({ ok: true });
    expect(validateAttributes('batteries', { voltage: 12.5 })).toMatchObject({
      ok: false,
      code: 'BAD_VALUE',
    });
    expect(validateAttributes('tyres', { tubeless: 'yes' })).toMatchObject({ ok: false, code: 'BAD_VALUE' });
    expect(validateAttributes('tyres', { size: '185/65 R15', tubeless: true })).toMatchObject({ ok: true });
  });

  it('allows only an empty object for a category without definitions', () => {
    expect(validateAttributes('bearings', { a: 1 })).toMatchObject({ ok: false, code: 'UNKNOWN_KEY' });
    expect(validateAttributes('bearings', {})).toEqual({ ok: true, values: {} });
    expect(attributeDefs('bearings')).toEqual([]);
  });
});

describe('readAttributes (tolerant, for display)', () => {
  it('keeps only valid known values', () => {
    expect(readAttributes('lubricants', { saeGrade: '20W40', apiClass: 'XX', junk: 1 })).toEqual({
      saeGrade: '20W40',
    });
  });

  it('reads anything that is not an object as empty', () => {
    expect(readAttributes('tyres', null)).toEqual({});
    expect(readAttributes('tyres', [1])).toEqual({});
    expect(readAttributes('tyres', 'x')).toEqual({});
  });
});

describe('compare analytics events', () => {
  it('add_to_cart takes an optional source', () => {
    const e = CLIENT_EVENT_SCHEMAS.add_to_cart;
    expect(e.safeParse({ slug: 'castrol-activ', qty: 1 }).success).toBe(true);
    expect(e.safeParse({ slug: 'castrol-activ', qty: 1, source: 'compare' }).success).toBe(true);
    expect(e.safeParse({ slug: 'castrol-activ', qty: 1, source: 'other' }).success).toBe(false);
  });

  it('compare events carry slugs, category and counts only', () => {
    expect(
      CLIENT_EVENT_SCHEMAS.compare_added.safeParse({ slug: 'a', category: 'lubricants', count: 2 }).success,
    ).toBe(true);
    expect(
      CLIENT_EVENT_SCHEMAS.compare_added.safeParse({ slug: 'a', category: 'lubricants', count: 5 }).success,
    ).toBe(false);
    expect(CLIENT_EVENT_SCHEMAS.compare_removed.safeParse({ slug: 'a', count: 0 }).success).toBe(true);
    expect(CLIENT_EVENT_SCHEMAS.compare_opened.safeParse({ count: 3, category: 'lubricants' }).success).toBe(
      true,
    );
    expect(CLIENT_EVENT_SCHEMAS.compare_differences_toggled.safeParse({ on: true }).success).toBe(true);
  });
});
