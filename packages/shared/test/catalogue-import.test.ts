import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_SLUG_RE } from '../src/catalogue';
import {
  coerceAttributes,
  csvField,
  csvImportRows,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  parseCsv,
  percentToBp,
  PRODUCT_SLUG_RE,
  productSlug,
  slugify,
} from '../src/catalogue-import';

const HEADER = 'category,brand,name,sku,mrp_rupees,hsn,gst_rate_percent';

describe('parseCsv (RFC 4180)', () => {
  it('reads quoted commas, doubled quotes, line breaks inside quotes, CRLF and a BOM', () => {
    const r = parseCsv('\uFEFFa,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,,3\n');
    expect(r).toEqual({
      ok: true,
      records: [
        ['a', 'b', 'c'],
        ['x, y', 'say "hi"', 'line1\nline2'],
        ['1', '', '3'],
      ],
    });
  });

  it('refuses an unterminated quote and text after a closing quote', () => {
    expect(parseCsv('a,"b\n1,2')).toEqual({ ok: false, code: 'MALFORMED' });
    expect(parseCsv('a,"b"c\n')).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('round-trips fields written with csvField', () => {
    const values = ['plain', 'with, comma', 'with "quote"', 'two\nlines'];
    const r = parseCsv(values.map(csvField).join(','));
    expect(r).toEqual({ ok: true, records: [values] });
  });
});

describe('slugs, per cent and attributes', () => {
  it('derives a product slug from brand and name without repeating the brand', () => {
    expect(productSlug('Exide', 'XLTZ4A 2W Battery')).toBe('exide-xltz4a-2w-battery');
    expect(productSlug('Castrol', 'Castrol Activ 4T 20W-40 (900 ml)')).toBe('castrol-activ-4t-20w-40-900-ml');
    expect(slugify('  बैटरी  ')).toBe('');
    expect(PRODUCT_SLUG_RE.source).toBe(CATALOGUE_SLUG_RE.source);
  });

  it('turns per cent into basis points exactly', () => {
    expect(percentToBp('18')).toBe(1800);
    expect(percentToBp('2.5')).toBe(250);
    expect(percentToBp('28%')).toBe(2800);
    expect(percentToBp('eighteen')).toBeNull();
    expect(percentToBp('100')).toBeNull();
  });

  it('types spreadsheet text by the category definitions', () => {
    expect(
      coerceAttributes('batteries', { voltage: '12', capacityAh: '2.5', batteryType: 'vrla', x: '1' }),
    ).toEqual({ voltage: 12, capacityAh: 2.5, batteryType: 'vrla', x: '1' });
    expect(coerceAttributes('tyres', { tubeless: 'yes', size: '90/90-17' })).toEqual({
      tubeless: true,
      size: '90/90-17',
    });
  });
});

describe('csvImportRows', () => {
  it('maps every documented column into the body shape', () => {
    const csv = [
      IMPORT_COLUMNS.join(','),
      [
        'Batteries',
        'Exide',
        'XLTZ4A 2W battery',
        'XLTZ4A दोपहिया बैटरी',
        '',
        '12 V · 3 Ah',
        '12 V · 3 Ah',
        'Most 2W',
        'अधिकतर दोपहिया',
        '',
        '',
        'Sealed | Maintenance free',
        'सील्ड|मेंटेनेंस फ्री',
        '2w',
        'voltage=12|capacityAh=3|batteryType=vrla',
        'exi-xltz4a',
        '₹1,450.50',
        '8507',
        '18',
        '1',
        'piece',
      ]
        .map(csvField)
        .join(','),
    ].join('\n');
    const r = csvImportRows(csv);
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          row: 2,
          errors: [],
          input: {
            categorySlug: 'batteries',
            brand: 'Exide',
            name: 'XLTZ4A 2W battery',
            nameHi: 'XLTZ4A दोपहिया बैटरी',
            specSummary: '12 V · 3 Ah',
            specSummaryHi: '12 V · 3 Ah',
            compatibility: 'Most 2W',
            compatibilityHi: 'अधिकतर दोपहिया',
            highlights: ['Sealed', 'Maintenance free'],
            highlightsHi: ['सील्ड', 'मेंटेनेंस फ्री'],
            vehicleTypes: ['2W'],
            attributes: { voltage: '12', capacityAh: '3', batteryType: 'vrla' },
            sku: 'EXI-XLTZ4A',
            mrpPaise: 145_050,
            hsn: '8507',
            gstRateBp: 1800,
            netQuantity: { qty: 1, unit: 'piece' },
          },
        },
      ],
    });
  });

  it('reports cell errors by spreadsheet row and column', () => {
    const r = csvImportRows(
      `${HEADER},net_qty,net_unit\nlubricants,Castrol,Activ,CAS-1,abc,2710,eighteen,900,litre`,
    );
    expect(r.ok && r.rows[0]?.errors).toEqual([
      { row: 2, field: 'mrp_rupees', code: 'INVALID' },
      { row: 2, field: 'gst_rate_percent', code: 'INVALID' },
      { row: 2, field: 'net_qty', code: 'NET_QUANTITY' },
    ]);
  });

  it('refuses a header with missing, unknown or repeated columns', () => {
    expect(csvImportRows('category,brand,name,sku,price\nx,y,z,s,1')).toEqual({
      ok: false,
      code: 'HEADER',
      missing: ['mrp_rupees', 'hsn', 'gst_rate_percent'],
      unknown: ['price'],
    });
    expect(csvImportRows(`${HEADER},sku\na,b,c,d,1,2710,18,d`)).toMatchObject({
      code: 'HEADER',
      unknown: ['sku'],
    });
  });

  it('refuses an empty file and more than the row limit', () => {
    expect(csvImportRows(HEADER)).toEqual({ ok: false, code: 'EMPTY' });
    const many = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `x,b,n,S-${String(i)},1,2710,18`);
    expect(csvImportRows([HEADER, ...many].join('\n'))).toEqual({ ok: false, code: 'TOO_MANY_ROWS' });
  });

  it('reads the sample file in the runbook without errors', () => {
    const sample = readFileSync(
      fileURLToPath(new URL('../../../docs/runbooks/catalogue-import-sample.csv', import.meta.url)),
      'utf8',
    );
    const r = csvImportRows(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.length).toBeGreaterThanOrEqual(3);
      expect(r.rows.flatMap((x) => x.errors)).toEqual([]);
    }
  });
});
