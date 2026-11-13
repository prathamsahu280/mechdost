import { describe, expect, it } from 'vitest';
import { findProduct } from '../src/demo/catalogue';
import { demoProduct } from '../src/lib/catalogue/demo-source';
import type { ProductView } from '../src/lib/catalogue/view';
import { buildCompareRows, parseCompareParam, type CompareRow } from '../src/lib/compare/rows';

function oil(slug: string): ProductView {
  const p = findProduct(slug);
  if (!p) throw new Error(`fixture ${slug} missing`);
  return demoProduct(p, 'en');
}

const castrol = oil('castrol-activ-4t-20w40-900ml'); // ₹440 / 900 ml = ₹488.89 per litre
const motul = oil('motul-3100-4t-10w30-1l'); // ₹520 per litre
const hp = oil('hp-racer4-20w40-900ml'); // ₹330 / 900 ml = ₹366.67 per litre

function row(rows: ReturnType<typeof buildCompareRows>, key: string): CompareRow {
  const found = rows.flatMap((g) => g.rows).find((r) => r.key === key);
  if (!found) throw new Error(`row ${key} missing`);
  return found;
}

describe('buildCompareRows (design 2026-11-13)', () => {
  it('marks the lowest price per litre', () => {
    const rows = buildCompareRows([castrol, motul, hp]);
    const unit = row(rows, 'unitPrice');
    expect(unit.cells).toEqual([
      { kind: 'unitPrice', paise: 48_889, per: 'litre' },
      { kind: 'unitPrice', paise: 52_000, per: 'litre' },
      { kind: 'unitPrice', paise: 36_667, per: 'litre' },
    ]);
    expect(unit.lowestIdx).toEqual([2]);
  });

  it('marks every product that ties on the lowest unit price', () => {
    const twin: ProductView = { ...hp, slug: 'hp-twin' };
    expect(row(buildCompareRows([castrol, hp, twin]), 'unitPrice').lowestIdx).toEqual([1, 2]);
  });

  it('a product without a price has empty price cells and never the lowest mark', () => {
    const unpriced: ProductView = { ...hp, slug: 'hp-unpriced', price: null };
    const rows = buildCompareRows([castrol, unpriced]);
    expect(row(rows, 'price').cells[1]).toBeNull();
    expect(row(rows, 'unitPrice').cells[1]).toBeNull();
    // One priced product only: nothing to be "lowest" against.
    expect(row(rows, 'unitPrice').lowestIdx).toEqual([]);
  });

  it('flags rows that are the same for every product', () => {
    const rows = buildCompareRows([castrol, motul, hp]);
    expect(row(rows, 'saeGrade').same).toBe(false);
    expect(row(rows, 'jasoClass').same).toBe(true);
    expect(row(rows, 'vehicleTypes').same).toBe(true);
    expect(row(rows, 'saeGrade').cells[1]).toEqual({ kind: 'code', code: '10W30' });
    expect(row(rows, 'apiClass').cells[0]).toEqual({ kind: 'code', code: 'SL', prefix: 'API' });
    expect(row(rows, 'baseType').cells[1]).toEqual({
      kind: 'enum',
      key: 'baseType',
      value: 'semi_synthetic',
    });
    // Castrol does not state its base oil: "Not listed", and the row differs.
    expect(row(rows, 'baseType').cells[0]).toBeNull();
    expect(row(rows, 'baseType').same).toBe(false);
  });

  it('drops rows nobody has and groups that end up empty', () => {
    const rows = buildCompareRows([castrol, hp]);
    const keys = rows.flatMap((g) => g.rows.map((r) => r.key));
    expect(keys).not.toContain('freeReplacementMonths');
    expect(keys).not.toContain('origin'); // demo data has no country of origin
    expect(rows.map((g) => g.key)).toEqual(['price', 'fit', 'specs', 'ratings']);
  });

  it('battery numbers carry their unit, warranty months their group', () => {
    const exide = findProduct('exide-xltz4a-2w-battery');
    const car = findProduct('car-starter-battery-45ah');
    if (!exide || !car) throw new Error('fixture missing');
    const rows = buildCompareRows([demoProduct(exide, 'en'), demoProduct(car, 'en')]);
    expect(row(rows, 'capacityAh').cells).toEqual([
      { kind: 'number', n: 3, unit: 'Ah' },
      { kind: 'number', n: 45, unit: 'Ah' },
    ]);
    expect(rows.find((g) => g.key === 'warranty')?.rows.map((r) => r.key)).toContain('freeReplacementMonths');
  });
});

describe('warranty (review 2026-11-13: no English free text on /hi)', () => {
  it('shows typed warranty months but not the untranslated warranty text', () => {
    const rows = buildCompareRows([
      { ...castrol, warranty: 'Two years from purchase' },
      { ...hp, warranty: 'One year' },
    ]);
    expect(rows.flatMap((g) => g.rows.map((r) => r.key))).not.toContain('warranty');
  });
});

describe('parseCompareParam', () => {
  it('keeps valid, distinct slugs, at most 4', () => {
    expect(parseCompareParam('a,a,B!,b,c,d,e')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseCompareParam(' a , b ')).toEqual(['a', 'b']);
    expect(parseCompareParam(undefined)).toEqual([]);
    expect(parseCompareParam(['x', 'y'])).toEqual(['x']);
  });
});
