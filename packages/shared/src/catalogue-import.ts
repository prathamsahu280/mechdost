import { toPaise } from './money';
import { attributeDefs, NET_UNITS, type AttrValue } from './product-attributes';

/**
 * Adding products (spec 02/08, plan 2026-11-14 Stream B): the CSV import format and the rules both the form
 * (`POST /v1/admin/catalogue/products`) and the import (`POST /v1/admin/catalogue/import`) share. Zod-free so the
 * admin screen can use it without shipping Zod (L79). Codes, never free text (hard rule 16). Column reference:
 * `docs/runbooks/catalogue-import.md`.
 */

export const IMPORT_MAX_ROWS = 500;
/** Characters of CSV text accepted in one request (the API body limit is 1 MB; Hindi takes 3 bytes a letter). */
export const IMPORT_MAX_CSV_CHARS = 300_000;

/** Header of the import file, in the documented order. Extra columns are refused (a typo would be silent). */
export const IMPORT_COLUMNS = [
  'category',
  'brand',
  'name',
  'name_hi',
  'slug',
  'spec_summary',
  'spec_summary_hi',
  'compatibility',
  'compatibility_hi',
  'description',
  'description_hi',
  'highlights',
  'highlights_hi',
  'vehicle_types',
  'attributes',
  'sku',
  'mrp_rupees',
  'hsn',
  'gst_rate_percent',
  'net_qty',
  'net_unit',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_REQUIRED_COLUMNS: readonly ImportColumn[] = [
  'category',
  'brand',
  'name',
  'sku',
  'mrp_rupees',
  'hsn',
  'gst_rate_percent',
];

/** GST rates a product may carry, in basis points (goods slabs, old and GST 2.0; the DB allows 0–40 %). */
export const PRODUCT_GST_RATES_BP = [0, 500, 1200, 1800, 2800, 4000] as const;

/**
 * Product slugs: the same rule as `CATALOGUE_SLUG_RE` (`./catalogue`, which loads Zod; the database package must
 * not load it before the API's `@hono/zod-openapi`). A test keeps the two identical.
 */
export const PRODUCT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** SKUs are upper-case codes; no `/` because a SKU is a path segment in the admin API. */
export const SKU_RE = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

/** Why a row (or a form field) was refused. One list for the API, the screen and the runbook. */
export const IMPORT_ERROR_CODES = [
  'REQUIRED',
  'INVALID',
  'TOO_LONG',
  'UNKNOWN_CATEGORY',
  'ATTRIBUTE_UNKNOWN',
  'ATTRIBUTE_VALUE',
  'SLUG_TAKEN',
  'SLUG_REPEATED',
  'SKU_REPEATED',
  'HIGHLIGHTS_HI_ALIGNED',
  'NET_QUANTITY',
  'HINDI_MISSING',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** `row` is the spreadsheet row number (the header is row 1); `field` is the CSV column name. */
export interface ImportRowError {
  row: number;
  field: ImportColumn;
  code: ImportErrorCode;
}

/** The JSON body field each CSV column fills (errors are always reported by column name). */
export const FIELD_COLUMN: Readonly<Record<string, ImportColumn>> = {
  categorySlug: 'category',
  brand: 'brand',
  name: 'name',
  nameHi: 'name_hi',
  slug: 'slug',
  specSummary: 'spec_summary',
  specSummaryHi: 'spec_summary_hi',
  compatibility: 'compatibility',
  compatibilityHi: 'compatibility_hi',
  description: 'description',
  descriptionHi: 'description_hi',
  highlights: 'highlights',
  highlightsHi: 'highlights_hi',
  vehicleTypes: 'vehicle_types',
  attributes: 'attributes',
  sku: 'sku',
  mrpPaise: 'mrp_rupees',
  hsn: 'hsn',
  gstRateBp: 'gst_rate_percent',
  netQuantity: 'net_qty',
};

/** URL slug from free text: lower-case ASCII letters and digits joined by single hyphens (max 120). */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '');
}

/** Default product slug: brand + name ("Exide" + "XLTZ4A 2W battery" → "exide-xltz4a-2w-battery"). */
export function productSlug(brand: string, name: string): string {
  const b = slugify(brand);
  const n = slugify(name);
  if (n.startsWith(`${b}-`) || n === b) return n;
  return slugify(`${b}-${n}`);
}

export type CsvParse = { ok: true; records: string[][] } | { ok: false; code: 'MALFORMED' };

/**
 * RFC 4180 CSV: comma separated, fields in double quotes may hold commas, quotes ("") and line breaks; CRLF or
 * LF; a leading byte-order mark (Excel "CSV UTF-8") is dropped; blank lines are skipped.
 */
export function parseCsv(text: string): CsvParse {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRecord = () => {
    record.push(field);
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
    field = '';
  };
  while (i < src.length) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const next = src[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r')
          return { ok: false, code: 'MALFORMED' };
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (field !== '') return { ok: false, code: 'MALFORMED' };
      quoted = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && src[i + 1] === '\n') i++;
    } else field += ch;
    i++;
  }
  if (quoted) return { ok: false, code: 'MALFORMED' };
  if (field !== '' || record.length > 0) endRecord();
  return { ok: true, records };
}

/** Write one CSV field (quoted when it holds a comma, quote or line break). */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Attribute values typed in a spreadsheet arrive as text; turn "12" into 12 and "yes" into true where the
 * category's definition wants a number or a yes/no. Anything else is left for `validateAttributes` to judge.
 */
export function coerceAttributes(
  attributeSet: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const defs = attributeDefs(attributeSet);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(input)) {
    const def = defs.find((d) => d.key === key);
    if (typeof v !== 'string' || !def) {
      out[key] = v;
      continue;
    }
    const s = v.trim();
    if ((def.kind === 'int' || def.kind === 'decimal') && /^\d{1,6}(\.\d{1,3})?$/.test(s))
      out[key] = Number(s);
    else if (def.kind === 'boolean' && /^(true|yes|1)$/i.test(s)) out[key] = true;
    else if (def.kind === 'boolean' && /^(false|no|0)$/i.test(s)) out[key] = false;
    else out[key] = s;
  }
  return out;
}

/** "18" or "18.00" per cent → 1800 basis points, exactly (no float maths); null when not a percentage. */
export function percentToBp(raw: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(raw.trim().replace(/%$/, ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const list = (cell: string) =>
  cell
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== '');

export type CsvRows =
  | {
      ok: true;
      rows: { row: number; input: Record<string, unknown>; errors: ImportRowError[] }[];
    }
  | { ok: false; code: 'MALFORMED' | 'EMPTY' | 'TOO_MANY_ROWS' }
  | { ok: false; code: 'HEADER'; missing: string[]; unknown: string[] };

/**
 * CSV text → one body-shaped object per data row (empty cells are left out), plus the errors found while
 * converting cells (rupees, per cent, lists, attributes, net quantity). The API then checks each object with the
 * same schema as the form and the repository adds the catalogue checks.
 */
export function csvImportRows(text: string): CsvRows {
  const parsed = parseCsv(text);
  if (!parsed.ok) return parsed;
  const [header, ...data] = parsed.records;
  if (!header || data.length === 0) return { ok: false, code: 'EMPTY' };
  if (data.length > IMPORT_MAX_ROWS) return { ok: false, code: 'TOO_MANY_ROWS' };
  const names = header.map((h) => h.trim().toLowerCase());
  const known = new Set<string>(IMPORT_COLUMNS);
  const unknown = names.filter((n) => !known.has(n));
  const missing = IMPORT_REQUIRED_COLUMNS.filter((c) => !names.includes(c));
  const repeated = names.filter((n, i) => names.indexOf(n) !== i);
  if (unknown.length > 0 || missing.length > 0 || repeated.length > 0)
    return { ok: false, code: 'HEADER', missing, unknown: [...unknown, ...repeated] };

  return {
    ok: true,
    rows: data.map((cells, i) => {
      const row = i + 2;
      const cell = (c: ImportColumn) => {
        const at = names.indexOf(c);
        return at < 0 ? '' : (cells[at] ?? '').trim();
      };
      const errors: ImportRowError[] = [];
      const input: Record<string, unknown> = {};
      const text = (key: string, c: ImportColumn) => {
        const v = cell(c);
        if (v !== '') input[key] = v;
      };
      text('categorySlug', 'category');
      text('brand', 'brand');
      text('name', 'name');
      text('nameHi', 'name_hi');
      text('slug', 'slug');
      text('specSummary', 'spec_summary');
      text('specSummaryHi', 'spec_summary_hi');
      text('compatibility', 'compatibility');
      text('compatibilityHi', 'compatibility_hi');
      text('description', 'description');
      text('descriptionHi', 'description_hi');
      text('hsn', 'hsn');
      if (typeof input.categorySlug === 'string') input.categorySlug = input.categorySlug.toLowerCase();
      if (cell('sku') !== '') input.sku = cell('sku').toUpperCase();
      if (cell('highlights') !== '') input.highlights = list(cell('highlights'));
      if (cell('highlights_hi') !== '') input.highlightsHi = list(cell('highlights_hi'));
      if (cell('vehicle_types') !== '')
        input.vehicleTypes = list(cell('vehicle_types')).map((v) => v.toUpperCase());

      if (cell('attributes') !== '') {
        const attrs: Record<string, AttrValue> = {};
        for (const pair of list(cell('attributes'))) {
          const eq = pair.indexOf('=');
          const key = eq > 0 ? pair.slice(0, eq).trim() : '';
          if (!key) {
            errors.push({ row, field: 'attributes', code: 'INVALID' });
            break;
          }
          attrs[key] = pair.slice(eq + 1).trim();
        }
        input.attributes = attrs;
      }

      const mrp = cell('mrp_rupees').replace(/^₹\s*/, '');
      if (mrp !== '') {
        try {
          input.mrpPaise = toPaise(mrp);
        } catch {
          errors.push({ row, field: 'mrp_rupees', code: 'INVALID' });
        }
      }
      const gst = cell('gst_rate_percent');
      if (gst !== '') {
        const bp = percentToBp(gst);
        if (bp === null) errors.push({ row, field: 'gst_rate_percent', code: 'INVALID' });
        else input.gstRateBp = bp;
      }

      const qty = cell('net_qty');
      const unit = cell('net_unit').toLowerCase();
      if (qty !== '' || unit !== '') {
        if (/^\d{1,7}$/.test(qty) && (NET_UNITS as readonly string[]).includes(unit))
          input.netQuantity = { qty: Number(qty), unit };
        else errors.push({ row, field: 'net_qty', code: 'NET_QUANTITY' });
      }
      return { row, input, errors };
    }),
  };
}
