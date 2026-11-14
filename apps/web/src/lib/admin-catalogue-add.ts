import {
  IMPORT_COLUMNS,
  IMPORT_ERROR_CODES,
  IMPORT_MAX_CSV_CHARS,
  type ImportErrorCode,
} from '@mechdost/shared/catalogue-import';
import { attributeDefs, NET_UNITS, type AttributeDef } from '@mechdost/shared/product-attributes';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { errorKey } from './admin-prices-view';
import { parseRupees } from './money-input';

/**
 * Admin → Catalogue → Add product / Import CSV (plan 2026-11-14 Stream B). Turns the form into the body of
 * `POST /v1/admin/catalogue/products` and the API's codes into `portal.cat_add_*` / `portal.cat_import_*` keys.
 * The API checks everything again (hard rule 4); these checks only put the message next to the form sooner.
 */
export interface CategoryOption {
  slug: string;
  parentSlug: string | null;
  name: string;
}

/** The attribute list a category uses: its own, else its parent's (same rule as the API's `attributeSetFor`). */
export function attributesFor(category: CategoryOption | null): readonly AttributeDef[] {
  if (!category) return [];
  const own = attributeDefs(category.slug);
  return own.length > 0 || !category.parentSlug ? own : attributeDefs(category.parentSlug);
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');

export type NewProductBody = Record<string, unknown> & { sku: string; mrpPaise: number };

export type FormRead = { ok: true; body: NewProductBody } | { ok: false; key: string };

/**
 * Read the add-product form. `get` returns the trimmed value of a field (empty string when absent). Empty
 * optional texts are left out; the SKU is sent as typed (the API upper-cases it).
 */
export function readNewProduct(
  get: (name: string) => string,
  opts: { category: CategoryOption | null; vehicleTypes: readonly string[]; publish: boolean },
): FormRead {
  if (!opts.category || !get('brand') || !get('name') || !get('sku') || !get('hsn'))
    return { ok: false, key: 'cat_add_err_REQUIRED' };
  const mrp = parseRupees(get('mrp'));
  if (!mrp.ok) return { ok: false, key: 'cat_add_err_mrp' };
  const qty = get('packQty');
  const unit = NET_UNITS.find((u) => u === get('packUnit'));
  if (qty !== '' && (!/^\d{1,7}$/.test(qty) || Number(qty) < 1 || !unit))
    return { ok: false, key: 'cat_add_err_NET_QUANTITY' };

  const attributes: Record<string, string | number | boolean> = {};
  for (const def of attributesFor(opts.category)) {
    const raw = get(`attr_${def.key}`);
    if (raw === '') continue;
    if (def.kind === 'boolean') attributes[def.key] = raw === 'yes';
    else if (def.kind === 'int' || def.kind === 'decimal') {
      if (!/^\d{1,6}(\.\d{1,3})?$/.test(raw)) return { ok: false, key: 'cat_add_err_ATTRIBUTE_VALUE' };
      attributes[def.key] = Number(raw);
    } else attributes[def.key] = raw;
  }

  const body: NewProductBody = {
    categorySlug: opts.category.slug,
    brand: get('brand'),
    name: get('name'),
    sku: get('sku'),
    mrpPaise: mrp.paise,
    hsn: get('hsn'),
    gstRateBp: Number(get('gst')),
    vehicleTypes: VEHICLE_TYPES.filter((v) => opts.vehicleTypes.includes(v)),
    attributes,
    highlights: lines(get('highlights')),
    highlightsHi: lines(get('highlightsHi')),
  };
  for (const f of [
    'nameHi',
    'slug',
    'specSummary',
    'specSummaryHi',
    'compatibility',
    'compatibilityHi',
    'description',
    'descriptionHi',
  ]) {
    const v = get(f);
    if (v !== '') body[f] = f === 'slug' ? v.toLowerCase() : v;
  }
  if (qty !== '' && unit) body.netQuantity = { qty: Number(qty), unit };
  if (opts.publish) body.publish = true;
  return { ok: true, body };
}

const ROW_CODES: ReadonlySet<string> = new Set(IMPORT_ERROR_CODES);

/** Message key for an API error code on the add form (`portal.cat_add_err_*`, else the shared `cat_err_*`). */
export function addErrorKey(code: string): string {
  if (code === 'SKU_TAKEN' || ROW_CODES.has(code)) return `cat_add_err_${code}`;
  if (code === 'VALIDATION') return 'cat_add_err_INVALID';
  return errorKey(code);
}

/** Message key for one problem in an import row. */
export function rowProblemKey(code: ImportErrorCode): string {
  return `cat_add_err_${code}`;
}

export const IMPORT_FILE_REASONS = ['MALFORMED', 'EMPTY', 'TOO_MANY_ROWS', 'HEADER', 'TOO_BIG'] as const;
export type ImportFileReason = (typeof IMPORT_FILE_REASONS)[number];

/** Checked in the browser before sending: a file larger than one request can carry is refused right away. */
export function fileTooBig(text: string): boolean {
  return text.length > IMPORT_MAX_CSV_CHARS;
}

/** The empty template people download: just the header row, in the documented order. */
export const IMPORT_TEMPLATE = `${IMPORT_COLUMNS.join(',')}\n`;
