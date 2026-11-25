import { createHash } from 'node:crypto';
import { productSlug, slugify } from '@mechdost/shared/catalogue-import';
import { normaliseViscosity } from '@mechdost/shared/search';
import { isNetQuantity, type NetQuantity } from '@mechdost/shared/product-attributes';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { hindiFromGlossary, SPEC_KEYS_HI, SUB_CATEGORIES } from './glossary';

/**
 * Catalogue-v2 import plan (design `docs/superpowers/specs/2026-11-22-real-catalogue-and-smart-search-design.md`):
 * the pure step that turns the source JSON (`catalogue-v2/site/data/*.json`) into what the database should hold.
 * No I/O here, so it is unit-tested on fixtures; `repo/catalogue-v2-import.ts` writes it, the API CLI uploads photos.
 *
 * Source fields: `co` company, `b` brand, `k` category, `s` range, `n` name, `d` description, `i` picture index,
 * `iu` picture URL, `r` = the picture is only representative (a similar product), `v[]` = packs
 * `[pack/model/size, MRP rupees incl. GST or "", "key: value; …"]`.
 */
export const SECTIONS = ['lub', 'bat', 'car', 'tyr', 'flt'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SourceProduct {
  co: string;
  b: string;
  k: string;
  s: string;
  n: string;
  d: string;
  i: number | null;
  iu: string;
  u: string;
  src: string;
  v: [string, string, string][];
  id: number;
  r?: number;
}

export interface PlannedPack {
  sku: string;
  /** Pack, model or size as the source writes it ("900 ml", "XLTZ4A", "10.00 - 20"). */
  label: string;
  /** Rupees as integer paise; null = no MRP ("price on request"). */
  mrpPaise: number | null;
  netQuantity: NetQuantity | null;
  /** `{ label, spec }`: the label is what the pack picker shows when there is no net quantity. */
  options: { label: string; spec: Record<string, string> };
  /** Set when an MRP came from a maker price list instead of catalogue-v2. */
  mrpFill: { file: string; page: number } | null;
}

export interface PlannedPhoto {
  /** Pack file name without the extension ("f003") and the byte range of the full-size WebP inside it. */
  pack: string;
  offset: number;
  length: number;
  sourceUrl: string;
  alt: string;
  altHi: string;
}

export interface PlannedProduct {
  section: Section;
  sourceId: number;
  slug: string;
  brand: { slug: string; name: string; company: string };
  range: { slug: string; name: string; nameHi: string; nameHiMachine: string } | null;
  category: { slug: string; parent: string; name: string; nameHi: string };
  name: string;
  nameHi: string;
  description: string | null;
  /** From the optional translations file; null = the admin translates it (flagged). */
  descriptionHi: string | null;
  specSummary: string;
  specSummaryHi: string;
  compatibility: string | null;
  compatibilityHi: string | null;
  highlights: string[];
  highlightsHi: string[];
  vehicleTypes: VehicleType[];
  attributes: Record<string, string | number | boolean>;
  warranty: string | null;
  hsn: string;
  gstRateBp: number;
  status: 'live' | 'draft';
  /** Why it is a draft (a code for the report), else null. */
  draftReason: 'names_only' | null;
  photo: PlannedPhoto | null;
  packs: PlannedPack[];
}

/** Why a source product is not imported (codes for the status report). */
export const SKIP_REASONS = [
  'not_price_list_brand',
  'representative_picture',
  'no_picture_bytes',
  'invalid',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** One row of the import status report: every source product, imported or not. */
export interface StatusRow {
  section: Section;
  sourceId: number;
  brand: string;
  range: string;
  name: string;
  packs: number;
  packsWithMrp: number;
  /** `file p.N; …` for MRPs filled from a price list. */
  mrpFills: string;
  status: 'imported' | 'updated' | 'unchanged' | 'skipped';
  reason: SkipReason | '';
  detail: string;
  slug: string;
}

export interface PlanReport {
  rows: StatusRow[];
  products: number;
  packs: number;
  packsWithMrp: number;
  drafts: number;
  skippedRepresentative: number;
  skippedNoPhoto: { section: string; id: number; name: string; reason: string }[];
  skippedBadPhoto: { section: string; id: number; name: string; reason: string }[];
  bySection: Record<string, { products: number; packs: number; withMrp: number }>;
  byBrand: Record<string, number>;
  /** Defaults the report lists for review (HSN/GST fallbacks and unmatched categories). */
  fallbacks: { hsn: Record<string, number>; categories: string[] };
  skuCollisions: number;
  slugCollisions: number;
  errors: { section: string; id: number; message: string }[];
}

export interface PlanInput {
  section: Section;
  products: SourceProduct[];
  /** img.json `img[]`: per picture `[[thumbPack, off, len], [fullPack, off, len]]`. */
  images: readonly (readonly [readonly [string, number, number], readonly [string, number, number]])[];
  /** English text → Hindi text (descriptions and any name you want to override). */
  translations?: ReadonlyMap<string, string>;
  /** Brand slugs to import (the price-list brands by default in the CLI); undefined = every brand. */
  brands?: ReadonlySet<string>;
}

const MAX_SKU = 64;

/** Source text without the broken `�` bytes the export left behind (`windshield�s` → `windshield's`). */
export function cleanText(text: string): string {
  return text
    .replace(/�(?=s\b)/g, "'")
    .replace(/�/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function code(text: string): string {
  return text
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `BRAND-NAME-PACK`, ≤ 64 characters; a longer one keeps its first 52 and gets 8 hex characters of its hash. */
export function skuBase(brand: string, name: string, pack: string): string {
  const nameCode = code(name);
  const brandCode = code(brand);
  const lead = nameCode === brandCode || nameCode.startsWith(`${brandCode}-`) ? '' : brandCode;
  const full = [lead, nameCode, code(pack)].filter((p) => p !== '').join('-');
  if (full.length <= MAX_SKU) return full;
  const hash = createHash('sha256').update(full).digest('hex').slice(0, 8);
  return `${full.slice(0, MAX_SKU - 9).replace(/-+$/, '')}-${hash}`;
}

/** Whole pack size in a base unit from text such as "900 ml", "3.5 L", "0.200L", "5 kg", "37 gm", "1 nos.". */
export function parseNetQuantity(text: string): NetQuantity | null {
  const m =
    /^\s*(\d+(?:[.,]\d+)?)\s*(ml|ltrs?|litres?|l|kgs?|kilograms?|gm|gms|grams?|g|nos\.?|pcs?|pieces?|pack)\b\.?\s*$/i.exec(
      text,
    );
  if (!m) return null;
  const n = Number((m[1] ?? '').replace(',', '.'));
  const unit = (m[2] ?? '').toLowerCase();
  let out: NetQuantity;
  if (unit === 'ml') out = { qty: Math.round(n), unit: 'ml' };
  else if (/^(ltrs?|litres?|l)$/.test(unit)) out = { qty: Math.round(n * 1000), unit: 'ml' };
  else if (/^(kgs?|kilograms?)$/.test(unit)) out = { qty: Math.round(n * 1000), unit: 'g' };
  else if (/^(gm|gms|grams?|g)$/.test(unit)) out = { qty: Math.round(n), unit: 'g' };
  else out = { qty: Math.round(n), unit: 'piece' };
  return isNetQuantity(out) ? out : null;
}

/** `key: value; key: value` → pairs (keys keep their case; values may hold colons). */
export function parseSpecs(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of text.split(/;\s+/)) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key !== '' && value !== '') out.push([key, value]);
  }
  return out;
}

const specOf = (specs: [string, string][], key: string): string | null =>
  specs.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ?? null;

/** The first value every pack agrees on (a product-level attribute must hold for all its packs). */
function consensus<T>(values: (T | null)[]): T | null {
  const first = values[0];
  if (first === null || first === undefined) return null;
  return values.every((v) => v === first) ? first : null;
}

const SAE_RE = /\b(0|5|10|15|20|25)\s*W\s*[-/ ]?\s*(16|20|30|40|50|60)\b/i;
const SAE = new Set(['0W20', '0W30', '5W30', '5W40', '10W30', '10W40', '15W40', '15W50', '20W40', '20W50']);

export function parseSae(text: string): string | null {
  const m = SAE_RE.exec(text);
  if (!m) return null;
  const grade = `${m[1] ?? ''}W${m[2] ?? ''}`;
  return SAE.has(grade) ? grade : null;
}

const API_CLASSES = ['SG', 'SJ', 'SL', 'SM', 'SN', 'SP', 'CF4', 'CH4', 'CI4', 'CK4'] as const;
export function parseApi(text: string): string | null {
  const t = text.toUpperCase().replace(/[-\s]/g, '');
  // Highest class named wins ("API SN/CF" → SN).
  let best: string | null = null;
  for (const c of API_CLASSES)
    if (new RegExp(`(^|[^A-Z])${c}([^A-Z0-9]|$)`).test(t.replace(/API/g, ' '))) best = c;
  return best;
}

export function parseJaso(text: string): string | null {
  const m = /JASO\s*(MA2|MA1|MA|MB)\b/i.exec(text);
  return m?.[1] ? m[1].toUpperCase() : null;
}

export function parseBaseType(text: string): string | null {
  const t = text.toLowerCase();
  if (/semi[\s-]*synth|technosynthese|part[\s-]*synth/.test(t)) return 'semi_synthetic';
  if (t.includes('synth')) return 'synthetic';
  if (t.includes('mineral')) return 'mineral';
  return null;
}

function numberOf(text: string | null): number | null {
  if (text === null) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  return m?.[1] ? Number(m[1]) : null;
}

/** Packs sorted for the page: smaller first by net quantity when known, else the source order. */
function packLabel(pack: string, specs: [string, string][]): string {
  if (pack.trim() !== '') return pack.trim();
  const fromSpec = specOf(specs, 'Packs') ?? specOf(specs, 'Pack') ?? specOf(specs, 'Model') ?? '';
  return fromSpec.trim();
}

function vehicleTypesFor(section: Section, k: string, text: string): VehicleType[] {
  const t = text.toLowerCase();
  if (section === 'lub') {
    if (k === 'Motorcycle Oil') return ['2W'];
    if (k === 'Passenger Car Motor Oils') return ['4W'];
    if (/\b(motorcycle|scooter|bike|2-wheeler|two-wheeler)\b/.test(t) || /\b[24]t\b/.test(t)) return ['2W'];
    return [];
  }
  if (section === 'bat') {
    if (k === '2-Wheeler Battery') return ['2W'];
    if (k === '3-Wheeler Battery' || k === 'E-Rickshaw Battery') return ['3W'];
    if (k === 'Car/SUV Battery') return ['4W'];
    return [];
  }
  if (section === 'tyr') {
    if (k.startsWith('Two-Wheeler')) return ['2W'];
    if (k === 'Three-Wheeler') return ['3W'];
    if (k === 'Passenger Car' || k === 'SUV/4x4' || k === 'Light Commercial') return ['4W'];
    return [];
  }
  return [];
}

interface Tax {
  hsn: string;
  gstRateBp: number;
  fallback: boolean;
}

/**
 * HSN and GST per section (ruling Q210; tyres at 18 % since GST 2.0 of 2025-09-22 — `PRODUCT_GST_RATES_BP`
 * keeps the old slabs only so nothing is ever blocked). `fallback` = no rule of its own: listed in the report.
 */
export function taxFor(section: Section, k: string, name: string): Tax {
  const n = name.toLowerCase();
  if (section === 'tyr')
    return k === 'Tubes & Flaps'
      ? { hsn: '4013', gstRateBp: 1800, fallback: false }
      : { hsn: '4011', gstRateBp: 1800, fallback: false };
  if (section === 'flt') return { hsn: '8421', gstRateBp: 1800, fallback: false };
  if (section === 'bat') {
    if (k === 'Inverter / UPS' || k === 'EV Charger' || k === 'Power Electronics')
      return { hsn: '8504', gstRateBp: 1800, fallback: true };
    if (k === 'Lubricants') return { hsn: '2710', gstRateBp: 1800, fallback: true };
    if (k === 'Brand range (names only)' || k === 'Solar' || k === 'Battery Accessories')
      return { hsn: '8507', gstRateBp: 1800, fallback: true };
    return { hsn: '8507', gstRateBp: 1800, fallback: false };
  }
  const care = (): Tax => {
    if (/polish|wax|shine|shiner|compound|restorer/.test(n))
      return { hsn: '3405', gstRateBp: 1800, fallback: false };
    if (/shampoo|clean|wash|degreaser|remover|wipe/.test(n))
      return { hsn: '3402', gstRateBp: 1800, fallback: false };
    if (/cloth|microfib|sponge|applicator/.test(n)) return { hsn: '6307', gstRateBp: 1800, fallback: false };
    if (/coat|ceramic|paint/.test(n)) return { hsn: '3208', gstRateBp: 1800, fallback: false };
    if (/grease|spray|lube|lubricant/.test(n)) return { hsn: '3403', gstRateBp: 1800, fallback: false };
    return { hsn: '3402', gstRateBp: 1800, fallback: true };
  };
  if (section === 'car') {
    if (k === 'Polishes & Waxes') return { hsn: '3405', gstRateBp: 1800, fallback: false };
    if (k === 'Cleaners & Shampoos') return { hsn: '3402', gstRateBp: 1800, fallback: false };
    if (k === 'Cloths & Accessories') return { hsn: '6307', gstRateBp: 1800, fallback: false };
    if (k === 'Coatings') return { hsn: '3208', gstRateBp: 1800, fallback: false };
    if (k === 'Greases & Lubricants' || k === 'Aerosol Sprays')
      return { hsn: '3403', gstRateBp: 1800, fallback: false };
    return care();
  }
  // lub
  if (k === 'Auto Care Products') return care();
  if (k === 'Greases') return { hsn: '3403', gstRateBp: 1800, fallback: false };
  if (k === 'Coolants') return { hsn: '3820', gstRateBp: 1800, fallback: true };
  if (k === 'Brake Fluid & Fork Oil')
    return { hsn: n.includes('fork') ? '2710' : '3819', gstRateBp: 1800, fallback: true };
  return { hsn: '2710', gstRateBp: 1800, fallback: false };
}

const NAMES_ONLY = /no product list published|^range:/i;

/** The sub-category row of a source category label (a section-scoped lookup). */
export function categoryFor(section: Section, k: string) {
  return SUB_CATEGORIES[`${section}|${k}`] ?? null;
}

/** `5W40` → `5W-40` (the form people type and the title shows); anything else unchanged. */
export function displayGrade(grade: string): string {
  const m = /^(\d+)W(\d+)$/.exec(grade);
  return (m ? normaliseViscosity(m[1] ?? '', m[2] ?? '') : null) ?? grade;
}

function highlightLines(
  section: Section,
  specs: [string, string][],
  hi: (text: string) => string,
): { en: string[]; hi: string[] } {
  const wanted =
    section === 'lub'
      ? ['grade', 'API', 'oil type', 'Application', 'Segment']
      : section === 'bat'
        ? ['Ah', 'Voltage', 'Warranty', 'Series warranty', 'CCA', 'Application']
        : section === 'tyr'
          ? ['Rim', 'Ply rating', 'Tube type', 'Construction', 'Fitment', 'Load index', 'Speed rating']
          : section === 'car'
            ? ['Type']
            : ['Application', 'Type'];
  const en: string[] = [];
  const hiLines: string[] = [];
  for (const key of wanted) {
    const value = specOf(specs, key);
    if (value === null || value.length > 100) continue;
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    en.push(`${label}: ${value}`.slice(0, 120));
    hiLines.push(`${SPEC_KEYS_HI[key.toLowerCase()] ?? hi(label)}: ${hi(value)}`.slice(0, 120));
    if (en.length === 8) break;
  }
  return { en, hi: hiLines };
}

function buildAttributes(
  section: Section,
  name: string,
  cat: string,
  specsPerPack: [string, string][][],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (section === 'lub' && cat !== 'car-care-products') {
    const grade =
      consensus(specsPerPack.map((s) => parseSae(specOf(s, 'grade') ?? specOf(s, 'Grade') ?? ''))) ??
      parseSae(name);
    if (grade) out.saeGrade = grade;
    const apiText = consensus(specsPerPack.map((s) => specOf(s, 'API') ?? specOf(s, 'Specifications') ?? ''));
    const api = parseApi(apiText ?? '') ?? parseApi(name);
    if (api) out.apiClass = api;
    const jaso =
      parseJaso(name) ??
      consensus(
        specsPerPack.map(
          (s) => parseJaso(specOf(s, 'Specifications') ?? '') ?? parseJaso(s.map(([k]) => k).join(' ')),
        ),
      );
    if (jaso) out.jasoClass = jaso;
    const base = consensus(
      specsPerPack.map((s) => parseBaseType(specOf(s, 'oil type') ?? specOf(s, 'Oil type') ?? '')),
    );
    if (base) out.baseType = base;
  }
  if (section === 'bat') {
    const volts = consensus(specsPerPack.map((s) => numberOf(specOf(s, 'Voltage'))));
    if (volts !== null && Number.isInteger(volts) && volts >= 2 && volts <= 48) out.voltage = volts;
    const ah = consensus(specsPerPack.map((s) => numberOf(specOf(s, 'Ah'))));
    if (ah !== null && ah >= 0.5 && ah <= 300 && Math.abs(ah * 10 - Math.round(ah * 10)) < 1e-9)
      out.capacityAh = ah;
    const warranty = consensus(
      specsPerPack.map((s) => specOf(s, 'Warranty') ?? specOf(s, 'Series warranty')),
    );
    const fp = warranty === null ? null : /(\d+)\s*F\s*\+\s*(\d+)\s*P/i.exec(warranty);
    if (fp?.[1] && fp[2]) {
      out.freeReplacementMonths = Number(fp[1]);
      out.proRataMonths = Number(fp[2]);
    }
    const tech =
      `${name} ${consensus(specsPerPack.map((s) => specOf(s, 'Technology') ?? '')) ?? ''}`.toLowerCase();
    if (/lithium|lfp|li-ion/.test(tech)) out.batteryType = 'lithium';
    else if (tech.includes('agm')) out.batteryType = 'agm';
    else if (/vrla|maintenance[\s-]*free/.test(tech)) out.batteryType = 'vrla';
  }
  if (section === 'tyr') {
    const tt = consensus(specsPerPack.map((s) => specOf(s, 'Tube type')));
    if (tt !== null) out.tubeless = /^tubeless$/i.test(tt);
    const li = consensus(specsPerPack.map((s) => numberOf(specOf(s, 'Load index'))));
    if (li !== null && Number.isInteger(li) && li >= 20 && li <= 150) out.loadIndex = li;
    const pos = consensus(specsPerPack.map((s) => (specOf(s, 'Position') ?? '').toLowerCase()));
    if (pos === 'front' || pos === 'rear') out.position = pos;
  }
  return out;
}

/** "Brand Name" without saying the brand twice when the name already starts with it. */
function withBrand(brand: string, name: string): string {
  return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
}

function clampDescription(text: string): string {
  if (text.length <= 4000) return text;
  const cut = text.slice(0, 4000);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return end > 2000 ? cut.slice(0, end + 1) : cut;
}

function packRange(packs: PlannedPack[]): { en: string; hi: string } {
  const n = packs.length;
  const qs = packs
    .map((p) => p.netQuantity)
    .filter((q): q is NetQuantity => q !== null && q.unit !== 'piece');
  if (qs.length === n && n > 0 && new Set(qs.map((q) => q.unit)).size === 1) {
    const unit = qs[0]?.unit ?? 'ml';
    const min = Math.min(...qs.map((q) => q.qty));
    const max = Math.max(...qs.map((q) => q.qty));
    const fmt = (v: number) =>
      unit === 'ml'
        ? v >= 1000
          ? `${String(v / 1000)} L`
          : `${String(v)} ml`
        : v >= 1000
          ? `${String(v / 1000)} kg`
          : `${String(v)} g`;
    const text = min === max ? fmt(min) : `${fmt(min)} - ${fmt(max)}`;
    return { en: text, hi: text };
  }
  return { en: `${String(n)} ${n === 1 ? 'size' : 'sizes'}`, hi: `${String(n)} साइज़` };
}

/** Build the plan of one section. Pure and deterministic: same input, same slugs, SKUs and order. */
export interface PlanState {
  slugs: Map<string, number>;
  skus: Map<string, number>;
  rangeSlugs: Map<string, string>;
}
export const newPlanState = (): PlanState => ({ slugs: new Map(), skus: new Map(), rangeSlugs: new Map() });

export function planSection(
  input: PlanInput,
  report?: PlanReport,
  state: PlanState = newPlanState(),
): PlannedProduct[] {
  const { section } = input;
  const out: PlannedProduct[] = [];
  const { slugs, skus, rangeSlugs } = state;
  const rep: PlanReport = report ?? emptyReport();
  const sorted = [...input.products].sort((a, b) => a.id - b.id);
  for (const src of sorted) {
    const row: StatusRow = {
      section,
      sourceId: src.id,
      brand: src.b,
      range: src.s,
      name: cleanText(src.n),
      packs: src.v.length,
      packsWithMrp: src.v.filter((v) => /^\d+(\.\d{1,2})?$/.test(v[1].trim())).length,
      mrpFills: '',
      status: 'skipped',
      reason: '',
      detail: '',
      slug: '',
    };
    rep.rows.push(row);
    if (input.brands && !input.brands.has(slugify(src.b))) {
      row.reason = 'not_price_list_brand';
      continue;
    }
    if (src.r) {
      rep.skippedRepresentative += 1;
      row.reason = 'representative_picture';
      continue;
    }
    const missing = pictureProblem(src, input.images);
    if (missing) {
      rep.skippedNoPhoto.push({ section, id: src.id, name: src.n, reason: missing });
      row.reason = 'no_picture_bytes';
      row.detail = missing;
      continue;
    }
    try {
      const planned = planProduct(src, input, slugs, skus, rangeSlugs, rep);
      if (planned) {
        out.push(planned);
        row.status = 'imported';
        row.slug = planned.slug;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rep.errors.push({ section, id: src.id, message });
      row.reason = 'invalid';
      row.detail = message;
    }
  }
  return out;
}

/** Why a product has no usable picture entry (checked before anything else is planned), else null. */
export function pictureProblem(src: SourceProduct, images: PlanInput['images']): string | null {
  if (src.i === null) return 'NO_IMAGE_INDEX';
  const picture = images[src.i];
  if (!picture) return 'NO_IMAGE_ENTRY';
  const [pack, offset, length] = picture[1];
  if (!pack || !(length > 0) || !(offset >= 0)) return 'EMPTY_PICTURE';
  return null;
}

export function emptyReport(): PlanReport {
  return {
    rows: [],
    products: 0,
    packs: 0,
    packsWithMrp: 0,
    drafts: 0,
    skippedRepresentative: 0,
    skippedNoPhoto: [],
    skippedBadPhoto: [],
    bySection: {},
    byBrand: {},
    fallbacks: { hsn: {}, categories: [] },
    skuCollisions: 0,
    slugCollisions: 0,
    errors: [],
  };
}

function planProduct(
  src: SourceProduct,
  input: PlanInput,
  slugs: Map<string, number>,
  skus: Map<string, number>,
  rangeSlugs: Map<string, string>,
  rep: PlanReport,
): PlannedProduct | null {
  const { section } = input;
  const cat = categoryFor(section, src.k);
  if (!cat) {
    if (!rep.fallbacks.categories.includes(`${section}|${src.k}`))
      rep.fallbacks.categories.push(`${section}|${src.k}`);
    throw new Error(`No sub-category for "${src.k}"`);
  }
  const brandName = src.b.trim();
  const brandSlug = slugify(brandName);
  const name = cleanText(src.n);
  if (brandSlug === '' || name.length < 3) throw new Error('Missing brand or name');

  const baseSlug = productSlug(brandName, name);
  let slug = baseSlug;
  if (slugs.has(slug)) {
    rep.slugCollisions += 1;
    const withRange = src.s ? slugify(`${baseSlug}-${src.s}`) : '';
    if (withRange !== '' && !slugs.has(withRange)) slug = withRange;
    else {
      let n = 2;
      while (slugs.has(`${baseSlug}-${String(n)}`)) n += 1;
      slug = `${baseSlug}-${String(n)}`;
    }
  }
  slugs.set(slug, 1);

  const specsPerPack = src.v.map(([, , specText]) => parseSpecs(specText));
  const packs: PlannedPack[] = src.v.map((v, idx) => {
    const specs = specsPerPack[idx] ?? [];
    const label = packLabel(v[0], specs);
    const base = skuBase(brandName, name, label === '' ? 'STD' : label);
    const n = (skus.get(base) ?? 0) + 1;
    skus.set(base, n);
    if (n > 1) rep.skuCollisions += 1;
    const sku = n === 1 ? base : `${base.slice(0, MAX_SKU - String(n).length - 1)}-${String(n)}`;
    const net =
      parseNetQuantity(label) ??
      (section === 'bat' || section === 'tyr' || section === 'flt'
        ? { qty: 1, unit: 'piece' as const }
        : null);
    const rupees = v[1].trim();
    const mrpPaise = /^\d+(\.\d{1,2})?$/.test(rupees) ? Math.round(Number(rupees) * 100) : null;
    return {
      sku,
      label,
      mrpPaise,
      netQuantity: net,
      options: {
        label,
        spec: Object.fromEntries(specs.slice(0, 20).map(([k, val]) => [k, val.slice(0, 160)])),
      },
      mrpFill: null,
    };
  });
  if (packs.length === 0) throw new Error('No packs');

  const text = `${name} ${src.k} ${src.s}`;
  const namesOnly =
    src.v.every(([p, , s]) => p.trim() === '' && NAMES_ONLY.test(s.trim())) ||
    src.k === 'Brand range (names only)' ||
    src.v.every(([, , s]) => /no product list published/i.test(s));
  const tax = taxFor(section, src.k, name);
  if (tax.fallback)
    rep.fallbacks.hsn[`${src.k} -> ${tax.hsn}`] = (rep.fallbacks.hsn[`${src.k} -> ${tax.hsn}`] ?? 0) + 1;
  const attributes = buildAttributes(section, name, cat.slug, specsPerPack);
  // Hindi: the translations file first (names, ranges, highlight values, fitment), then the glossary.
  const hi = (text: string) => input.translations?.get(text) ?? hindiFromGlossary(text);
  const range = src.s.trim() === '' ? null : rangeFor(brandSlug, brandName, src.s, rangeSlugs, hi);
  const highlights = highlightLines(section, specsPerPack[0] ?? [], hi);
  const apps = consensus(specsPerPack.map((s) => specOf(s, 'Application')));
  const compat = apps !== null && (section === 'flt' || section === 'bat') ? apps.slice(0, 300) : null;
  const range_ = packRange(packs);
  const attrBits = [
    typeof attributes.saeGrade === 'string' ? displayGrade(attributes.saeGrade) : attributes.saeGrade,
    attributes.capacityAh === undefined ? undefined : `${String(attributes.capacityAh)} Ah`,
  ].filter((x): x is string => typeof x === 'string');
  const warranty =
    section === 'bat' ? (consensus(specsPerPack.map((s) => specOf(s, 'Warranty'))) ?? null) : null;
  const description = cleanText(src.d) === '' ? null : clampDescription(cleanText(src.d));
  const nameHi = input.translations?.get(name) ?? hindiFromGlossary(name);
  const picture = src.i === null ? undefined : input.images[src.i];
  const photo: PlannedPhoto | null = picture
    ? {
        pack: picture[1][0],
        offset: picture[1][1],
        length: picture[1][2],
        sourceUrl: (src.iu || src.u).slice(0, 500),
        alt: withBrand(brandName, name).slice(0, 160),
        altHi: withBrand(brandName, nameHi).slice(0, 160),
      }
    : null;

  return {
    section,
    sourceId: src.id,
    slug,
    brand: { slug: brandSlug, name: brandName, company: src.co },
    range,
    category: cat,
    name,
    nameHi,
    description,
    descriptionHi: description === null ? null : (input.translations?.get(description) ?? null),
    specSummary: [cat.name, ...attrBits, range_.en].join(' · ').slice(0, 200),
    specSummaryHi: [cat.nameHi, ...attrBits, range_.hi].join(' · ').slice(0, 200),
    compatibility: compat,
    compatibilityHi: compat === null ? null : hi(compat),
    highlights: highlights.en,
    highlightsHi: highlights.hi,
    vehicleTypes: vehicleTypesFor(section, src.k, text),
    attributes,
    warranty,
    hsn: tax.hsn,
    gstRateBp: tax.gstRateBp,
    status: namesOnly ? 'draft' : 'live',
    draftReason: namesOnly ? 'names_only' : null,
    photo,
    packs,
  };
}

function rangeFor(
  brandSlug: string,
  brandName: string,
  s: string,
  seen: Map<string, string>,
  hi: (text: string) => string,
): { slug: string; name: string; nameHi: string; nameHiMachine: string } {
  const name = cleanText(s).slice(0, 120);
  const joined = slugify(`${brandSlug}-${name}`);
  const slug = joined.replace(new RegExp(`^${brandSlug}-${brandSlug}(-|$)`), `${brandSlug}$1`).slice(0, 120);
  seen.set(slug, brandName);
  // `nameHiMachine` is what an import without a translations file writes: a stored Hindi name that still equals it
  // was never edited by the admin, so a later import may replace it with the reviewed translation.
  return { slug, name, nameHi: hi(name), nameHiMachine: hindiFromGlossary(name) };
}

/** Totals for the dry-run report. */
export function summarise(products: PlannedProduct[], report: PlanReport): PlanReport {
  report.products = products.length;
  for (const p of products) {
    const sec = (report.bySection[p.section] ??= { products: 0, packs: 0, withMrp: 0 });
    sec.products += 1;
    sec.packs += p.packs.length;
    const withMrp = p.packs.filter((k) => k.mrpPaise !== null).length;
    sec.withMrp += withMrp;
    report.packs += p.packs.length;
    report.packsWithMrp += withMrp;
    report.byBrand[p.brand.name] = (report.byBrand[p.brand.name] ?? 0) + 1;
    if (p.status === 'draft') report.drafts += 1;
  }
  return report;
}
