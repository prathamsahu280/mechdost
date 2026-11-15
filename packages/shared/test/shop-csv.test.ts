/** Shop stock and price CSV (item 4): the parser, formula cells, the plan, and the template. */
import { describe, expect, it } from 'vitest';
import {
  parseShopCsv,
  planShopCsv,
  safeCsvCell,
  SHOP_CSV_MAX_ROWS,
  shopCsvTemplate,
  type ShopCsvCatalogEntry,
} from '../src/shop-csv';

const ok = (text: string) => {
  const p = parseShopCsv(text);
  if (!p.ok) throw new Error(p.code);
  return p;
};

describe('parseShopCsv', () => {
  it('reads rows with rupees as exact paise, yes/no words and optional cells', () => {
    const p = ok('sku,stock,active,requested_price\r\nCAS-ACT4T-0900,12,yes,"1,250.50"\nbrk-pad-01,0,No,\n');
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([
      { line: 2, sku: 'CAS-ACT4T-0900', stock: 12, active: true, requestedPaise: 125050 },
      { line: 3, sku: 'BRK-PAD-01', stock: 0, active: false, requestedPaise: null },
    ]);
  });

  it('accepts a subset of columns in any order, with a BOM and quoted fields', () => {
    const p = ok(`${String.fromCodePoint(0xfeff)}stock,SKU\n5,"AB-12"\n`);
    expect(p.rows[0]).toMatchObject({ sku: 'AB-12', stock: 5, active: null, requestedPaise: null });
  });

  it('refuses a bad header: no sku, unknown or repeated column, sku alone', () => {
    for (const h of ['stock,active', 'sku,price', 'sku,sku,stock', 'sku'])
      expect(parseShopCsv(`${h}\nAB-12,1\n`)).toEqual({ ok: false, code: 'HEADER' });
  });

  it('refuses empty, unterminated quotes and too many rows', () => {
    expect(parseShopCsv('')).toEqual({ ok: false, code: 'EMPTY' });
    expect(parseShopCsv('sku,stock\n')).toEqual({ ok: false, code: 'EMPTY' });
    expect(parseShopCsv('sku,stock\n"AB-12,1')).toEqual({ ok: false, code: 'MALFORMED' });
    const many = `sku,stock\n${Array.from({ length: SHOP_CSV_MAX_ROWS + 1 }, (_, i) => `AB-${String(i)},1`).join('\n')}`;
    expect(parseShopCsv(many)).toEqual({ ok: false, code: 'TOO_MANY_ROWS' });
    const exact = `sku,stock\n${Array.from({ length: SHOP_CSV_MAX_ROWS }, (_, i) => `AB-${String(i)},1`).join('\n')}`;
    expect(parseShopCsv(exact).ok).toBe(true);
  });

  it('reports bad cells by line and column, never the cell content', () => {
    const p = ok(
      'sku,stock,active,requested_price\nAB-12,-1,maybe,0\nAB-12,1,,\nnot a sku!,1.5,,12.345\nCD-34,100001,,\nEF-56,12,,abc\n',
    );
    expect(p.errors).toEqual([
      { line: 2, column: 'stock', code: 'FORMULA_CELL' },
      { line: 2, column: 'active', code: 'ACTIVE_INVALID' },
      { line: 2, column: 'requested_price', code: 'PRICE_INVALID' },
      { line: 3, column: 'sku', code: 'DUPLICATE_SKU' },
      { line: 4, column: 'sku', code: 'SKU_INVALID' },
      { line: 4, column: 'stock', code: 'STOCK_INVALID' },
      { line: 4, column: 'requested_price', code: 'PRICE_INVALID' },
      { line: 5, column: 'stock', code: 'STOCK_INVALID' },
      { line: 6, column: 'requested_price', code: 'PRICE_INVALID' },
    ]);
    expect(JSON.stringify(p.errors)).not.toContain('maybe');
  });

  it('treats cells starting with = + - @ as text (formula injection), in every column', () => {
    const p = ok('sku,stock,active,requested_price\n=CMD(),+5,@yes,-9\n-AB-12,1,,\n');
    expect(p.errors.map((e) => `${String(e.line)}:${e.column}:${e.code}`)).toEqual([
      '2:sku:FORMULA_CELL',
      '2:stock:FORMULA_CELL',
      '2:active:FORMULA_CELL',
      '2:requested_price:FORMULA_CELL',
      '3:sku:FORMULA_CELL',
    ]);
  });
});

const entry = (over: Partial<ShopCsvCatalogEntry> = {}): ShopCsvCatalogEntry => ({
  mrpPaise: 50_000,
  live: true,
  offer: { onHand: 10, reserved: 2, active: true, adminBlocked: false, sellingPaise: 40_000, version: 3 },
  ...over,
});

describe('planShopCsv', () => {
  const plan = (csv: string, catalog: Record<string, ShopCsvCatalogEntry>) => {
    const p = ok(csv);
    return planShopCsv(p.rows, p.errors, new Map(Object.entries(catalog)));
  };

  it('lists stock, on/off and price-request changes; rows that match are unchanged', () => {
    const r = plan('sku,stock,active,requested_price\nAB-12,7,no,450\nCD-34,10,yes,400\n', {
      'AB-12': entry(),
      'CD-34': entry(),
    });
    expect(r.errors).toEqual([]);
    expect(r.unchanged).toBe(1);
    expect(r.changes).toEqual([
      {
        line: 2,
        sku: 'AB-12',
        stock: { from: 10, to: 7 },
        active: { from: true, to: false },
        price: { requestedPaise: 45_000, currentPaise: 40_000, onHand: 7 },
        version: 3,
      },
    ]);
  });

  it('flags unknown SKUs, products the shop does not carry, price above MRP and stock below reserved', () => {
    const r = plan('sku,stock,active,requested_price\nNO-PE,1,,\nAB-12,1,,\nCD-34,,,600\nEF-56,1,,\n', {
      'AB-12': entry(),
      'CD-34': entry(),
      'EF-56': entry({ offer: null }),
    });
    expect(r.changes).toEqual([]);
    expect(r.errors).toEqual([
      { line: 2, column: 'sku', code: 'UNKNOWN_SKU' },
      { line: 3, column: 'stock', code: 'STOCK_BELOW_RESERVED' },
      { line: 4, column: 'requested_price', code: 'PRICE_ABOVE_MRP' },
      { line: 5, column: 'sku', code: 'NOT_CARRIED' },
    ]);
  });

  it('a price for a SKU not sold yet is a request to start selling, and needs a stock count', () => {
    const none = plan('sku,stock,requested_price\nEF-56,,300\n', { 'EF-56': entry({ offer: null }) });
    expect(none.errors).toEqual([{ line: 2, column: 'stock', code: 'STOCK_REQUIRED' }]);
    const some = plan('sku,stock,requested_price\nEF-56,4,300\n', { 'EF-56': entry({ offer: null }) });
    expect(some.changes[0]).toMatchObject({
      price: { requestedPaise: 30_000, currentPaise: null, onHand: 4 },
      version: null,
    });
  });

  it('refuses switching on a listing MechDost took off sale, and prices of products that are not live', () => {
    const blocked = entry({
      offer: { onHand: 10, reserved: 0, active: false, adminBlocked: true, sellingPaise: 40_000, version: 1 },
    });
    const r = plan('sku,active\nAB-12,yes\nCD-34,\n', { 'AB-12': blocked, 'CD-34': entry({ live: false }) });
    expect(r.errors).toEqual([{ line: 2, column: 'active', code: 'LISTING_BLOCKED' }]);
    const r2 = plan('sku,requested_price\nCD-34,300\n', { 'CD-34': entry({ live: false }) });
    expect(r2.errors).toEqual([{ line: 2, column: 'sku', code: 'PRODUCT_NOT_LIVE' }]);
  });
});

describe('template', () => {
  it('writes one row per offer with the price column empty, and defuses formula-looking cells', () => {
    expect(shopCsvTemplate([{ sku: 'AB-12', onHand: 4, active: false }])).toBe(
      'sku,stock,active,requested_price\r\nAB-12,4,no,\r\n',
    );
    expect(safeCsvCell('=1+1')).toBe("'=1+1");
    expect(safeCsvCell('AB-12')).toBe('AB-12');
    expect(safeCsvCell('a,b')).toBe('"a,b"');
  });
});
