import { describe, expect, it } from 'vitest';
import { errorKey } from '../src/lib/admin-prices-view';
import { labelKeyOf } from '../src/components/portal/admin-catalogue-sizes';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';

describe('admin sizes editor', () => {
  it('types the label into the option key the size already uses', () => {
    expect(labelKeyOf({ size: '145/70 R12' })).toBe('size');
    expect(labelKeyOf({ label: '1 L', spec: {} })).toBe('label');
    expect(labelKeyOf({ model: 'NS40ZL' })).toBe('model');
    expect(labelKeyOf({})).toBe('size');
  });

  it('every size error code has words in English and Hindi; a stale size reads like a stale product', () => {
    for (const code of [
      'SKU_TAKEN',
      'SKU_INVALID',
      'MRP_BELOW_PRICE',
      'LAST_VARIANT',
      'VARIANT_LABEL',
      'VARIANT_OPTION',
      'BARCODE',
    ]) {
      const key = errorKey(code);
      expect(key).toBe(`cat_err_${code}`);
      expect((en.portal as Record<string, string>)[key]).toBeTruthy();
      expect((hi.portal as Record<string, string>)[key]).toBeTruthy();
    }
    expect(errorKey('STALE_VARIANT')).toBe('cat_err_STALE');
  });
});
