import { CATALOGUE_SLUG_RE } from '@mechdost/shared/catalogue';
import {
  attributeDefs,
  COMPARE_MAX,
  unitPrice,
  type AttributeDef,
  type AttrValue,
  type UnitBasis,
} from '@mechdost/shared/product-attributes';
import type { VehicleType } from '@mechdost/shared/vehicles';
import type { ProductView } from '@/lib/catalogue/view';

/**
 * The comparison table as data (design 2026-11-13), built on the server and rendered by `CompareTable`. Pure and
 * locale-free: cells carry codes and numbers; the table translates them. A missing value is `null` ("Not listed");
 * a row nobody has is dropped; `same` marks rows that "Only differences" hides.
 */
export type CellValue =
  | { kind: 'price'; paise: number }
  | { kind: 'unitPrice'; paise: number; per: UnitBasis }
  | { kind: 'days'; days: number }
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string; prefix?: 'API' | 'JASO' }
  | { kind: 'enum'; key: string; value: string }
  | { kind: 'number'; n: number; unit?: 'V' | 'Ah' | 'months' }
  | { kind: 'bool'; on: boolean }
  | { kind: 'vehicleTypes'; types: readonly VehicleType[] }
  | { kind: 'rating'; avg: number; count: number };

export type RowLabel = { ns: 'row'; key: string } | { ns: 'attr'; key: string };

export interface CompareRow {
  key: string;
  label: RowLabel;
  cells: (CellValue | null)[];
  same: boolean;
  /** Unit price only: the columns with the lowest price per unit (ties all marked; empty with < 2 prices). */
  lowestIdx?: number[];
}

export type CompareGroupKey = 'price' | 'fit' | 'specs' | 'warranty' | 'ratings';

export interface CompareGroup {
  key: CompareGroupKey;
  rows: CompareRow[];
}

function row(key: string, label: RowLabel, cells: (CellValue | null)[]): CompareRow | null {
  if (cells.every((c) => c === null)) return null;
  const first = JSON.stringify(cells[0]);
  return { key, label, cells, same: cells.every((c) => JSON.stringify(c) === first) };
}

function attrCell(def: AttributeDef, v: AttrValue | undefined): CellValue | null {
  if (v === undefined) return null;
  switch (def.kind) {
    case 'boolean':
      return typeof v === 'boolean' ? { kind: 'bool', on: v } : null;
    case 'int':
    case 'decimal':
      return typeof v === 'number' ? { kind: 'number', n: v, ...(def.unit ? { unit: def.unit } : {}) } : null;
    case 'enum':
      if (typeof v !== 'string') return null;
      if (def.translate) return { kind: 'enum', key: def.key, value: v };
      return { kind: 'code', code: v, ...(def.prefix ? { prefix: def.prefix } : {}) };
    case 'text':
      return typeof v === 'string' ? { kind: 'code', code: v } : null;
  }
}

function unitPriceRow(items: readonly ProductView[]): CompareRow | null {
  const cells = items.map((p): CellValue | null => {
    if (!p.price) return null;
    const u = unitPrice(p.price.pricePaise, p.pack);
    return u ? { kind: 'unitPrice', ...u } : null;
  });
  const r = row('unitPrice', { ns: 'row', key: 'unitPrice' }, cells);
  if (!r) return null;
  const priced = cells.flatMap((c, i) =>
    c?.kind === 'unitPrice' ? [{ i, paise: c.paise, per: c.per }] : [],
  );
  // "Lowest" only means something between at least two prices on the same basis (per litre vs per litre).
  const sameBasis = priced.every((c) => c.per === priced[0]?.per);
  if (priced.length < 2 || !sameBasis) return { ...r, lowestIdx: [] };
  const min = Math.min(...priced.map((c) => c.paise));
  return { ...r, lowestIdx: priced.filter((c) => c.paise === min).map((c) => c.i) };
}

/** All products share one category (the page keeps only the first product's category). */
export function buildCompareRows(items: readonly ProductView[]): CompareGroup[] {
  const set = items[0]?.attributeSet ?? null;
  const defs = set === null ? [] : attributeDefs(set);
  const attrRows = (group: AttributeDef['group']) =>
    defs
      .filter((d) => d.group === group)
      .map((d) =>
        row(
          d.key,
          { ns: 'attr', key: d.key },
          items.map((p) => attrCell(d, p.attributes[d.key])),
        ),
      );
  const groups: { key: CompareGroupKey; rows: (CompareRow | null)[] }[] = [
    {
      key: 'price',
      rows: [
        row(
          'price',
          { ns: 'row', key: 'price' },
          items.map((p) => (p.price ? { kind: 'price', paise: p.price.pricePaise } : null)),
        ),
        row(
          'mrp',
          { ns: 'row', key: 'mrp' },
          items.map((p) => (p.price?.mrpPaise ? { kind: 'price', paise: p.price.mrpPaise } : null)),
        ),
        unitPriceRow(items),
        row(
          'delivery',
          { ns: 'row', key: 'delivery' },
          items.map((p) => (p.price && p.leadDays !== null ? { kind: 'days', days: p.leadDays } : null)),
        ),
      ],
    },
    {
      key: 'fit',
      rows: [
        row(
          'vehicleTypes',
          { ns: 'row', key: 'vehicleTypes' },
          items.map((p) =>
            p.vehicleTypes.length > 0 ? { kind: 'vehicleTypes', types: p.vehicleTypes } : null,
          ),
        ),
        row(
          'compatibility',
          { ns: 'row', key: 'compatibility' },
          items.map((p) => (p.compatibility ? { kind: 'text', text: p.compatibility } : null)),
        ),
      ],
    },
    { key: 'specs', rows: attrRows('specs') },
    {
      key: 'warranty',
      rows: [
        ...attrRows('warranty'),
        row(
          'warranty',
          { ns: 'row', key: 'warranty' },
          items.map((p) => (p.warranty ? { kind: 'text', text: p.warranty } : null)),
        ),
        row(
          'origin',
          { ns: 'row', key: 'origin' },
          items.map((p) => (p.countryOfOrigin ? { kind: 'text', text: p.countryOfOrigin } : null)),
        ),
      ],
    },
    {
      key: 'ratings',
      rows: [
        row(
          'rating',
          { ns: 'row', key: 'rating' },
          items.map((p) =>
            p.rating && p.rating.count > 0
              ? { kind: 'rating', avg: p.rating.avg, count: p.rating.count }
              : null,
          ),
        ),
      ],
    },
  ];
  return groups
    .map((g) => ({ key: g.key, rows: g.rows.filter((r): r is CompareRow => r !== null) }))
    .filter((g) => g.rows.length > 0);
}

/** `?p=a,b,c` → valid, distinct slugs, at most 4 (a repeated `p` uses the first). */
export function parseCompareParam(p: string | string[] | undefined): string[] {
  const raw = Array.isArray(p) ? p[0] : p;
  if (!raw) return [];
  const slugs = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => CATALOGUE_SLUG_RE.test(s));
  return [...new Set(slugs)].slice(0, COMPARE_MAX);
}
