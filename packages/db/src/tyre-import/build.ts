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
  /** Products by price state, for the report. */
  priceOnRequest: { slug: string; name: string; siteDataPaise: number | null }[];
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

/**
 * The shared planner of the CEAT and MRF importers: rows → products, report rows and the checks. One product per tyre size
 * (and tube-type), one pack, the maker's own SKU or the name as SKU, spec keys that match the tyre attribute set
 * (`size`, `loadIndex`, `speedSymbol`, `tubeless`, `position`) plus the typed import data.
 */
export function planTyreRows(
  rows: readonly TyreRow[],
  opts: {
    source: 'ceat' | 'mrf';
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
  let slugCollisions = 0;
  let skuCollisions = 0;

  for (const r of rows) {
    const info = KINDS[r.kind];
    const category: PlannedCategory = TYRE_CATEGORIES[r.kind];
    let slug = slugify(r.name);
    if (slugs.has(slug)) {
      slugCollisions += 1;
      let n = 2;
      while (slugs.has(`${slug}-${String(n)}`)) n += 1;
      slug = `${slug}-${String(n)}`;
    }
    slugs.add(slug);
    let sku = `${opts.skuPrefix}-${r.sourceSku ?? norm(r.name.replace(/^MRF\s+/i, ''))}`;
    if (skus.has(sku)) {
      skuCollisions += 1;
      sku = `${sku}-${String(r.sourceRow)}`;
    }
    skus.add(sku);

    const construction = r.construction;
    const facts: Fact[] = [];
    const fact = (key: string, labelEn: string, labelHi: string, valueEn: string, valueHi = valueEn) =>
      facts.push({ key, labelEn, labelHi, valueEn, valueHi });
    fact('size', 'Size', 'साइज़', r.sizeText);
    if (construction)
      fact(
        'construction',
        'Construction',
        'बनावट',
        CONSTRUCTION_EN[construction] ?? construction,
        CONSTRUCTION_HI[construction] ?? construction,
      );
    if (r.kind !== 'tube' && r.kind !== 'flap') {
      if (r.tubeless !== null)
        fact(
          'tubeType',
          'Tyre type',
          'टायर का प्रकार',
          r.tubeless ? 'Tubeless (TL)' : 'Tube type (TT)',
          r.tubeless ? 'ट्यूबलेस (TL)' : 'ट्यूब टाइप (TT)',
        );
      if (r.tubeIncluded) fact('tube', 'Tube', 'ट्यूब', 'Included with the tyre', 'टायर के साथ शामिल');
    }
    if (r.loadIndex !== null) fact('load', 'Load index', 'लोड इंडेक्स', r.loadIndex);
    if (r.speedRating !== null) fact('speed', 'Speed rating', 'स्पीड रेटिंग', r.speedRating);
    if (r.plyRating !== null) fact('ply', 'Ply rating', 'प्लाई रेटिंग', String(r.plyRating));
    if (r.position !== null)
      fact(
        'position',
        'Fitment position',
        'लगाने की जगह',
        POSITION_EN[r.position] ?? r.position,
        POSITION_HI[r.position] ?? r.position,
      );
    facts.push(...r.extraFacts);

    const spec: Record<string, unknown> = {
      source: opts.source,
      productType: info.code,
      model: r.sizeText,
      listedProductType: r.listedType,
      rangeName: `${r.brand.name} ${r.pattern}`,
    };
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
    put('construction', construction);
    put('loadIndexText', r.loadIndex);
    const loadN = r.loadIndex !== null && /^\d+$/.test(r.loadIndex) ? Number(r.loadIndex) : null;
    put('loadIndex', loadN !== null && loadN >= 20 && loadN <= 150 ? loadN : null);
    put('speedSymbol', r.speedRating);
    put('plyRating', r.plyRating);
    put('tubeless', r.tubeless);
    put('tubeIncluded', r.tubeIncluded);
    put('position', r.position);
    put('photoKind', r.photos.length > 0 && r.sharedPhotos ? 'range' : '');
    put('finderVehicles', r.fitment.length > 0 ? r.fitment.length : null);
    for (const [k, v] of Object.entries(r.extraSpec)) put(k, v);
    if (r.fitment.length > 0) spec.fitment = r.fitment;

    const factOf = (key: string) => facts.find((f) => f.key === key);
    const sumEn: string[] = [r.sizeText];
    const sumHi: string[] = [r.sizeText];
    const cons = factOf('construction');
    if (cons) {
      sumEn.push(cons.valueEn);
      sumHi.push(cons.valueHi);
    }
    const tt = factOf('tubeType');
    if (tt) {
      sumEn.push(tt.valueEn);
      sumHi.push(tt.valueHi);
    }
    const load = factOf('load');
    const speed = factOf('speed');
    if (load) {
      sumEn.push(`${load.valueEn}${speed?.valueEn ?? ''}`);
      sumHi.push(`${load.valueHi}${speed?.valueHi ?? ''}`);
    }
    const specSummary = sumEn.slice(0, 4).join(' · ');
    const specSummaryHi = sumHi.slice(0, 4).join(' · ');

    const { highlights, highlightsHi } = highlightsOf(
      facts,
      ['size', 'construction', 'tubeType', 'load', 'speed', 'ply', 'position'],
      r.features.map((f) => f.en),
      r.features.map((f) => f.hi),
    );

    const descEn: string[] = [`${r.name}: ${info.en} by ${r.brand.label}.`];
    const descHi: string[] = [`${r.nameHi}: ${r.brand.label} का ${info.hi}।`];
    if (r.tagline) {
      descEn.push(r.tagline.en);
      descHi.push(r.tagline.hi);
    }
    descEn.push(`Specifications: ${facts.map((f) => `${f.labelEn} ${f.valueEn}`).join('; ')}.`);
    descHi.push(`तकनीकी जानकारी: ${facts.map((f) => `${f.labelHi} ${f.valueHi}`).join('; ')}।`);

    const compat = tyreCompatibility(r.fitment);
    const draft = r.photos.length === 0;
    const first = r.photos[0] ?? null;
    const part = mfrPart(r.partNumber);
    const product: PlannedProduct = {
      sourceRow: r.sourceRow,
      productType: info.code,
      slug,
      range: {
        slug: slugify(`${r.brand.name} ${r.pattern}`),
        name: `${r.brand.name} ${r.pattern}`,
        nameHi: `${r.brand.name} ${hindiTyreName(r.pattern, r.kind)}`,
      },
      category,
      name: r.name,
      nameHi: r.nameHi,
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
      variant: {
        sku,
        model: r.sizeText,
        mrpPaise: r.mrpPaise,
        weightG: null,
        netQuantity: { qty: 1, unit: 'piece' },
        options: { size: r.sizeText },
      },
      partNumbers: part.normalised === '' ? [] : [part],
      partNumber: part,
      photos: r.photos,
      photo: first,
      fitmentCount: r.fitment.length,
    };
    products.push(product);
    if (draft)
      noPhoto.push({
        slug,
        name: r.name,
        reason: r.noPhotoOnSite ? 'no_photo_on_site' : 'no_file',
      });
    if (r.mrpPaise === null) {
      const site =
        (r.extraSpec.ceatPrice as { siteData?: { paise?: number } } | undefined)?.siteData?.paise ?? null;
      priceOnRequest.push({ slug, name: r.name, siteDataPaise: site });
    }
    reportRows.push({
      sourceRow: r.sourceRow,
      productType: r.listedType,
      range: r.pattern,
      model: r.sizeText,
      name: r.name,
      slug,
      sku,
      category: category.slug,
      mrpRupees: r.mrpPaise === null ? '' : String(r.mrpPaise / 100),
      warrantyMonths: '',
      fitmentCount: r.fitment.length,
      photoFile: first?.file ?? '',
      photoKind: first && r.sharedPhotos ? 'range' : 'model',
      status: product.status,
    });
  }

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
