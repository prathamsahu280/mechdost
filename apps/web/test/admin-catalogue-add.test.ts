import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { IMPORT_ERROR_CODES } from '@mechdost/shared/catalogue-import';
import {
  addErrorKey,
  attributesFor,
  fileTooBig,
  IMPORT_FILE_REASONS,
  IMPORT_TEMPLATE,
  readNewProduct,
  rowProblemKey,
} from '../src/lib/admin-catalogue-add';

/** Admin → Catalogue → Add product / Import CSV (plan 2026-11-14 Stream B): what the form sends. */
const form = (values: Record<string, string>) => (name: string) => values[name] ?? '';
const batteries = { slug: 'batteries', parentSlug: null, name: 'Batteries' };
const filled = {
  brand: 'Exide',
  name: 'XLTZ4A 2W battery',
  nameHi: 'XLTZ4A दोपहिया बैटरी',
  sku: 'exi-xltz4a',
  mrp: '₹1,450.50',
  hsn: '8507',
  gst: '1800',
  packQty: '1',
  packUnit: 'piece',
  highlights: 'Sealed\n\nMaintenance free ',
  attr_voltage: '12',
  attr_batteryType: 'vrla',
};

describe('add product form', () => {
  it('builds the API body: paise, basis points, lists, typed attributes, empty texts left out', () => {
    const r = readNewProduct(form(filled), {
      category: batteries,
      vehicleTypes: ['4W', '2W'],
      publish: false,
    });
    expect(r).toEqual({
      ok: true,
      body: {
        categorySlug: 'batteries',
        brand: 'Exide',
        name: 'XLTZ4A 2W battery',
        nameHi: 'XLTZ4A दोपहिया बैटरी',
        sku: 'exi-xltz4a',
        mrpPaise: 145_050,
        hsn: '8507',
        gstRateBp: 1800,
        vehicleTypes: ['2W', '4W'],
        attributes: { voltage: 12, batteryType: 'vrla' },
        highlights: ['Sealed', 'Maintenance free'],
        highlightsHi: [],
        netQuantity: { qty: 1, unit: 'piece' },
      },
    });
  });

  it('asks for the required fields, a rupee MRP, a whole pack size and numeric specs', () => {
    const opts = { category: batteries, vehicleTypes: [], publish: true };
    expect(readNewProduct(form({ ...filled, brand: '' }), opts)).toEqual({
      ok: false,
      key: 'cat_add_err_REQUIRED',
    });
    expect(readNewProduct(form(filled), { ...opts, category: null })).toMatchObject({ ok: false });
    expect(readNewProduct(form({ ...filled, mrp: '14,50.505' }), opts)).toEqual({
      ok: false,
      key: 'cat_add_err_mrp',
    });
    expect(readNewProduct(form({ ...filled, packQty: '1.5' }), opts)).toEqual({
      ok: false,
      key: 'cat_add_err_NET_QUANTITY',
    });
    expect(readNewProduct(form({ ...filled, attr_voltage: 'twelve' }), opts)).toEqual({
      ok: false,
      key: 'cat_add_err_ATTRIBUTE_VALUE',
    });
    expect(readNewProduct(form(filled), opts)).toMatchObject({ ok: true, body: { publish: true } });
  });

  it('uses the parent category attributes for a sub-category', () => {
    expect(
      attributesFor({ slug: 'scooter-batteries', parentSlug: 'batteries', name: 'x' }).map((d) => d.key),
    ).toContain('voltage');
    expect(attributesFor({ slug: 'filters', parentSlug: null, name: 'x' })).toEqual([]);
  });
});

describe('messages', () => {
  const portal = (m: unknown) => (m as { portal: Record<string, string> }).portal;
  it('every API row code, form code and file reason has words in English and Hindi', () => {
    const keys = [
      ...IMPORT_ERROR_CODES.map(rowProblemKey),
      addErrorKey('SKU_TAKEN'),
      addErrorKey('VALIDATION'),
      'cat_add_err_mrp',
      ...IMPORT_FILE_REASONS.map((r) => `cat_import_file_${r}`),
    ];
    for (const k of keys) {
      expect(portal(en)[k], k).toBeTruthy();
      expect(portal(hi)[k], k).toBeTruthy();
    }
    expect(addErrorKey('FORBIDDEN')).toBe('cat_err_FORBIDDEN');
    expect(addErrorKey('SOMETHING_NEW')).toBe('cat_err_generic');
  });

  it('offers a header-only template and refuses files too large for one request', () => {
    expect(IMPORT_TEMPLATE.startsWith('category,brand,name,')).toBe(true);
    expect(IMPORT_TEMPLATE.trim().split('\n')).toHaveLength(1);
    expect(fileTooBig('x'.repeat(300_001))).toBe(true);
    expect(fileTooBig('x')).toBe(false);
  });
});
