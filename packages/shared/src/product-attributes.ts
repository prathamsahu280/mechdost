/**
 * Typed product attributes and unit prices for comparison (design `docs/superpowers/specs/2026-11-13-product-comparison-design.md`,
 * decisions 2026-11-13 "Product comparison: typed attributes in code"). Zod-free so the website can use it without
 * shipping Zod (JS budget, L79). The attribute list per category lives here; the values live in `products.spec`
 * and are edited by the admin. Codes, never free text (hard rule 16).
 */

export { COMPARE_MAX } from './compare-max';

export const NET_UNITS = ['ml', 'g', 'piece', 'm'] as const;
export type NetUnit = (typeof NET_UNITS)[number];

/** Net quantity of one pack (a variant / SKU): a whole number in a base unit (Legal Metrology declaration). */
export interface NetQuantity {
  qty: number;
  unit: NetUnit;
}

export const NET_QTY_MAX = 1_000_000;

export function isNetQuantity(v: unknown): v is NetQuantity {
  if (typeof v !== 'object' || v === null) return false;
  const { qty, unit } = v as { qty?: unknown; unit?: unknown };
  return (
    typeof qty === 'number' &&
    Number.isInteger(qty) &&
    qty >= 1 &&
    qty <= NET_QTY_MAX &&
    typeof unit === 'string' &&
    (NET_UNITS as readonly string[]).includes(unit)
  );
}

export type UnitBasis = 'litre' | 'kg' | 'piece' | 'metre';

/**
 * Price per litre / kg / piece / metre in integer paise, rounded half up, from the same pack as the price.
 * Single-piece packs have no unit price (it would just repeat the price).
 */
export function unitPrice(
  pricePaise: number,
  pack: NetQuantity | null,
): { paise: number; per: UnitBasis } | null {
  if (!pack || !isNetQuantity(pack)) return null;
  switch (pack.unit) {
    case 'ml':
      return { paise: Math.round((pricePaise * 1000) / pack.qty), per: 'litre' };
    case 'g':
      return { paise: Math.round((pricePaise * 1000) / pack.qty), per: 'kg' };
    case 'piece':
      return pack.qty > 1 ? { paise: Math.round(pricePaise / pack.qty), per: 'piece' } : null;
    case 'm':
      return { paise: Math.round(pricePaise / pack.qty), per: 'metre' };
  }
}

export type AttrValue = string | number | boolean;

export interface AttributeDef {
  key: string;
  kind: 'enum' | 'int' | 'decimal' | 'text' | 'boolean';
  values?: readonly string[];
  min?: number;
  max?: number;
  pattern?: RegExp;
  unit?: 'V' | 'Ah' | 'months';
  /** Shown before the code, e.g. "API SL", "JASO MA2". */
  prefix?: 'API' | 'JASO';
  /** Enum values with a translated label (`compare.value.<key>.<value>`); others are shown as codes. */
  translate?: boolean;
  group: 'specs' | 'warranty';
}

/** MVP definitions (engine oil, battery, tyre), keyed by category slug. Other categories compare on shared rows. */
export const ATTRIBUTE_DEFS: Readonly<Record<string, readonly AttributeDef[]>> = {
  lubricants: [
    {
      key: 'saeGrade',
      kind: 'enum',
      values: ['0W20', '0W30', '5W30', '5W40', '10W30', '10W40', '15W40', '15W50', '20W40', '20W50'],
      group: 'specs',
    },
    {
      key: 'apiClass',
      kind: 'enum',
      values: ['SG', 'SJ', 'SL', 'SM', 'SN', 'SP', 'CF4', 'CH4', 'CI4', 'CK4'],
      prefix: 'API',
      group: 'specs',
    },
    { key: 'jasoClass', kind: 'enum', values: ['MA', 'MA1', 'MA2', 'MB'], prefix: 'JASO', group: 'specs' },
    {
      key: 'baseType',
      kind: 'enum',
      values: ['mineral', 'semi_synthetic', 'synthetic'],
      translate: true,
      group: 'specs',
    },
  ],
  batteries: [
    { key: 'voltage', kind: 'int', min: 2, max: 48, unit: 'V', group: 'specs' },
    { key: 'capacityAh', kind: 'decimal', min: 0.5, max: 300, unit: 'Ah', group: 'specs' },
    {
      key: 'batteryType',
      kind: 'enum',
      values: ['flooded', 'vrla', 'agm', 'lithium'],
      translate: true,
      group: 'specs',
    },
    { key: 'freeReplacementMonths', kind: 'int', min: 0, max: 120, unit: 'months', group: 'warranty' },
    { key: 'proRataMonths', kind: 'int', min: 0, max: 120, unit: 'months', group: 'warranty' },
  ],
  tyres: [
    { key: 'size', kind: 'text', pattern: /^[0-9][0-9./ R-]{2,18}$/, group: 'specs' },
    { key: 'loadIndex', kind: 'int', min: 20, max: 150, group: 'specs' },
    {
      key: 'speedSymbol',
      kind: 'enum',
      values: ['J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'H', 'V', 'W', 'Y'],
      group: 'specs',
    },
    { key: 'tubeless', kind: 'boolean', group: 'specs' },
    { key: 'position', kind: 'enum', values: ['front', 'rear', 'both'], translate: true, group: 'specs' },
  ],
};

export function attributeDefs(categorySlug: string): readonly AttributeDef[] {
  return Object.hasOwn(ATTRIBUTE_DEFS, categorySlug) ? (ATTRIBUTE_DEFS[categorySlug] ?? []) : [];
}

function inRange(n: number, def: AttributeDef): boolean {
  return (def.min === undefined || n >= def.min) && (def.max === undefined || n <= def.max);
}

function validValue(def: AttributeDef, v: unknown): v is AttrValue {
  switch (def.kind) {
    case 'enum':
      return typeof v === 'string' && (def.values ?? []).includes(v);
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && inRange(v, def);
    case 'decimal':
      // One decimal place at most (e.g. 2.5 Ah).
      return (
        typeof v === 'number' &&
        Number.isFinite(v) &&
        Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 &&
        inRange(v, def)
      );
    case 'text':
      return typeof v === 'string' && (def.pattern ? def.pattern.test(v) : v.length > 0 && v.length <= 40);
    case 'boolean':
      return typeof v === 'boolean';
  }
}

export type AttributeCheck =
  | { ok: true; values: Record<string, AttrValue> }
  | { ok: false; key: string; code: 'UNKNOWN_KEY' | 'BAD_VALUE' };

/** Strict check for writes: every key must be defined for the category and every value valid. */
export function validateAttributes(categorySlug: string, input: Record<string, unknown>): AttributeCheck {
  const defs = attributeDefs(categorySlug);
  const values: Record<string, AttrValue> = {};
  for (const [key, v] of Object.entries(input)) {
    const def = defs.find((d) => d.key === key);
    if (!def) return { ok: false, key, code: 'UNKNOWN_KEY' };
    if (!validValue(def, v)) return { ok: false, key, code: 'BAD_VALUE' };
    values[key] = v;
  }
  return { ok: true, values };
}

/** Tolerant read for display: keeps only valid known values (an old or broken value shows as "Not listed"). */
export function readAttributes(categorySlug: string, stored: unknown): Record<string, AttrValue> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const values: Record<string, AttrValue> = {};
  for (const def of attributeDefs(categorySlug)) {
    const v: unknown = (stored as Record<string, unknown>)[def.key];
    if (validValue(def, v)) values[def.key] = v;
  }
  return values;
}
