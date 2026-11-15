import { csvField, parseCsv } from './catalogue-import';

/**
 * Shop stock and price CSV (design 2026-11-15, item 4; spec 07). Zod-free so the portal can import the limits and
 * labels without shipping Zod (L79). Rules: the file never half-applies (the plan below is all-or-nothing); a price in
 * the file is only ever a price REQUEST for staff to approve; a cell that starts with `= + - @` (a spreadsheet formula)
 * is treated as text and refused; errors name the line, the column and a code, and never repeat what was in the cell.
 */

export const SHOP_CSV_MAX_ROWS = 2000;
export const SHOP_CSV_MAX_BYTES = 1_000_000;
export const SHOP_CSV_COLUMNS = ['sku', 'stock', 'active', 'requested_price'] as const;
export type ShopCsvColumn = (typeof SHOP_CSV_COLUMNS)[number];

export const SHOP_CSV_ERROR_CODES = [
  'SKU_INVALID',
  'DUPLICATE_SKU',
  'FORMULA_CELL',
  'STOCK_INVALID',
  'ACTIVE_INVALID',
  'PRICE_INVALID',
  'UNKNOWN_SKU',
  'NOT_CARRIED',
  'STOCK_REQUIRED',
  'STOCK_BELOW_RESERVED',
  'PRICE_ABOVE_MRP',
  'PRODUCT_NOT_LIVE',
  'LISTING_BLOCKED',
] as const;
export type ShopCsvErrorCode = (typeof SHOP_CSV_ERROR_CODES)[number];

export interface ShopCsvError {
  /** The line in the file (the header is line 1). */
  line: number;
  column: ShopCsvColumn;
  code: ShopCsvErrorCode;
}

export interface ShopCsvRow {
  line: number;
  sku: string;
  stock: number | null;
  active: boolean | null;
  requestedPaise: number | null;
}

export type ShopCsvParse =
  | { ok: true; rows: ShopCsvRow[]; errors: ShopCsvError[] }
  | { ok: false; code: 'EMPTY' | 'MALFORMED' | 'TOO_MANY_ROWS' | 'HEADER' };

const SKU = /^[A-Z0-9][A-Z0-9-]{1,47}$/;
const FORMULA_START = /^[=+\-@\t\r]/;
const YES = new Set(['true', '1', 'yes', 'y']);
const NO = new Set(['false', '0', 'no', 'n']);

/** Rupees as typed ("125", "125.5", "1,250.00") → paise, exactly; null when not an amount above zero. */
function rupeesToPaise(raw: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.replace(/,/g, ''));
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return paise > 0 ? paise : null;
}

/** CSV text → rows plus the cell-level errors (shape only; stock, MRP and the shop's catalogue come later). */
export function parseShopCsv(text: string): ShopCsvParse {
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, code: 'MALFORMED' };
  const [header, ...data] = parsed.records;
  if (!header || data.length === 0) return { ok: false, code: 'EMPTY' };
  if (data.length > SHOP_CSV_MAX_ROWS) return { ok: false, code: 'TOO_MANY_ROWS' };
  const names = header.map((h) => h.trim().toLowerCase());
  const known = new Set<string>(SHOP_CSV_COLUMNS);
  if (
    !names.includes('sku') ||
    names.length === 1 ||
    names.some((n, i) => !known.has(n) || names.indexOf(n) !== i)
  )
    return { ok: false, code: 'HEADER' };

  const errors: ShopCsvError[] = [];
  const rows: ShopCsvRow[] = [];
  const seen = new Set<string>();
  data.forEach((cells, i) => {
    const line = i + 2;
    const cellAt = (c: ShopCsvColumn) => {
      const at = names.indexOf(c);
      return at < 0 ? '' : (cells[at] ?? '').trim();
    };
    const fail = (column: ShopCsvColumn, code: ShopCsvErrorCode) => errors.push({ line, column, code });
    const raw = {
      sku: cellAt('sku'),
      stock: cellAt('stock'),
      active: cellAt('active').toLowerCase(),
      price: cellAt('requested_price'),
    };
    const formula = (column: ShopCsvColumn, value: string) => {
      if (!FORMULA_START.test(value)) return false;
      fail(column, 'FORMULA_CELL');
      return true;
    };

    const sku = raw.sku.toUpperCase();
    if (!formula('sku', raw.sku)) {
      if (!SKU.test(sku)) fail('sku', 'SKU_INVALID');
      else if (seen.has(sku)) fail('sku', 'DUPLICATE_SKU');
      else seen.add(sku);
    }
    let stock: number | null = null;
    if (raw.stock !== '' && !formula('stock', raw.stock)) {
      if (/^\d{1,6}$/.test(raw.stock) && Number(raw.stock) <= 100_000) stock = Number(raw.stock);
      else fail('stock', 'STOCK_INVALID');
    }
    let active: boolean | null = null;
    if (raw.active !== '' && !formula('active', raw.active)) {
      if (YES.has(raw.active)) active = true;
      else if (NO.has(raw.active)) active = false;
      else fail('active', 'ACTIVE_INVALID');
    }
    let requestedPaise: number | null = null;
    if (raw.price !== '' && !formula('requested_price', raw.price)) {
      requestedPaise = rupeesToPaise(raw.price);
      if (requestedPaise === null) fail('requested_price', 'PRICE_INVALID');
    }
    rows.push({ line, sku, stock, active, requestedPaise });
  });
  return { ok: true, rows, errors };
}

/** What the plan needs to know about one SKU for this shop (absent from the map = no such SKU). */
export interface ShopCsvCatalogEntry {
  mrpPaise: number;
  live: boolean;
  offer: {
    onHand: number;
    reserved: number;
    active: boolean;
    adminBlocked: boolean;
    sellingPaise: number;
    version: number;
  } | null;
}

export interface ShopCsvChange {
  line: number;
  sku: string;
  stock: { from: number; to: number } | null;
  active: { from: boolean; to: boolean } | null;
  /** A price request for staff approval; `currentPaise` null when the shop does not sell the SKU yet. */
  price: { requestedPaise: number; currentPaise: number | null; onHand: number } | null;
  /** Version of the offer the change was planned against (compare-and-set on apply); null for a new listing. */
  version: number | null;
}

export interface ShopCsvPlan {
  changes: ShopCsvChange[];
  errors: ShopCsvError[];
  /** Rows that already match the shop's offer (nothing to do). */
  unchanged: number;
}

/** Combine the parsed rows with the shop's catalogue: what would change, and what is refused. Pure. */
export function planShopCsv(
  rows: readonly ShopCsvRow[],
  cellErrors: readonly ShopCsvError[],
  catalog: ReadonlyMap<string, ShopCsvCatalogEntry>,
): ShopCsvPlan {
  const errors = [...cellErrors];
  const changes: ShopCsvChange[] = [];
  let unchanged = 0;
  const badLines = new Set(cellErrors.map((e) => e.line));
  for (const r of rows) {
    if (badLines.has(r.line)) continue;
    const fail = (column: ShopCsvColumn, code: ShopCsvErrorCode) =>
      errors.push({ line: r.line, column, code });
    const entry = catalog.get(r.sku);
    if (!entry) {
      fail('sku', 'UNKNOWN_SKU');
      continue;
    }
    const offer = entry.offer;
    if (!offer) {
      if (r.requestedPaise === null) fail('sku', 'NOT_CARRIED');
      else if (r.stock === null) fail('stock', 'STOCK_REQUIRED');
      else if (!entry.live) fail('sku', 'PRODUCT_NOT_LIVE');
      else if (r.requestedPaise > entry.mrpPaise) fail('requested_price', 'PRICE_ABOVE_MRP');
      else
        changes.push({
          line: r.line,
          sku: r.sku,
          stock: null,
          active: null,
          price: { requestedPaise: r.requestedPaise, currentPaise: null, onHand: r.stock },
          version: null,
        });
      continue;
    }
    let ok = true;
    const stock = r.stock !== null && r.stock !== offer.onHand ? { from: offer.onHand, to: r.stock } : null;
    if (stock && stock.to < offer.reserved) {
      fail('stock', 'STOCK_BELOW_RESERVED');
      ok = false;
    }
    const active =
      r.active !== null && r.active !== offer.active ? { from: offer.active, to: r.active } : null;
    if (active?.to && offer.adminBlocked) {
      fail('active', 'LISTING_BLOCKED');
      ok = false;
    }
    let price: ShopCsvChange['price'] = null;
    if (r.requestedPaise !== null && r.requestedPaise !== offer.sellingPaise) {
      if (!entry.live) {
        fail('sku', 'PRODUCT_NOT_LIVE');
        ok = false;
      } else if (r.requestedPaise > entry.mrpPaise) {
        fail('requested_price', 'PRICE_ABOVE_MRP');
        ok = false;
      } else
        price = {
          requestedPaise: r.requestedPaise,
          currentPaise: offer.sellingPaise,
          onHand: r.stock ?? offer.onHand,
        };
    }
    if (!ok) continue;
    if (!stock && !active && !price) unchanged++;
    else changes.push({ line: r.line, sku: r.sku, stock, active, price, version: offer.version });
  }
  errors.sort((a, b) => a.line - b.line);
  return { changes, errors, unchanged };
}

/** A cell written back into a CSV: values starting with a formula character get a leading apostrophe. */
export function safeCsvCell(value: string): string {
  return csvField(FORMULA_START.test(value) ? `'${value}` : value);
}

/** The template: one row per SKU the shop offers now (stock and on/off as they are), the price column empty. */
export function shopCsvTemplate(offers: readonly { sku: string; onHand: number; active: boolean }[]): string {
  const lines: string[] = [SHOP_CSV_COLUMNS.join(',')];
  for (const o of offers)
    lines.push([safeCsvCell(o.sku), String(o.onHand), o.active ? 'yes' : 'no', ''].join(','));
  return `${lines.join('\r\n')}\r\n`;
}
