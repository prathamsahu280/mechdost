import { hindiLeftovers } from '@mechdost/shared/catalogue-hindi';
import type { NetQuantity } from '@mechdost/shared/product-attributes';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { SUB_CATEGORIES } from '../catalogue-v2/glossary';

/**
 * What a battery brand's source files plan to become in the database (Exide and Amaron importers, user 2026-11-23).
 * The planner of each brand is pure (no I/O) and returns a `BatteryPlan`; `repo/battery-import.ts` writes it.
 */
export interface PlannedCategory {
  slug: string;
  /** Top-level category it sits under; null = top-level itself (`home-power`). */
  parent: string | null;
  name: string;
  nameHi: string;
  /** Shown on the category page and editable by admin; the tyre importers fill them (2026-11-24). */
  description?: string;
  descriptionHi?: string;
}

export const HOME_POWER = {
  slug: 'home-power',
  name: 'Inverters & home UPS',
  nameHi: 'इन्वर्टर और होम UPS',
} as const;

/** Amaron's "Earth moving equipment battery" has no sub-category in catalogue-v2: the import creates this one. */
export const EARTH_MOVING_CATEGORY: PlannedCategory = {
  slug: 'earth-moving-batteries',
  parent: 'batteries',
  name: 'Earth-moving & construction equipment batteries',
  nameHi: 'अर्थ-मूविंग और कंस्ट्रक्शन मशीन बैटरी',
};

/** Tata Green's sealed 12 V industrial batteries (TGI) fit none of the existing sub-categories: the import creates this one (2026-11-24). */
export const INDUSTRIAL_CATEGORY: PlannedCategory = {
  slug: 'industrial-batteries',
  parent: 'batteries',
  name: 'Industrial batteries',
  nameHi: 'औद्योगिक बैटरी',
};

/** `bat|…` key of a catalogue-v2 sub-category, 'home' for the home-power category, or a category of its own. */
export type CategoryRef = string | PlannedCategory;

export function categoryFor(ref: CategoryRef): PlannedCategory {
  if (typeof ref !== 'string') return ref;
  if (ref === 'home') return { ...HOME_POWER, parent: null };
  const sub = SUB_CATEGORIES[ref];
  if (!sub) throw new Error(`No sub-category for ${ref}`);
  return { slug: sub.slug, parent: sub.parent, name: sub.name, nameHi: sub.nameHi };
}

/** A manufacturer part number (kind `mfr`) with its normalised form (upper-case letters and digits only). */
export function mfrPart(value: string): { kind: 'mfr'; value: string; normalised: string } {
  return { kind: 'mfr', value, normalised: value.toUpperCase().replace(/[^A-Z0-9]/g, '') };
}

export interface PlannedPhoto {
  /** Path relative to the source folder. */
  file: string;
  sourceUrl: string;
  alt: string;
  altHi: string;
}

/** One sellable pack of a planned product (a battery model, or one tyre size of a pattern). */
export interface PlannedVariant {
  sku: string;
  model: string;
  /** Paise incl. GST; null = price on request. */
  mrpPaise: number | null;
  weightG: number | null;
  netQuantity: NetQuantity;
  options: Record<string, string>;
  /** EAN / GTIN as the maker prints it; null = none. */
  barcode: string | null;
  /** Manufacturer part numbers (kind `mfr`) of this pack. */
  partNumbers: { kind: 'mfr'; value: string; normalised: string }[];
}

export interface PlannedProduct {
  /** 1-based row of the batteries CSV (header excluded). */
  sourceRow: number;
  productType: string;
  slug: string;
  range: { slug: string; name: string; nameHi: string };
  category: PlannedCategory;
  name: string;
  nameHi: string;
  description: string;
  descriptionHi: string;
  specSummary: string;
  specSummaryHi: string;
  compatibility: string | null;
  compatibilityHi: string | null;
  highlights: string[];
  highlightsHi: string[];
  vehicleTypes: VehicleType[];
  spec: Record<string, unknown>;
  warranty: string | null;
  hsn: string;
  gstRateBp: number;
  status: 'live' | 'draft';
  /**
   * Every sellable pack of the product, in listing order (a battery model has one; a tyre pattern one per size, user
   * 2026-11-24). The writer reads only `variants`.
   */
  variants: PlannedVariant[];
  /** The first of `variants` (single-pack brands read it directly). */
  variant: PlannedVariant;
  /** Manufacturer part numbers (kind `mfr`) of the first pack. */
  partNumbers: { kind: 'mfr'; value: string; normalised: string }[];
  /** The first of `partNumbers` (the model code). */
  partNumber: { kind: 'mfr'; value: string; normalised: string };
  /** In gallery order; the first is the main photo. Empty = no picture (the product is planned as a draft). */
  photos: PlannedPhoto[];
  /** The main photo (`photos[0]`). */
  photo: PlannedPhoto | null;
  fitmentCount: number;
}

export interface ReportRow {
  sourceRow: number;
  productType: string;
  range: string;
  model: string;
  name: string;
  slug: string;
  sku: string;
  category: string;
  /** Rupees incl. GST, or '' = price on request. */
  mrpRupees: string;
  warrantyMonths: string;
  fitmentCount: number;
  photoFile: string;
  /** `model` = the product's own photo; `range` = a picture shared with other products (generic). */
  photoKind: 'model' | 'range';
  status: string;
}

export interface BatteryPlan {
  products: PlannedProduct[];
  rows: ReportRow[];
  /** Feature lines with no Hindi entry (left out of the Hindi text); the unit test requires none. */
  untranslated: string[];
  /** Lower-case words of vehicle makes and models: Latin by rule 10 ("brand and model names"). */
  vehicleWords: ReadonlySet<string>;
  slugCollisions: number;
  skuCollisions: number;
  /** Fitment rows whose battery is not in the battery list. */
  orphanFitment: number;
}

/**
 * Hindi texts of the plan that still hold English words (hard rule 10). Vehicle makes and models are brand and model
 * names, so the words of the fitment list may stay in Latin script.
 */
export function planHindiLeftovers(plan: BatteryPlan): { slug: string; field: string; words: string[] }[] {
  const out: { slug: string; field: string; words: string[] }[] = [];
  for (const p of plan.products) {
    const fields: [string, string | null][] = [
      ['name_hi', p.nameHi],
      ['range.name_hi', p.range.nameHi],
      ['category.name_hi', p.category.nameHi],
      ['spec_summary_hi', p.specSummaryHi],
      ['compatibility_hi', p.compatibilityHi],
      ['description_hi', p.descriptionHi],
      ...p.photos.map((ph): [string, string] => ['photo.alt_hi', ph.altHi]),
      ...p.highlightsHi.map((h): [string, string] => ['highlights_hi', h]),
    ];
    for (const [field, text] of fields) {
      if (text === null) continue;
      const words = hindiLeftovers(text).filter((w) => !plan.vehicleWords.has(w.toLowerCase()));
      if (words.length > 0) out.push({ slug: p.slug, field, words });
    }
  }
  return out;
}

/** The parts of one battery row's text every planner builds the same way. */
export interface Fact {
  key: string;
  labelEn: string;
  labelHi: string;
  valueEn: string;
  valueHi: string;
}

/** Highlights (max 8, same count in both languages): the leading facts, then the feature lines. */
export function highlightsOf(
  facts: readonly Fact[],
  order: readonly string[],
  featsEn: readonly string[],
  featsHi: readonly string[],
  extra: readonly [string, string][] = [],
): { highlights: string[]; highlightsHi: string[] } {
  const hl: [string, string][] = [];
  for (const key of order) {
    const f = facts.find((x) => x.key === key);
    if (f) hl.push([`${f.labelEn}: ${f.valueEn}`, `${f.labelHi}: ${f.valueHi}`]);
  }
  hl.push(...extra);
  featsEn.forEach((en, i) => hl.push([en, featsHi[i] ?? en]));
  return { highlights: hl.slice(0, 8).map((h) => h[0]), highlightsHi: hl.slice(0, 8).map((h) => h[1]) };
}
