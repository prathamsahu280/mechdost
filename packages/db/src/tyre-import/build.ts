import { slugify } from '@mechdost/shared/catalogue-import';
import {
  highlightsOf,
  mfrPart,
  norm,
  titleVehicle,
  type BatteryPlan,
  type Fact,
  type PlannedCategory,
  type PlannedPhoto,
  type PlannedProduct,
  type PlannedVariant,
  type ReportRow,
} from '../battery-import';
import {
  CONSTRUCTION_EN,
  CONSTRUCTION_HI,
  hindiName,
  POSITION_EN,
  POSITION_HI,
  TUBE_WORDS_HI,
  TYRE_WORDS_HI,
} from './hindi';
import { KINDS, TYRE_CATEGORIES, type TyreKind } from './kinds';
import { attributeSize } from './text';

/** One tyre fitment line of `spec.fitment` (hidden from public payloads like the battery fitment). */
export interface TyreFitment {
  /** `car`, `motorcycle`, `scooter` (CEAT) or `car_suv`, `two_wheeler` (MRF's own vehicle type). */
  vehicleType: string;
  make: string;
  model: string;
  variant: string | null;
  /** As the maker writes them ("2022-2025", "2020 ONWARDS"). */
  years: string | null;
  option: 'recommended' | 'other' | 'upsize' | null;
  position: 'front' | 'rear' | null;
}

/** A tyre row of either brand, already read out of its CSV: what the shared builder needs. */
export interface TyreRow {
  sourceRow: number;
  brand: { name: string; label: string };
  kind: TyreKind;
  /** The source's product type text (report). */
  listedType: string;
  /** Name in title case, size and codes exact. */
  name: string;
  nameHi: string;
  /** Pattern in title case ("Milaze X3"). */
  pattern: string;
  sizeText: string;
  /** Source SKU (CEAT) or null (MRF has none: the SKU is made from the name). */
  sourceSku: string | null;
  partNumber: string;
  mrpPaise: number | null;
  widthMm: number | null;
  aspectPct: number | null;
  rimInch: number | null;
  construction: 'radial' | 'bias' | null;
  loadIndex: string | null;
  speedRating: string | null;
  plyRating: number | null;
  tubeless: boolean | null;
  tubeIncluded: boolean | null;
  position: 'front' | 'rear' | 'both' | null;
  features: { en: string; hi: string }[];
  tagline: { en: string; hi: string } | null;
  /** Extra facts shown after the common ones (CEAT truck: diameter, tread depth, usage). */
  extraFacts: Fact[];
  /** Extra spec keys (`ceatPrice`, `sourceChecks`, …). */
  extraSpec: Record<string, unknown>;
  photos: PlannedPhoto[];
  fitment: TyreFitment[];
  productPage: string;
  /** EAN / GTIN of this size as the maker prints it (Apollo), else null. */
  barcode?: string | null;
  /** Pattern pictures shared by every size of the pattern. */
  sharedPhotos: boolean;
  /** The maker's page has no picture at all (the product is planned as a draft). */
  noPhotoOnSite: boolean;
}

export interface TyreCheck {
  slug: string;
  name: string;
  /** What was found in the source and how the import handled it. */
  note: string;
}

export interface TyrePlan extends BatteryPlan {
  noPhoto: { slug: string; name: string; reason: 'no_file' | 'no_photo_on_site' }[];
  checks: TyreCheck[];
  /** Sizes with no MRP, for the report (the product slug, the size's tyre name and SKU). */
  priceOnRequest: { slug: string; name: string; sku: string; siteDataPaise: number | null }[];
}

const GST_RATE_BP = 1800;

function titleVehicleWords(into: Set<string>, text: string): void {
  for (const w of titleVehicle(text).match(/[A-Za-z]{3,}/g) ?? []) into.add(w.toLowerCase());
}

/** "Make Model" labels of a fitment list, once each, as the searchable text ("…, and N more"). */
export function tyreCompatibility(fit: readonly TyreFitment[]): { en: string | null; hi: string | null } {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const f of fit) {
    const label = `${titleVehicle(f.make)} ${titleVehicle(f.model)}`.trim();
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  if (labels.length === 0) return { en: null, hi: null };
  const cap = 40;
  const head = labels.slice(0, cap).join(', ');
  const more = labels.length - cap;
  return {
    en: more > 0 ? `${head} and ${String(more)} more` : head,
    hi: more > 0 ? `${head} और ${String(more)} अन्य` : head,
  };
}

/** Words of a plan's Latin-script names: makes, models and the pattern names (Latin by rule 10). */
export function latinWordsOf(rows: readonly TyreRow[]): Set<string> {
  const words = new Set<string>();
  for (const r of rows) {
    for (const w of `${r.pattern} ${r.nameHi}`.match(/[A-Za-z]{3,}/g) ?? []) words.add(w.toLowerCase());
    for (const f of r.fitment) {
      titleVehicleWords(words, f.make);
      titleVehicleWords(words, f.model);
    }
  }
  return words;
}

/** The name of a pattern product ("CEAT Milaze X3"): brand plus pattern. */
export function tyrePatternName(brandName: string, pattern: string): string {
  return `${brandName} ${pattern}`.trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The size label of a variant: the maker's tyre name without the brand and the pattern ("CEAT Milaze X3 145/70R12 69T TL"
 * -> "145/70R12 69T TL"; "MRF 165D14 Savari N8 TT" -> "165D14 N8 TT"). Falls back to the size text.
 */
export function tyreSizeLabel(name: string, brandName: string, pattern: string, sizeText: string): string {
  let rest = name.trim().replace(new RegExp(`^${escapeRe(brandName)}\\s+`, 'i'), '');
  if (pattern !== '') rest = rest.replace(new RegExp(`(^|\\s)${escapeRe(pattern)}(?=\\s|$)`, 'i'), '$1');
  rest = rest.replace(/\s+/g, ' ').trim();
  return rest === '' ? sizeText : rest;
}

/** Patterns the site spells differently ("Steel MUSCLE-S1M4", "Steel Muscle S1M4"; "Shakti 3", "Shakti-3") are one pattern; "M+" stays apart from "M". */
const patternKey = (pattern: string) =>
  pattern
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');

/** URL slug of a product name ("+" is kept as "plus"). */
const slugOfName = (name: string) => slugify(name.replace(/\+/g, ' plus '));

const nullsLast = (n: number | null) => n ?? Number.POSITIVE_INFINITY;

/** The value every item shares, or undefined when they differ (or there is none). */
function uniform<T>(items: readonly T[]): T | undefined {
  const first = items[0];
  return first !== undefined && items.every((x) => x === first) ? first : undefined;
}

/** The options of a size variant (all strings, empty ones left out): what the size picker and compare read. */
function sizeOptions(r: TyreRow, label: string): Record<string, string> {
  const o: Record<string, string> = { size: label };
  if (r.loadIndex !== null) o.loadIndex = r.loadIndex;
  if (r.speedRating !== null) o.speedRating = r.speedRating;
  if (r.construction !== null) o.construction = r.construction;
  if (r.tubeless !== null) o.tlTt = r.tubeless ? 'TL' : 'TT';
  if (r.plyRating !== null) o.ply = String(r.plyRating);
  if (r.position === 'front' || r.position === 'rear' || r.position === 'both') o.frontRear = r.position;
  return o;
}

/** The typed data of one size (spec per SKU, under `spec.variantSpecs`). */
function sizeSpec(r: TyreRow): Record<string, unknown> {
  const spec: Record<string, unknown> = { model: r.sizeText, listedProductType: r.listedType };
  const put = (key: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') spec[key] = value;
  };
  put('productPage', r.productPage);
  put('sourceProductId', r.sourceSku);
  put('size', attributeSize(r.sizeText));
  // Metric sizes (with an aspect ratio) give the width in mm; "10.00-20" and "165D14" give a section width in inches.
  put(r.aspectPct === null ? 'sectionWidthInch' : 'widthMm', r.widthMm);
  put('aspectRatioPct', r.aspectPct);
  put('rimInch', r.rimInch);
  put('construction', r.construction);
  put('loadIndexText', r.loadIndex);
  const loadN = r.loadIndex !== null && /^\d+$/.test(r.loadIndex) ? Number(r.loadIndex) : null;
  put('loadIndex', loadN !== null && loadN >= 20 && loadN <= 150 ? loadN : null);
  put('speedSymbol', r.speedRating);
  put('plyRating', r.plyRating);
  put('tubeless', r.tubeless);
  put('tubeIncluded', r.tubeIncluded);
  put('position', r.position);
  put('finderVehicles', r.fitment.length > 0 ? r.fitment.length : null);
  put('barcode', r.barcode ?? null);
  for (const [k, v] of Object.entries(r.extraSpec)) put(k, v);
  if (r.fitment.length > 0) spec.fitment = r.fitment;
  return spec;
}

/**
 * The shared planner of the tyre importers (CEAT, MRF, Apollo): rows -> products, report rows and the checks. One product
 * per tread pattern (and kind), each size a variant with its own SKU, MRP (or price on request), barcode and typed data
 * (user 2026-11-24, like one item listed in 500 ml and 1 L). Pattern data is on the product; size data (load, speed,
 * ply, tubeless, position, fitment, hidden maker price) is under `spec.variantSpecs[sku]`, private like the fitment.
 */
export function planTyreRows(
  rows: readonly TyreRow[],
  opts: {
    source: 'ceat' | 'mrf' | 'apollo';
    skuPrefix: string;
    checks: TyreCheck[];
    extraWords?: ReadonlySet<string>;
    untranslated?: string[];
    orphanFitment?: number;
  },
): TyrePlan {
  const slugs = new Set<string>();
  const skus = new Set<string>();
  const products: PlannedProduct[] = [];
  const reportRows: ReportRow[] = [];
  const noPhoto: TyrePlan['noPhoto'] = [];
  const priceOnRequest: TyrePlan['priceOnRequest'] = [];
  const checks = [...opts.checks];
  const slugOfRowName = new Map<string, string>();
  let slugCollisions = 0;
  let skuCollisions = 0;

  // Group the sizes by brand, kind and pattern (kinds are never mixed in one product).
  const groups = new Map<string, TyreRow[]>();
  for (const r of rows) {
    const key = `${r.brand.name}|${r.kind}|${patternKey(r.pattern)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const baseNameCount = new Map<string, number>();
  for (const g of groups.values()) {
    const first = g[0];
    if (!first) continue;
    const base = slugOfName(tyrePatternName(first.brand.name, first.pattern));
    baseNameCount.set(base, (baseNameCount.get(base) ?? 0) + 1);
  }

  for (const group of groups.values()) {
    const rep = group[0];
    if (!rep) continue;
    const info = KINDS[rep.kind];
    const category: PlannedCategory = TYRE_CATEGORIES[rep.kind];
    const baseName = tyrePatternName(rep.brand.name, rep.pattern);
    const split = (baseNameCount.get(slugOfName(baseName)) ?? 0) > 1;
    const name = split ? `${baseName} (${info.en})` : baseName;
    const nameHi = `${hindiTyreName(baseName, rep.kind)}${split ? ` (${info.hi})` : ''}`;
    let slug = slugOfName(name);
    if (slugs.has(slug)) {
      slugCollisions += 1;
      let n = 2;
      while (slugs.has(`${slug}-${String(n)}`)) n += 1;
      slug = `${slug}-${String(n)}`;
    }
    slugs.add(slug);

    // Sizes in listing order: rim, width, aspect, then the label.
    const sized = group
      .map((r) => ({
        r,
        label: tyreSizeLabel(r.name, r.brand.name, r.pattern, r.sizeText),
      }))
      .sort(
        (a, b) =>
          nullsLast(a.r.rimInch) - nullsLast(b.r.rimInch) ||
          nullsLast(a.r.widthMm) - nullsLast(b.r.widthMm) ||
          nullsLast(a.r.aspectPct) - nullsLast(b.r.aspectPct) ||
          (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
      );
    const variants: PlannedVariant[] = [];
    const variantSpecs: Record<string, Record<string, unknown>> = {};
    const labels = new Set<string>();
    for (const { r, label: rawLabel } of sized) {
      const withoutBrand = r.name.replace(new RegExp(`^${escapeRe(r.brand.name)}\\s+`, 'i'), '');
      let sku = `${opts.skuPrefix}-${r.sourceSku ?? norm(withoutBrand)}`;
      if (skus.has(sku)) {
        skuCollisions += 1;
        sku = `${sku}-${String(r.sourceRow)}`;
      }
      skus.add(sku);
      let label = rawLabel;
      if (labels.has(label)) label = `${label} (${r.sourceSku ?? `row ${String(r.sourceRow)}`})`;
      labels.add(label);
      const part = mfrPart(r.partNumber);
      variants.push({
        sku,
        model: label,
        mrpPaise: r.mrpPaise,
        weightG: null,
        netQuantity: { qty: 1, unit: 'piece' },
        options: sizeOptions(r, label),
        barcode: r.barcode ?? null,
        partNumbers: part.normalised === '' ? [] : [part],
      });
      variantSpecs[sku] = sizeSpec(r);
      slugOfRowName.set(r.name, slug);
      if (r.mrpPaise === null) {
        const site =
          (r.extraSpec.ceatPrice as { siteData?: { paise?: number } } | undefined)?.siteData?.paise ?? null;
        priceOnRequest.push({ slug, name: r.name, sku, siteDataPaise: site });
      }
    }
    const members = sized.map((s) => s.r);
    const first = variants[0] as PlannedVariant;

    // Pattern-level facts: only what every size shares.
    const n = members.length;
    const facts: Fact[] = [];
    const fact = (key: string, labelEn: string, labelHi: string, valueEn: string, valueHi = valueEn) =>
      facts.push({ key, labelEn, labelHi, valueEn, valueHi });
    fact('sizes', 'Sizes available', 'उपलब्ध साइज़', String(n));
    const construction = uniform(members.map((r) => r.construction));
    if (construction)
      fact(
        'construction',
        'Construction',
        'बनावट',
        CONSTRUCTION_EN[construction] ?? construction,
        CONSTRUCTION_HI[construction] ?? construction,
      );
    const isTube = rep.kind === 'tube' || rep.kind === 'flap';
    const tubeless = isTube ? undefined : uniform(members.map((r) => r.tubeless));
    if (tubeless !== undefined && tubeless !== null)
      fact(
        'tubeType',
        'Tyre type',
        'टायर का प्रकार',
        tubeless ? 'Tubeless (TL)' : 'Tube type (TT)',
        tubeless ? 'ट्यूबलेस (TL)' : 'ट्यूब टाइप (TT)',
      );
    const tubeIncluded = isTube ? undefined : uniform(members.map((r) => r.tubeIncluded));
    if (tubeIncluded) fact('tube', 'Tube', 'ट्यूब', 'Included with the tyre', 'टायर के साथ शामिल');
    const position = uniform(members.map((r) => r.position));
    if (position)
      fact(
        'position',
        'Fitment position',
        'लगाने की जगह',
        POSITION_EN[position] ?? position,
        POSITION_HI[position] ?? position,
      );

    const sizeWordEn = n === 1 ? 'size' : 'sizes';
    const sumEn: string[] = [`${String(n)} ${sizeWordEn}`];
    const sumHi: string[] = [`${String(n)} साइज़`];
    for (const key of ['construction', 'tubeType']) {
      const f = facts.find((x) => x.key === key);
      if (f) {
        sumEn.push(f.valueEn);
        sumHi.push(f.valueHi);
      }
    }
    const specSummary = sumEn.join(' · ');
    const specSummaryHi = sumHi.join(' · ');

    const features: { en: string; hi: string }[] = [];
    for (const r of members)
      for (const f of r.features) if (!features.some((x) => x.en === f.en)) features.push(f);
    const { highlights, highlightsHi } = highlightsOf(
      facts,
      ['sizes', 'construction', 'tubeType', 'position'],
      features.map((f) => f.en),
      features.map((f) => f.hi),
    );

    const tagline = members.find((r) => r.tagline)?.tagline ?? null;
    const descEn: string[] = [`${name}: ${info.en} by ${rep.brand.label}.`];
    const descHi: string[] = [`${nameHi}: ${rep.brand.label} का ${info.hi}।`];
    if (tagline) {
      descEn.push(tagline.en);
      descHi.push(tagline.hi);
    }
    descEn.push(`Specifications: ${facts.map((f) => `${f.labelEn} ${f.valueEn}`).join('; ')}.`);
    descHi.push(`तकनीकी जानकारी: ${facts.map((f) => `${f.labelHi} ${f.valueHi}`).join('; ')}।`);

    const allFit = members.flatMap((r) => r.fitment);
    const compat = tyreCompatibility(allFit);
    // The pattern's pictures: the size with the most; shared by every size, so one set per product.
    const withPics = members.reduce((best, r) => (r.photos.length > best.photos.length ? r : best), rep);
    const photos = withPics.photos;
    const draft = photos.length === 0;
    const sharedPhotos = members.some((r) => r.sharedPhotos);

    const spec: Record<string, unknown> = {
      source: opts.source,
      productType: info.code,
      listedProductType: rep.listedType,
      rangeName: `${rep.brand.name} ${rep.pattern}`,
      pattern: rep.pattern,
      sizeCount: n,
    };
    const putSpec = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') spec[key] = value;
    };
    putSpec('productPage', rep.productPage);
    putSpec('construction', construction);
    putSpec('tubeless', tubeless);
    putSpec('tubeIncluded', tubeIncluded);
    putSpec('position', position);
    putSpec('photoKind', photos.length > 0 && sharedPhotos ? 'range' : '');
    putSpec('finderVehicles', allFit.length > 0 ? allFit.length : null);
    spec.variantSpecs = variantSpecs;

    products.push({
      sourceRow: rep.sourceRow,
      productType: info.code,
      slug,
      range: {
        slug: slugify(`${rep.brand.name} ${rep.pattern}`),
        name: `${rep.brand.name} ${rep.pattern}`,
        nameHi: `${rep.brand.name} ${hindiTyreName(rep.pattern, rep.kind)}`,
      },
      category,
      name,
      nameHi,
      description: descEn.join('\n\n'),
      descriptionHi: descHi.join('\n\n'),
      specSummary,
      specSummaryHi,
      compatibility: compat.en,
      compatibilityHi: compat.hi,
      highlights,
      highlightsHi,
      vehicleTypes: info.vehicleTypes,
      spec,
      warranty: null,
      hsn: info.hsn,
      gstRateBp: GST_RATE_BP,
      status: draft ? 'draft' : 'live',
      variants,
      variant: first,
      partNumbers: first.partNumbers,
      partNumber: first.partNumbers[0] ?? mfrPart(first.sku),
      photos,
      photo: photos[0] ?? null,
      fitmentCount: allFit.length,
    });
    if (draft)
      noPhoto.push({
        slug,
        name,
        reason: members.every((r) => r.noPhotoOnSite) ? 'no_photo_on_site' : 'no_file',
      });
    for (const [k, r] of members.entries()) {
      reportRows.push({
        sourceRow: r.sourceRow,
        productType: r.listedType,
        range: r.pattern,
        model: variants[k]?.model ?? r.sizeText,
        name: r.name,
        slug,
        sku: variants[k]?.sku ?? '',
        category: category.slug,
        mrpRupees: r.mrpPaise === null ? '' : String(r.mrpPaise / 100),
        warrantyMonths: '',
        fitmentCount: r.fitment.length,
        photoFile: photos[0]?.file ?? '',
        photoKind: photos[0] && sharedPhotos ? 'range' : 'model',
        status: draft ? 'draft' : 'live',
      });
    }
  }

  // The checks were collected by the name of the size they are about: give them the slug of its pattern product.
  for (const c of checks) if (c.slug === '') c.slug = slugOfRowName.get(c.name) ?? '';
  reportRows.sort((a, b) => a.sourceRow - b.sourceRow);

  return {
    products,
    rows: reportRows,
    untranslated: opts.untranslated ?? [],
    vehicleWords: new Set([...latinWordsOf(rows), ...(opts.extraWords ?? [])]),
    slugCollisions,
    skuCollisions,
    orphanFitment: opts.orphanFitment ?? 0,
    noPhoto,
    checks,
    priceOnRequest,
  };
}

/** The Hindi form of a tyre's or tube's name (generic words only; brand, pattern and size stay Latin). */
export function hindiTyreName(name: string, kind: TyreKind): string {
  return hindiName(name, kind === 'tube' || kind === 'flap' ? TUBE_WORDS_HI : TYRE_WORDS_HI);
}
