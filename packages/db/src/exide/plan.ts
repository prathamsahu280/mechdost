import { hindiLeftovers } from '@mechdost/shared/catalogue-hindi';
import { parseCsv, slugify } from '@mechdost/shared/catalogue-import';
import type { NetQuantity } from '@mechdost/shared/product-attributes';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { SUB_CATEGORIES } from '../catalogue-v2/glossary';
import {
  FEATURES_HI,
  FUEL_EN,
  FUEL_HI,
  fuelCode,
  RANGE_WORDS_HI,
  SPEC_LABELS_HI,
  SPEC_VALUES_HI,
  TERMINAL_EN,
  TERMINAL_HI,
} from './hindi';

/**
 * Exide catalogue plan (user 2026-11-23, runbook `catalogue-import.md` "Exide import"): the pure step that turns the
 * three exidecare CSVs (`exide_batteries.csv`, `exide_vehicle_fitment.csv`) into what the database should hold: one
 * live product per source row, named exactly as Exide names it ("Exide Mileage ML55D23L"), with one pack, its
 * model code as the manufacturer part number, typed specs and the full fitment list. No I/O here.
 */
export type CsvRow = Record<string, string>;

/** Header + records of a CSV text (BOM dropped) as one object per row. */
export function csvRows(text: string): CsvRow[] {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new Error('The CSV is malformed');
  const [header, ...records] = parsed.records;
  if (!header) return [];
  return records.map((rec) => Object.fromEntries(header.map((h, i) => [h.trim(), (rec[i] ?? '').trim()])));
}

export const BRAND = { slug: 'exide', name: 'Exide' } as const;
export const HOME_POWER = {
  slug: 'home-power',
  name: 'Inverters & home UPS',
  nameHi: 'इन्वर्टर और होम UPS',
} as const;

export interface PlannedCategory {
  slug: string;
  /** Top-level category it sits under; null = top-level itself (`home-power`). */
  parent: string | null;
  name: string;
  nameHi: string;
}

export interface ExideFitment {
  type: string;
  make: string;
  model: string;
  /** `diesel | petrol | cng | lpg | ev | electric_start | kick_start`; null = not stated. */
  fuel: string | null;
  /**
   * Model years the battery fits, when known. Exide's list has no year column: only the few vehicles whose model
   * text carries one ("CRETA -2023 ONWARDS") have it; the rest are null until another source fills them in.
   * `yearTo` null with `yearFrom` set = "onwards".
   */
  yearFrom: number | null;
  yearTo: number | null;
  /** `bs2 | bs3 | bs4 | bs6 | new | old | facelift`; null = nothing known. */
  era: string | null;
}

const BS_YEARS: Readonly<Record<string, [number, number | null]>> = {
  bs2: [2005, 2010],
  bs3: [2010, 2017],
  bs4: [2017, 2020],
  bs6: [2020, null],
};

/**
 * The fitment list's "Model year / era (from the name)" column (Exide's site gives no year; the column is filled where
 * the model name hints at one) as years and a short era code. An unknown value is null, never an error.
 */
export function parseEra(raw: string): Pick<ExideFitment, 'yearFrom' | 'yearTo' | 'era'> {
  const text = raw.trim();
  const none = { yearFrom: null, yearTo: null, era: null };
  if (text === '') return none;
  const bs = /^BS (VI|IV|III|II)\b/i.exec(text);
  if (bs?.[1]) {
    const era = { VI: 'bs6', IV: 'bs4', III: 'bs3', II: 'bs2' }[bs[1].toUpperCase()] ?? null;
    const years = era === null ? undefined : BS_YEARS[era];
    return years ? { yearFrom: years[0], yearTo: years[1], era } : none;
  }
  const onwards = /^((?:19|20)\d\d) onwards$/i.exec(text);
  if (onwards?.[1]) return { yearFrom: Number(onwards[1]), yearTo: null, era: null };
  const model = /^((?:19|20)\d\d) model$/i.exec(text);
  if (model?.[1]) return { yearFrom: Number(model[1]), yearTo: Number(model[1]), era: null };
  if (/^newer version/i.test(text)) return { ...none, era: 'new' };
  if (/^older version/i.test(text)) return { ...none, era: 'old' };
  if (/^facelift/i.test(text)) return { ...none, era: 'facelift' };
  return none;
}

const ERA_EN: Readonly<Record<string, string>> = {
  bs2: 'BS II',
  bs3: 'BS III',
  bs4: 'BS IV',
  bs6: 'BS VI',
  new: 'new model',
  old: 'old model',
  facelift: 'facelift',
};
const ERA_HI: Readonly<Record<string, string>> = {
  bs2: 'BS II',
  bs3: 'BS III',
  bs4: 'BS IV',
  bs6: 'BS VI',
  new: 'नया मॉडल',
  old: 'पुराना मॉडल',
  facelift: 'फ़ेसलिफ़्ट',
};

const YEAR = '((?:19|20)\\d\\d)';
const YEAR_RANGE = new RegExp(`[\\s-]*\\b${YEAR}\\s*(?:-|TO)\\s*${YEAR}\\b\\s*$`, 'i');
const YEAR_ONWARDS = new RegExp(`[\\s-]*\\b${YEAR}\\s*(?:ONW[A-Z]*|\\+)\\s*$`, 'i');
const YEAR_SINGLE = new RegExp(`[\\s-]*\\b${YEAR}\\s*$`);

/**
 * Model years written inside a vehicle model ("CRETA -2023 ONWARDS", "SCORPIO 2022"; the source cuts the text at 30
 * characters, so "ONW" and "ONWAR" also mean onwards). Returns the model without the year part. A bare year is that
 * model year only; tractor codes such as "2030DI-33HP" are not years.
 */
export function parseModelYears(raw: string): {
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
} {
  const text = raw.trim();
  const clean = (m: RegExpExecArray) =>
    text
      .slice(0, m.index)
      .replace(/[\s-]+$/, '')
      .trim();
  const range = YEAR_RANGE.exec(text);
  if (range?.[1] && range[2]) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (to >= from) return { model: clean(range), yearFrom: from, yearTo: to };
  }
  const onwards = YEAR_ONWARDS.exec(text);
  if (onwards?.[1]) return { model: clean(onwards), yearFrom: Number(onwards[1]), yearTo: null };
  const single = YEAR_SINGLE.exec(text);
  if (single?.[1] && clean(single) !== '')
    return { model: clean(single), yearFrom: Number(single[1]), yearTo: Number(single[1]) };
  return { model: text, yearFrom: null, yearTo: null };
}

/** "2023 onwards", "2019-2022", "2022" and the Hindi forms ("2023 से", "2019 से 2022"). */
export function yearText(e: Pick<ExideFitment, 'yearFrom' | 'yearTo'>, hi: boolean): string | null {
  if (e.yearFrom === null) return null;
  const from = String(e.yearFrom);
  if (e.yearTo === null) return hi ? `${from} से` : `${from} onwards`;
  if (e.yearTo === e.yearFrom) return from;
  return hi ? `${from} से ${String(e.yearTo)}` : `${from}-${String(e.yearTo)}`;
}

export interface ExidePlannedProduct {
  /** 1-based row of `exide_batteries.csv` (header excluded). */
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
  variant: {
    sku: string;
    model: string;
    mrpPaise: number | null;
    weightG: number | null;
    netQuantity: NetQuantity;
    options: Record<string, string>;
  };
  /** Manufacturer part number (kind `mfr`) = the model code. */
  partNumber: { kind: 'mfr'; value: string; normalised: string };
  photo: { file: string; sourceUrl: string; alt: string; altHi: string } | null;
  fitmentCount: number;
}

export interface ExideReportRow {
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
  /** `model` = this model's own photo; `range` = Exide's one picture for the whole range (generic). */
  photoKind: 'model' | 'range';
  status: string;
}

export interface ExidePlan {
  products: ExidePlannedProduct[];
  rows: ExideReportRow[];
  /** Feature lines with no Hindi entry (left out of the Hindi text); the unit test requires none. */
  untranslated: string[];
  /** Lower-case words of vehicle makes and models: Latin by rule 10 ("brand and model names"). */
  vehicleWords: ReadonlySet<string>;
  slugCollisions: number;
  skuCollisions: number;
  /** Fitment rows whose battery model is not in the battery list. */
  orphanFitment: number;
}

interface TypeInfo {
  code: string;
  /** `bat|…` key of the catalogue-v2 sub-category, or 'home' for the home-power category. */
  category: string;
  vehicleTypes: VehicleType[];
  hsn: string;
  en: string;
  hi: string;
}

/** Product type (CSV) → code, category, vehicle types and HSN (batteries 8507, inverters/UPS and combos 8504). */
const TYPES: Readonly<Record<string, TypeInfo>> = {
  'Car / SUV / MUV battery': {
    code: 'car_suv_muv_battery',
    category: 'bat|Car/SUV Battery',
    vehicleTypes: ['4W'],
    hsn: '8507',
    en: 'car, SUV and MUV battery',
    hi: 'कार, SUV और MUV बैटरी',
  },
  'Truck and bus (LCV / HCV) battery': {
    code: 'truck_bus_battery',
    category: 'bat|CV Battery',
    vehicleTypes: [],
    hsn: '8507',
    en: 'truck and bus (LCV / HCV) battery',
    hi: 'ट्रक और बस (LCV / HCV) की बैटरी',
  },
  'Special vehicle battery': {
    code: 'special_vehicle_battery',
    category: 'bat|CV Battery',
    vehicleTypes: [],
    hsn: '8507',
    en: 'special vehicle battery',
    hi: 'विशेष वाहन की बैटरी',
  },
  'Three-wheeler battery': {
    code: 'three_wheeler_battery',
    category: 'bat|3-Wheeler Battery',
    vehicleTypes: ['3W'],
    hsn: '8507',
    en: 'three-wheeler battery',
    hi: 'तिपहिया वाहन की बैटरी',
  },
  'Two-wheeler battery': {
    code: 'two_wheeler_battery',
    category: 'bat|2-Wheeler Battery',
    vehicleTypes: ['2W'],
    hsn: '8507',
    en: 'two-wheeler battery',
    hi: 'दोपहिया वाहन की बैटरी',
  },
  'Tractor battery': {
    code: 'tractor_battery',
    category: 'bat|Tractor Battery',
    vehicleTypes: [],
    hsn: '8507',
    en: 'tractor battery',
    hi: 'ट्रैक्टर की बैटरी',
  },
  'Genset battery': {
    code: 'genset_battery',
    category: 'bat|Genset Battery',
    vehicleTypes: [],
    hsn: '8507',
    en: 'genset battery',
    hi: 'जेनसेट की बैटरी',
  },
  'Inverter battery': {
    code: 'inverter_battery',
    category: 'home',
    vehicleTypes: [],
    hsn: '8507',
    en: 'inverter battery',
    hi: 'इन्वर्टर बैटरी',
  },
  'Lithium-ion battery': {
    code: 'lithium_ion_battery',
    category: 'home',
    vehicleTypes: [],
    hsn: '8507',
    en: 'lithium-ion inverter battery',
    hi: 'लिथियम-आयन इन्वर्टर बैटरी',
  },
  'Home UPS inverter': {
    code: 'home_ups_inverter',
    category: 'home',
    vehicleTypes: [],
    hsn: '8504',
    en: 'home UPS inverter',
    hi: 'होम UPS इन्वर्टर',
  },
  'Inverter + battery combo': {
    code: 'inverter_battery_combo',
    category: 'home',
    vehicleTypes: [],
    hsn: '8504',
    en: 'inverter and battery combo',
    hi: 'इन्वर्टर और बैटरी कॉम्बो',
  },
};

const FITMENT_TYPES: Readonly<Record<string, { code: string; order: number }>> = {
  'Car / SUV / MUV': { code: 'car_suv_muv', order: 0 },
  'LCV / HCV': { code: 'lcv_hcv', order: 1 },
  Tractor: { code: 'tractor', order: 2 },
  'Two-wheeler': { code: 'two_wheeler', order: 3 },
  'Three-wheeler': { code: 'three_wheeler', order: 4 },
  Genset: { code: 'genset', order: 5 },
};

/** Fitment shown in the searchable text: this many vehicles, then "and N more" (the full list is in `spec.fitment`). */
export const COMPATIBILITY_CAP = 40;
const GST_BP = 1800;

const ACRONYMS = new Set(['HUPS', 'GQP', 'HB', 'EL', 'UPS', 'LIB']);

/** Title case of the letter runs of one word ("E-RIDE" → "E-Ride", "HUPS" stays); words with digits are codes. */
function titleWord(word: string): string {
  if (/\d/.test(word)) return word;
  if (word.toUpperCase() === 'AGMI') return 'AGMi';
  return word.replace(/[A-Za-z]+/g, (run) =>
    ACRONYMS.has(run.toUpperCase()) || run.length <= 1
      ? run.toUpperCase()
      : run.charAt(0).toUpperCase() + run.slice(1).toLowerCase(),
  );
}

/** "Maruti Suzuki Swift"-style title case for the upper-case vehicle names; short words ("MG", "KIA") stay upper. */
export function titleVehicle(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w !== '')
    .map((w) =>
      /\d/.test(w)
        ? w
        : w.replace(/[A-Za-z]+/g, (run) =>
            run.length <= 3 ? run.toUpperCase() : run.charAt(0).toUpperCase() + run.slice(1).toLowerCase(),
          ),
    )
    .join(' ');
}

/** The range as Exide titles it: "EXIDE INVA ZEN" → "Exide Inva Zen"; a range without the brand gets it in front. */
export function rangeTitle(range: string): { en: string; hi: string; words: string[] } {
  const tokens = range.split(/\s+/).filter((t) => t !== '');
  const rest = tokens[0]?.toLowerCase() === 'exide' ? tokens.slice(1) : tokens;
  const words = rest.map(titleWord);
  const hi = rest.map((w) => RANGE_WORDS_HI[w.toLowerCase()] ?? titleWord(w));
  return { en: ['Exide', ...words].join(' '), hi: ['Exide', ...hi].join(' '), words };
}

function num(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

const norm = (text: string) =>
  text
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Source text without the broken `�` bytes of the export (`220V � 7v` was `220V ± 7V`). */
export function cleanSpecText(text: string): string {
  return text
    .replace(/\s*�\s*(?=\d)/g, ' ±')
    .replace(/(\d)\s*�/g, '$1 ±')
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^±\s*/, '±');
}

function otherSpecs(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const part of text.split(/;\s+/)) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const key = cleanSpecText(part.slice(0, i));
    const value = cleanSpecText(part.slice(i + 1)).replace(/\*+$/, '');
    if (key !== '' && value !== '') out.push({ key, value });
  }
  return out;
}

/** Rows of "Other specifications" that only repeat a typed column (capacity, size, weight, warranty). */
const DUPLICATE_KEY =
  /capacity|dimension|^length|^width|^height|^[lwh] \(mm\)|\b[lwh]\) mm|weight|^warranty|ah capacity|^capacity/i;

function featureLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[;|]/)) {
    const t = part.trim();
    if (t !== '' && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** English wording of a feature line (the source drops an apostrophe: "Indias" → "India's"). */
const featureEn = (line: string) => line.replace(/^Indias /, "India's ");

interface Fact {
  key: string;
  labelEn: string;
  labelHi: string;
  valueEn: string;
  valueHi: string;
}

const numText = (n: number) => String(n);

/** Warranty split "24F + 24P Months", "36+24*" or "(FOC + Pro Rata)" 36+24, when it adds up to the warranty. */
function warrantySplit(others: { key: string; value: string }[], months: number | null) {
  if (months === null) return null;
  for (const o of others) {
    if (!/^warranty/i.test(o.key)) continue;
    const m = /(\d+)\s*F?\s*\+\s*(\d+)\s*P?/i.exec(o.value);
    if (m?.[1] && m[2] && Number(m[1]) + Number(m[2]) === months)
      return { free: Number(m[1]), pro: Number(m[2]) };
  }
  return null;
}

const ACID: Readonly<Record<string, { code: string; en: string; hi: string }>> = {
  present: { code: 'present', en: 'Present', hi: 'मौजूद' },
  'not present': { code: 'not_present', en: 'Not present', hi: 'नहीं है' },
  na: { code: 'not_applicable', en: 'Not applicable', hi: 'लागू नहीं' },
};

/** Exide's warranty note as English and Hindi, from its three wordings (one sentence each). */
export function warrantyNote(raw: string): { en: string; hi: string } | null {
  const text = raw.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  const en = text;
  const parts: string[] = [];
  if (/applicable as per OEM fitment/i.test(text)) parts.push('वारंटी OEM फिटमेंट के अनुसार लागू होती है।');
  const foc = /commercial application, warranty is (\d+) Months? FOC/i.exec(text);
  if (foc?.[1]) {
    const since = /on or after (\d{2}\.\d{2}\.\d{4})/i.exec(text);
    parts.push(
      `व्यावसायिक उपयोग के लिए ${foc[1]} महीने की वारंटी बिना शुल्क मिलती है` +
        (since?.[1] ? ` (${since[1]} या उसके बाद ग्राहकों को बेची गई बैटरियों पर)।` : '।'),
    );
  }
  return parts.length === 0 ? null : { en, hi: parts.join(' ') };
}

export interface PlanInput {
  batteries: readonly CsvRow[];
  fitment: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; missing = the product is planned as a draft. */
  pictureExists?: (file: string) => boolean;
}

export function planExide(input: PlanInput): ExidePlan {
  const exists = input.pictureExists ?? (() => true);
  // Fitment per battery model, once.
  const byModel = new Map<string, ExideFitment[]>();
  const known = new Set(input.batteries.map((b) => b.Model));
  let orphanFitment = 0;
  const vehicleWords = new Set<string>();
  const seenFit = new Set<string>();
  for (const f of input.fitment) {
    const model = f['Battery model'] ?? '';
    if (!known.has(model)) {
      orphanFitment += 1;
      continue;
    }
    const type = FITMENT_TYPES[f['Vehicle type'] ?? '']?.code;
    const make = (f.Make ?? '').trim();
    const years = parseModelYears(f.Model ?? '');
    const vModel = years.model;
    if (!type || make === '' || vModel === '') {
      orphanFitment += 1;
      continue;
    }
    // The era column wins; a year written in the model text fills in only where the column is empty.
    const era = parseEra(f['Model year / era (from the name)'] ?? '');
    const hasEra = era.yearFrom !== null || era.era !== null;
    const entry: ExideFitment = {
      type,
      make,
      model: vModel,
      fuel: fuelCode(f['Fuel / start type'] ?? ''),
      yearFrom: hasEra ? era.yearFrom : years.yearFrom,
      yearTo: hasEra ? era.yearTo : years.yearTo,
      era: era.era,
    };
    const key = `${model}|${type}|${make}|${vModel}|${entry.fuel ?? ''}|${String(entry.yearFrom)}|${String(entry.yearTo)}|${entry.era ?? ''}`;
    if (seenFit.has(key)) continue;
    seenFit.add(key);
    byModel.set(model, [...(byModel.get(model) ?? []), entry]);
  }
  const typeOrder = (t: string) => Object.values(FITMENT_TYPES).find((x) => x.code === t)?.order ?? 9;
  for (const list of byModel.values()) {
    list.sort(
      (a, b) =>
        typeOrder(a.type) - typeOrder(b.type) ||
        cmp(a.make, b.make) ||
        cmp(a.model, b.model) ||
        cmp(a.fuel ?? '', b.fuel ?? '') ||
        (a.yearFrom ?? 0) - (b.yearFrom ?? 0),
    );
    for (const e of list)
      for (const w of `${titleVehicle(e.make)} ${titleVehicle(e.model)}`.match(/[A-Za-z]{3,}/g) ?? [])
        vehicleWords.add(w.toLowerCase());
  }

  const modelCount = new Map<string, number>();
  for (const b of input.batteries) modelCount.set(b.Model ?? '', (modelCount.get(b.Model ?? '') ?? 0) + 1);

  const slugs = new Set<string>();
  const skus = new Set<string>();
  const untranslated = new Set<string>();
  const products: ExidePlannedProduct[] = [];
  const rows: ExideReportRow[] = [];
  let slugCollisions = 0;
  let skuCollisions = 0;

  input.batteries.forEach((b, index) => {
    const sourceRow = index + 1;
    const typeName = b['Product type'] ?? '';
    const info = TYPES[typeName];
    const model = (b.Model ?? '').trim();
    if (!info || model === '') throw new Error(`Row ${String(sourceRow)}: unknown product type or no model`);
    const isCombo = info.code === 'inverter_battery_combo';
    const range = rangeTitle(b.Range ?? '');
    const name = isCombo ? `Exide ${model}` : `${range.en} ${model}`;
    const nameHi = isCombo ? `Exide ${model}` : `${range.hi} ${model}`;
    const rangeName = isCombo ? 'Exide Home Inverter + Battery Combo' : range.en;
    const rangeNameHi = isCombo ? 'Exide होम इन्वर्टर + बैटरी कॉम्बो' : range.hi;

    let slug = slugify(name);
    if (slugs.has(slug)) {
      slugCollisions += 1;
      let n = 2;
      while (slugs.has(`${slug}-${String(n)}`)) n += 1;
      slug = `${slug}-${String(n)}`;
    }
    slugs.add(slug);
    let sku = `EXIDE-${norm(model)}`;
    if ((modelCount.get(model) ?? 0) > 1)
      sku = `EXIDE-${norm(isCombo ? model : range.words.join(' '))}-${norm(model)}`;
    if (skus.has(sku)) {
      skuCollisions += 1;
      sku = `${sku}-${String(sourceRow)}`;
    }
    skus.add(sku);

    const others = otherSpecs(b['Other specifications'] ?? '');
    const find = (re: RegExp) => others.find((o) => re.test(o.key))?.value ?? '';
    const warrantyM = /^(\d+)\s*MONTH/i.exec(b.Warranty ?? '');
    const warrantyMonths = warrantyM?.[1] && Number(warrantyM[1]) >= 12 ? Number(warrantyM[1]) : null;
    const split = warrantySplit(others, warrantyMonths);
    const capacityAh = num(b['Capacity (Ah)']) ?? num(/[\d.]+/.exec(find(/capacity|^ah/i))?.[0]);
    const ratingRaw = (b['Inverter rating'] ?? '').replace(/\s+/g, ' ').trim();
    const vaOther = find(/^va rating/i);
    const inverterRating =
      ratingRaw !== '' && ratingRaw !== '12V'
        ? ratingRaw
        : vaOther !== ''
          ? `${vaOther.replace(/\s+/g, '')} ${find(/^voltage/i).replace(/\s+/g, '')}`.trim()
          : ratingRaw;
    const va = /([\d.]+)\s*(K?)VA/i.exec(inverterRating);
    const volts =
      /(\d+)\s*V\b/i.exec(inverterRating) ?? /(\d+)\s*V\b/i.exec(find(/battery voltage|^voltage/i));
    const terminal = (b['Terminal layout'] ?? '').trim().toLowerCase();
    const acid = ACID[(b['Acid level indicator'] ?? '').trim().toLowerCase()];
    const lengthMm = num(b['Length (mm)']);
    const widthMm = num(b['Width (mm)']);
    const heightMm = num(b['Height (mm)']);
    const weightKg = num(b['Weight (kg)']);
    const ccaEn = num(b['CCA EN (A at -18 C)']);
    const ccaSae = num(b['CCA SAE (A at -18 C)']);
    const electrolyteL = num(b['Electrolyte volume (L)']);
    const chargingCurrentA = num(b['Charging current (A)']);
    const acInput = (b['AC input'] ?? '').trim();
    const inverterType = (b['Inverter type'] ?? '').trim();
    const lithium = info.code === 'lithium_ion_battery';
    const agm = /agmi/i.test(b.Range ?? '');
    const fit = byModel.get(model) ?? [];
    const pictureFile = (b['Picture file'] ?? '').split('|')[0]?.trim() ?? '';
    const mrp = num(b['MRP (Rs, incl. taxes)']);

    const spec: Record<string, unknown> = { source: 'exidecare', productType: info.code, model };
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') spec[key] = value;
    };
    put('sourceUrl', b['Product page']);
    put('pictureUrl', (b['Picture URL'] ?? '').split('|')[0]?.trim());
    put('pictureType', b['Picture type']);
    // A range photo is the one picture Exide shows for every model of the range: it does not show this model.
    const photoKind = /^range photo/i.test(b['Picture type'] ?? '') ? 'range' : 'model';
    put('photoKind', photoKind);
    put('rangeName', rangeName);
    put('segment', b.Segment);
    put('voltage', volts?.[1] ? Number(volts[1]) : null);
    put('capacityAh', capacityAh);
    put('capacityRating', b['Capacity rating']);
    put('batteryType', lithium ? 'lithium' : agm ? 'agm' : null);
    put('warrantyMonths', warrantyMonths);
    put('freeReplacementMonths', split?.free);
    put('proRataMonths', split?.pro);
    put('lengthMm', lengthMm);
    put('widthMm', widthMm);
    put('heightMm', heightMm);
    put('weightKg', weightKg);
    put('terminalLayout', terminal);
    put('ccaEn', ccaEn);
    put('ccaSae', ccaSae);
    put('electrolyteL', electrolyteL);
    put('chargingCurrentA', chargingCurrentA);
    put('acidLevelIndicator', acid?.code);
    put('inverterType', inverterType);
    put('inverterRating', inverterRating);
    put('inverterVa', va?.[1] ? Math.round(Number(va[1]) * (va[2] ? 1000 : 1)) : null);
    put('acInput', acInput);
    if (others.length > 0) spec.otherSpecs = others;
    if (fit.length > 0) spec.fitment = fit;

    // Facts: one list feeds the highlights, the specification paragraph and the one-line summary.
    const facts: Fact[] = [];
    const fact = (key: string, labelEn: string, labelHi: string, valueEn: string, valueHi = valueEn) =>
      facts.push({ key, labelEn, labelHi, valueEn, valueHi });
    if (warrantyMonths !== null)
      fact(
        'warranty',
        'Warranty',
        'वारंटी',
        `${numText(warrantyMonths)} months` +
          (split ? ` (${numText(split.free)} free replacement + ${numText(split.pro)} pro-rata)` : ''),
        `${numText(warrantyMonths)} महीने` +
          (split
            ? ` (${numText(split.free)} महीने मुफ़्त बदलाव + ${numText(split.pro)} महीने आनुपातिक)`
            : ''),
      );
    if (capacityAh !== null) {
      const rating = (b['Capacity rating'] ?? '').trim();
      fact('capacity', 'Capacity', 'क्षमता', `${numText(capacityAh)} Ah${rating ? ` (${rating})` : ''}`);
    }
    if (inverterRating !== '') fact('rating', 'Rating', 'रेटिंग', inverterRating);
    if (ccaEn !== null) fact('ccaEn', 'Cold cranking (EN)', 'कोल्ड क्रैंकिंग (EN)', `${numText(ccaEn)} A`);
    if (ccaSae !== null)
      fact('ccaSae', 'Cold cranking (SAE)', 'कोल्ड क्रैंकिंग (SAE)', `${numText(ccaSae)} A`);
    if (lengthMm !== null && widthMm !== null && heightMm !== null) {
      const dims = `${numText(lengthMm)} × ${numText(widthMm)} × ${numText(heightMm)}`;
      fact('size', 'Size (L × W × H)', 'आकार (L × W × H)', `${dims} mm`, `${dims} मिमी`);
    }
    if (weightKg !== null)
      fact('weight', 'Weight', 'वज़न', `${numText(weightKg)} kg`, `${numText(weightKg)} किग्रा`);
    if (terminal === 'left' || terminal === 'right')
      fact('terminal', 'Terminal', 'टर्मिनल', TERMINAL_EN[terminal] ?? '', TERMINAL_HI[terminal] ?? '');
    if (electrolyteL !== null)
      fact(
        'electrolyte',
        'Electrolyte',
        'इलेक्ट्रोलाइट',
        `${numText(electrolyteL)} L`,
        `${numText(electrolyteL)} लीटर`,
      );
    if (chargingCurrentA !== null)
      fact('charging', 'Charging current', 'चार्जिंग करंट', `${numText(chargingCurrentA)} A`);
    if (acid) fact('acid', 'Acid level indicator', 'एसिड लेवल इंडिकेटर', acid.en, acid.hi);
    if (acInput !== '' && hindiLeftovers(acInput).length === 0)
      fact('acInput', 'AC input', 'AC इनपुट', acInput);
    for (const o of others) {
      if (DUPLICATE_KEY.test(o.key)) continue;
      const labelHi = SPEC_LABELS_HI[o.key.toLowerCase()];
      const valueHi =
        SPEC_VALUES_HI[o.value.toLowerCase()] ?? (hindiLeftovers(o.value).length === 0 ? o.value : null);
      if (labelHi && valueHi) fact(`other:${o.key}`, o.key, labelHi, o.value, valueHi);
    }
    const factOf = (key: string) => facts.find((f) => f.key === key);

    // Summary: capacity or rating, warranty, then terminal or size.
    const sumEn: string[] = [];
    const sumHi: string[] = [];
    const cap = factOf('capacity');
    const rat = factOf('rating');
    const ter = factOf('terminal') ?? factOf('size');
    if (cap) {
      sumEn.push(cap.valueEn.replace(/ \(.*\)$/, ''));
      sumHi.push(`क्षमता ${cap.valueHi.replace(/ \(.*\)$/, '')}`);
    }
    if (rat) {
      sumEn.push(rat.valueEn);
      sumHi.push(`रेटिंग ${rat.valueHi}`);
    }
    if (warrantyMonths !== null) {
      sumEn.push(`${numText(warrantyMonths)} months warranty`);
      sumHi.push(`वारंटी ${numText(warrantyMonths)} महीने`);
    }
    if (ter) {
      sumEn.push(ter.key === 'terminal' ? `${ter.valueEn} terminal` : ter.valueEn);
      sumHi.push(ter.key === 'terminal' ? `टर्मिनल ${ter.valueHi}` : ter.valueHi);
    }
    const specSummary = (sumEn.length > 0 ? sumEn : [info.en]).slice(0, 4).join(' · ');
    const specSummaryHi = (sumHi.length > 0 ? sumHi : [info.hi]).slice(0, 4).join(' · ');

    // Features, in both languages (a line with no Hindi is left out of both).
    const features = featureLines(b.Features ?? '');
    const featsEn: string[] = [];
    const featsHi: string[] = [];
    for (const line of features) {
      const hi = FEATURES_HI[line];
      if (!hi) {
        untranslated.add(line);
        continue;
      }
      featsEn.push(featureEn(line));
      featsHi.push(hi);
    }

    // Highlights (max 8, same count in both languages).
    const hl: [string, string][] = [];
    for (const key of ['warranty', 'capacity', 'rating', 'ccaEn', 'size', 'weight', 'terminal']) {
      const f = factOf(key);
      if (f) hl.push([`${f.labelEn}: ${f.valueEn}`, `${f.labelHi}: ${f.valueHi}`]);
    }
    featsEn.forEach((en, i) => hl.push([en, featsHi[i] ?? en]));
    const highlights = hl.slice(0, 8).map((h) => h[0]);
    const highlightsHi = hl.slice(0, 8).map((h) => h[1]);

    // Description.
    const note = warrantyNote(b['Warranty / spec notes from Exide'] ?? '');
    const descEn: string[] = [`${name}: ${info.en} by Exide.`];
    const descHi: string[] = [`${nameHi}: Exide की ${info.hi}।`];
    if (featsEn.length > 0) {
      descEn.push(`Features: ${featsEn.join('; ')}.`);
      descHi.push(`विशेषताएँ: ${featsHi.join('; ')}।`);
    }
    if (facts.length > 0) {
      descEn.push(`Specifications: ${facts.map((f) => `${f.labelEn} ${f.valueEn}`).join('; ')}.`);
      descHi.push(`तकनीकी जानकारी: ${facts.map((f) => `${f.labelHi} ${f.valueHi}`).join('; ')}।`);
    }
    if (note) {
      descEn.push(note.en);
      descHi.push(note.hi);
    }

    // Fitment text (searchable) and its Hindi twin.
    const labels = (fuelWords: Readonly<Record<string, string>>, hi: boolean) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const e of fit) {
        const base = `${titleVehicle(e.make)} ${titleVehicle(e.model)}`;
        const eraWords = hi ? ERA_HI : ERA_EN;
        const detail = [
          e.fuel ? (fuelWords[e.fuel] ?? '') : null,
          e.era ? eraWords[e.era] : null,
          yearText(e, hi),
        ].filter((d): d is string => d !== null && d !== '');
        const label = detail.length > 0 ? `${base} (${detail.join(', ')})` : base;
        if (!seen.has(label)) {
          seen.add(label);
          out.push(label);
        }
      }
      return out;
    };
    const fitText = (list: string[], more: (n: number) => string): string | null =>
      list.length === 0
        ? null
        : [
            ...list.slice(0, COMPATIBILITY_CAP),
            ...(list.length > COMPATIBILITY_CAP ? [more(list.length - COMPATIBILITY_CAP)] : []),
          ]
            .join(', ')
            .replace(/, (and \d+ more|और \d+ अन्य)$/, ' $1');
    const compatibility = fitText(labels(FUEL_EN, false), (n) => `and ${String(n)} more`);
    const compatibilityHi = fitText(labels(FUEL_HI, true), (n) => `और ${String(n)} अन्य`);

    const draft = pictureFile === '' || !exists(pictureFile);
    const product: ExidePlannedProduct = {
      sourceRow,
      productType: info.code,
      slug,
      range: {
        slug: slugify(`exide-${rangeName.replace(/^Exide /, '')}`),
        name: rangeName,
        nameHi: rangeNameHi,
      },
      category: categoryFor(info),
      name,
      nameHi,
      description: descEn.join('\n\n'),
      descriptionHi: descHi.join('\n\n'),
      specSummary,
      specSummaryHi,
      compatibility,
      compatibilityHi,
      highlights,
      highlightsHi,
      vehicleTypes: info.vehicleTypes,
      spec,
      warranty: warrantyMonths === null ? null : `${numText(warrantyMonths)} months`,
      hsn: info.hsn,
      gstRateBp: GST_BP,
      status: draft ? 'draft' : 'live',
      variant: {
        sku,
        model,
        mrpPaise: mrp === null ? null : Math.round(mrp * 100),
        weightG: weightKg === null ? null : Math.round(weightKg * 1000),
        netQuantity: { qty: 1, unit: 'piece' },
        options: { model },
      },
      partNumber: { kind: 'mfr', value: model, normalised: model.toUpperCase().replace(/[^A-Z0-9]/g, '') },
      photo:
        pictureFile === ''
          ? null
          : {
              file: pictureFile,
              sourceUrl: ((b['Picture URL'] ?? '').split('|')[0] ?? '').trim().slice(0, 500),
              alt: name,
              altHi: nameHi,
            },
      fitmentCount: fit.length,
    };
    products.push(product);
    rows.push({
      sourceRow,
      productType: typeName,
      range: b.Range ?? '',
      model,
      name,
      slug,
      sku,
      category: product.category.slug,
      mrpRupees: mrp === null ? '' : String(mrp),
      warrantyMonths: warrantyMonths === null ? '' : String(warrantyMonths),
      fitmentCount: fit.length,
      photoFile: pictureFile,
      photoKind,
      status: product.status,
    });
  });

  return {
    products,
    rows,
    untranslated: [...untranslated],
    vehicleWords,
    slugCollisions,
    skuCollisions,
    orphanFitment,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function categoryFor(info: TypeInfo): PlannedCategory {
  if (info.category === 'home') return { ...HOME_POWER, parent: null };
  const sub = SUB_CATEGORIES[info.category];
  if (!sub) throw new Error(`No sub-category for ${info.category}`);
  return { slug: sub.slug, parent: sub.parent, name: sub.name, nameHi: sub.nameHi };
}

/**
 * Hindi texts of the plan that still hold English words (hard rule 10). Vehicle makes and models are brand and model
 * names, so the words of the fitment list may stay in Latin script.
 */
export function exideHindiLeftovers(plan: ExidePlan): { slug: string; field: string; words: string[] }[] {
  const out: { slug: string; field: string; words: string[] }[] = [];
  for (const p of plan.products) {
    const fields: [string, string | null][] = [
      ['name_hi', p.nameHi],
      ['range.name_hi', p.range.nameHi],
      ['category.name_hi', p.category.nameHi],
      ['spec_summary_hi', p.specSummaryHi],
      ['compatibility_hi', p.compatibilityHi],
      ['description_hi', p.descriptionHi],
      ['photo.alt_hi', p.photo?.altHi ?? null],
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
