import { slugify } from '@mechdost/shared/catalogue-import';
import type { VehicleType } from '@mechdost/shared/vehicles';
import {
  addVehicleWords,
  categoryFor,
  cleanSpecText,
  compatibilityTexts,
  EARTH_MOVING_CATEGORY,
  fuelCode,
  highlightsOf,
  mfrPart,
  monthsHi,
  norm,
  num,
  paise,
  parseEra,
  planHindiLeftovers,
  sortFitment,
  TERMINAL_EN,
  TERMINAL_HI,
  titleWord as titleWordWith,
  type BatteryFitment,
  type BatteryPlan,
  type CategoryRef,
  type CsvRow,
  type Fact,
  type PlannedPhoto,
  type PlannedProduct,
  type PlannedVariant,
  type ReportRow,
} from '../battery-import';
import { FEATURES, FORM_FACTOR_HI, NAME_WORDS_HI, TECHNOLOGY_HI, VIEWS } from './hindi';

/**
 * Amaron catalogue plan (user 2026-11-23, runbook `catalogue-import.md` "Amaron import"): the pure step that turns the
 * four amaron_batteries CSVs (batteries, vehicle fitment, Home UPS combos) into what the database should hold: one
 * live product per source row, named as Amaron names it ("Amaron Pro 55B24LS"), one pack (SKU from the item code),
 * the model and item code as manufacturer part numbers, typed specs, the full fitment list, up to three photos, and
 * Amaron's own price terms next to the MRP. Combos are not products: they are listed in `spec.combos` of the two
 * products that make them. No I/O here. What the brands share (years and eras, fitment texts, plan shapes) lives in
 * `../battery-import`.
 */
export const BRAND = { slug: 'amaron', name: 'Amaron' } as const;

/** Product type of the 11 rows the vehicle finder does not recommend for any vehicle. */
export const NOT_IN_FINDER = 'Battery not in the vehicle finder';

interface TypeInfo {
  code: string;
  category: CategoryRef;
  vehicleTypes: VehicleType[];
  hsn: string;
  en: string;
  hi: string;
}

/** Product type (CSV) → code, category, vehicle types and HSN (batteries 8507, Home UPS inverters 8504). */
const TYPES: Readonly<Record<string, TypeInfo>> = {
  'Car / SUV / MUV battery': {
    code: 'car_suv_muv_battery',
    category: 'bat|Car/SUV Battery',
    vehicleTypes: ['4W'],
    hsn: '8507',
    en: 'car, SUV and MUV battery',
    hi: 'कार, SUV और MUV बैटरी',
  },
  'Commercial vehicle (truck / bus) battery': {
    code: 'truck_bus_battery',
    category: 'bat|CV Battery',
    vehicleTypes: [],
    hsn: '8507',
    en: 'truck and bus (commercial vehicle) battery',
    hi: 'ट्रक और बस (व्यावसायिक वाहन) की बैटरी',
  },
  'Farm vehicle (tractor) battery': {
    code: 'tractor_battery',
    category: 'bat|Tractor Battery',
    vehicleTypes: [],
    hsn: '8507',
    en: 'tractor battery',
    hi: 'ट्रैक्टर की बैटरी',
  },
  'Earth moving equipment battery': {
    code: 'earth_moving_battery',
    category: EARTH_MOVING_CATEGORY,
    vehicleTypes: [],
    hsn: '8507',
    en: 'earth-moving and construction equipment battery',
    hi: 'अर्थ-मूविंग और कंस्ट्रक्शन मशीन की बैटरी',
  },
  'Two-wheeler battery': {
    code: 'two_wheeler_battery',
    category: 'bat|2-Wheeler Battery',
    vehicleTypes: ['2W'],
    hsn: '8507',
    en: 'two-wheeler battery',
    hi: 'दोपहिया वाहन की बैटरी',
  },
  'Three-wheeler battery': {
    code: 'three_wheeler_battery',
    category: 'bat|3-Wheeler Battery',
    vehicleTypes: ['3W'],
    hsn: '8507',
    en: 'three-wheeler battery',
    hi: 'तिपहिया वाहन की बैटरी',
  },
  'Inverter battery': {
    code: 'inverter_battery',
    category: 'home',
    vehicleTypes: [],
    hsn: '8507',
    en: 'inverter battery',
    hi: 'इन्वर्टर बैटरी',
  },
  'Home UPS inverter': {
    code: 'home_ups_inverter',
    category: 'home',
    vehicleTypes: [],
    hsn: '8504',
    en: 'home UPS inverter',
    hi: 'होम UPS इन्वर्टर',
  },
};

/**
 * The vehicle-battery types a "not in the finder" row can be sorted into, in the order a tie is broken (the first
 * wins). The rule is in `typeOfUnlisted`.
 */
const VEHICLE_TYPES_ORDER = [
  'Car / SUV / MUV battery',
  'Commercial vehicle (truck / bus) battery',
  'Farm vehicle (tractor) battery',
  'Earth moving equipment battery',
  'Three-wheeler battery',
  'Two-wheeler battery',
] as const;

/** Batteries under this capacity (Ah) are motorcycle-size and do not vote for a car or truck range. */
const SMALL_AH = 20;

/** Fitment vehicle types of the finder (Amaron's words) → the codes of `spec.fitment`. */
const FITMENT_TYPES: Readonly<Record<string, string>> = {
  'Car / SUV / MUV': 'car_suv_muv',
  'Commercial vehicle': 'lcv_hcv',
  'Farm vehicle': 'tractor',
  'Earth moving equipment': 'earth_moving',
  'Two-wheeler': 'two_wheeler',
  'Three-wheeler': 'three_wheeler',
  Genset: 'genset',
};

const ACRONYMS = new Set(['HUPS', 'UPS', 'AGM', 'EFB', 'SMF', 'HB', 'HE']);

const titleWord = (word: string) => titleWordWith(word, ACRONYMS);

/** The name as Amaron writes it, in title case ("Amaron BLACK BL400LMF" → "Amaron Black BL400LMF"); codes stay as written. */
function titleName(raw: string): { en: string; hi: string } {
  const words = raw.split(/\s+/).filter((w) => w !== '');
  const en = words.map(titleWord);
  const hi = words.map((w, i) => NAME_WORDS_HI[w.toLowerCase()] ?? en[i] ?? w);
  return { en: en.join(' '), hi: hi.join(' ') };
}

/** The range as Amaron titles it: "Amaron BLACK" → "Amaron Black"; a range without the brand gets it in front. */
export function rangeTitle(range: string): { en: string; hi: string } {
  const tokens = range.split(/\s+/).filter((t) => t !== '');
  const rest = tokens[0]?.toLowerCase() === 'amaron' ? tokens.slice(1) : tokens;
  const name = titleName(rest.join(' '));
  return { en: `Amaron ${name.en}`, hi: `Amaron ${name.hi}` };
}

const rupees = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Combo of a Home UPS inverter and an inverter battery (a row of `amaron_home_ups_combos.csv`). */
export interface AmaronCombo {
  withItemCode: string;
  withName: string;
  comboMrpPaise: number;
  comboSellingPaise: number;
  backupMinutes: number | null;
  comboDiscountPaise: number;
  discountValid: string | null;
  oldBatteryRebatePaise: number;
}

export interface NotInFinderRow {
  slug: string;
  name: string;
  category: string;
  rule: string;
}

export interface AmaronPlan extends BatteryPlan {
  /** Rows of the combos file, and how many of them were attached to products (all, unless an item code is unknown). */
  combos: { total: number; attached: number; unmatched: number };
  /** The rows the finder does not list and the category each was given. */
  notInFinder: NotInFinderRow[];
}

export interface AmaronPlanInput {
  batteries: readonly CsvRow[];
  fitment: readonly CsvRow[];
  combos: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; a missing one is left out, no picture = draft. */
  pictureExists?: (file: string) => boolean;
}

/** "(ES)" / "(KS)" in a two-wheeler model (also before a "(BS6)"): how the bike starts. */
const START = /\s*\((ES|KS)\)/;
/** A year written in brackets at the end of a model ("(From 2012)", "(Upto 2016)", "(2016 to 2017)", "(2019)"). */
const YEAR_PAREN =
  /\s*\((?:(?:from|up\s?to|till)\s+)?(?:19|20)\d\d(?:\s*(?:to|-)\s*(?:19|20)\d\d)?(?:\s+onwards)?\)\s*$/i;

/** A norm written in brackets at the end of a model ("(BS6)", "(BS 4)"). */
const BS_PAREN = /\s*\(BS\s?(?:6|VI|4|IV|3|III|2|II)\)\s*$/i;

/**
 * The model as the finder shows it, without the start type and without a year or BS norm the "model year / era"
 * column already holds.
 */
function cleanModel(
  raw: string,
  twoWheeler: boolean,
  era: { hasYears: boolean; hasBs: boolean },
): { model: string; start: string | null } {
  let model = raw.trim();
  let start: string | null = null;
  if (twoWheeler) {
    const s = START.exec(model);
    if (s?.[1]) {
      start = s[1];
      model = `${model.slice(0, s.index)} ${model.slice(s.index + s[0].length)}`.replace(/\s+/g, ' ').trim();
    }
  }
  if (era.hasYears) model = model.replace(YEAR_PAREN, '').trim();
  if (era.hasBs) model = model.replace(BS_PAREN, '').trim();
  return { model, start };
}

function warrantySplit(total: number | null, free: number | null, pro: number | null) {
  if (total === null || free === null || pro === null) return null;
  return free + pro === total ? { free, pro } : null;
}

const viewOf = (file: string): (typeof VIEWS)[string] | null => {
  const m = /-\s*(Front|Side|Top|View)\.[A-Za-z]+$/i.exec(file);
  return m?.[1] ? (VIEWS[m[1].toLowerCase()] ?? null) : null;
};

/** The photos of a row in gallery order (Front, Side, Top), one per file, with where each came from. */
function photosOf(
  b: CsvRow,
  name: string,
  nameHi: string,
  exists: (file: string) => boolean,
): { photos: PlannedPhoto[]; kinds: Record<string, 'own' | 'shared'>; mainShared: boolean } {
  const files = (b['Picture files'] ?? '').split(' | ').map((f) => f.trim());
  const urls = (b['Picture URLs'] ?? '').split(' | ').map((u) => u.trim());
  const notes = (b['Picture notes'] ?? '').split('; ').map((n) => n.trim());
  const seen = new Set<string>();
  const items: { file: string; url: string; view: (typeof VIEWS)[string]; shared: boolean }[] = [];
  files.forEach((file, i) => {
    if (file === '' || seen.has(file) || !exists(file)) return;
    seen.add(file);
    const view = viewOf(file) ?? VIEWS.view;
    if (!view) return;
    items.push({
      file,
      url: (urls[i] ?? '').slice(0, 500),
      view,
      shared: /same photo/i.test(notes[i] ?? ''),
    });
  });
  items.sort((a, c) => a.view.rank - c.view.rank);
  const kinds: Record<string, 'own' | 'shared'> = {};
  const photos = items.map((it) => {
    kinds[it.view.code] = it.shared ? 'shared' : 'own';
    return {
      file: it.file,
      sourceUrl: it.url,
      alt: `${name} (${it.view.en})`,
      altHi: `${nameHi} (${it.view.hi})`,
    };
  });
  return { photos, kinds, mainShared: items[0]?.shared ?? false };
}

export function planAmaron(input: AmaronPlanInput): AmaronPlan {
  const exists = input.pictureExists ?? (() => true);
  const byItem = new Map(input.batteries.map((b) => [b['Item code'] ?? '', b]));
  const byName = new Map(input.batteries.map((b) => [b['Battery name'] ?? '', b]));

  // Fitment per battery (item code, else name), once.
  const byBattery = new Map<string, BatteryFitment[]>();
  const discountValid = new Map<string, string>();
  const vehicleWords = new Set<string>();
  const seenFit = new Set<string>();
  let orphanFitment = 0;
  for (const f of input.fitment) {
    const owner = byItem.get(f['Item code'] ?? '') ?? byName.get(f.Battery ?? '');
    const key = owner?.['Item code'];
    if (!owner || !key) {
      orphanFitment += 1;
      continue;
    }
    const type = FITMENT_TYPES[f['Vehicle type'] ?? ''];
    const make = (f.Make ?? '').trim();
    const era = parseEra(f['Model year / era (from the name)'] ?? '');
    const { model, start } = cleanModel(f.Model ?? '', type === 'two_wheeler', {
      hasYears: era.yearFrom !== null || era.yearTo !== null,
      hasBs: era.era?.startsWith('bs') ?? false,
    });
    if (!type || make === '' || model === '') {
      orphanFitment += 1;
      continue;
    }
    if ((f['Discount valid'] ?? '') !== '' && !discountValid.has(key))
      discountValid.set(key, f['Discount valid'] ?? '');
    const entry: BatteryFitment = {
      type,
      make,
      model,
      fuel: start ? fuelCode(start) : fuelCode(f.Fuel ?? ''),
      yearFrom: era.yearFrom,
      yearTo: era.yearTo,
      era: era.era,
    };
    const dedupe = `${key}|${type}|${make}|${model}|${entry.fuel ?? ''}|${String(entry.yearFrom)}|${String(entry.yearTo)}|${entry.era ?? ''}`;
    if (seenFit.has(dedupe)) continue;
    seenFit.add(dedupe);
    byBattery.set(key, [...(byBattery.get(key) ?? []), entry]);
  }
  for (const list of byBattery.values()) {
    sortFitment(list);
    addVehicleWords(list, vehicleWords);
  }

  // "Battery not in the vehicle finder": the product type of the listed batteries of the same range and size class.
  const small = (b: CsvRow) => {
    const cap = num(b['Capacity (Ah)']);
    return cap !== null && cap < SMALL_AH;
  };
  const votes = new Map<string, Map<string, number>>();
  for (const b of input.batteries) {
    const t = b['Product type'] ?? '';
    if (!(VEHICLE_TYPES_ORDER as readonly string[]).includes(t)) continue;
    const k = `${b.Range ?? ''}|${String(small(b))}`;
    const m = votes.get(k) ?? new Map<string, number>();
    m.set(t, (m.get(t) ?? 0) + 1);
    votes.set(k, m);
  }
  /** The most common type of the same range and size class; a tie goes to the first of `VEHICLE_TYPES_ORDER`; none = car. */
  const typeOfUnlisted = (b: CsvRow): { type: string; rule: string } => {
    const m = votes.get(`${b.Range ?? ''}|${String(small(b))}`);
    if (!m)
      return { type: VEHICLE_TYPES_ORDER[0], rule: 'no listed battery of this range: car, SUV and MUV' };
    const best = VEHICLE_TYPES_ORDER.map((t) => [t, m.get(t) ?? 0] as const)
      .filter(([, n]) => n > 0)
      .sort((a, c) => c[1] - a[1])[0];
    const type = best?.[0] ?? VEHICLE_TYPES_ORDER[0];
    return { type, rule: `most common type of the listed ${b.Range ?? ''} batteries of this size: ${type}` };
  };

  // Combos per product, once (the two products that make a combo each list it).
  const combosOf = new Map<string, AmaronCombo[]>();
  let attached = 0;
  let unmatched = 0;
  const nameOfItem = (item: string, fallback: string) => {
    const row = byItem.get(item);
    return row ? titleName(row['Battery name'] ?? fallback).en : fallback;
  };
  for (const c of input.combos) {
    const ups = c['Home UPS item code'] ?? '';
    const bat = c['Battery item code'] ?? '';
    const mrp = paise(c['Combo MRP / list price incl. GST (Rs)']);
    const selling = paise(c['Combo selling price incl. GST (Rs)']);
    if (!byItem.has(ups) || !byItem.has(bat) || mrp === null || selling === null) {
      unmatched += 1;
      continue;
    }
    attached += 1;
    for (const item of [ups, bat])
      if ((c['Discount valid'] ?? '') !== '' && !discountValid.has(item))
        discountValid.set(item, c['Discount valid'] ?? '');
    const base = {
      comboMrpPaise: mrp,
      comboSellingPaise: selling,
      backupMinutes: num(c['Backup duration (min)']),
      comboDiscountPaise: paise(c['Special discount (Rs)']) ?? 0,
      discountValid: (c['Discount valid'] ?? '') === '' ? null : (c['Discount valid'] ?? ''),
      oldBatteryRebatePaise: paise(c['Old battery return rebate, up to (Rs)']) ?? 0,
    };
    combosOf.set(ups, [
      ...(combosOf.get(ups) ?? []),
      { withItemCode: bat, withName: nameOfItem(bat, c['Inverter battery'] ?? ''), ...base },
    ]);
    combosOf.set(bat, [
      ...(combosOf.get(bat) ?? []),
      { withItemCode: ups, withName: nameOfItem(ups, c['Home UPS'] ?? ''), ...base },
    ]);
  }

  const slugs = new Set<string>();
  const skus = new Set<string>();
  const untranslated = new Set<string>();
  const products: PlannedProduct[] = [];
  const rows: ReportRow[] = [];
  const notInFinder: NotInFinderRow[] = [];
  let slugCollisions = 0;
  let skuCollisions = 0;

  input.batteries.forEach((b, index) => {
    const sourceRow = index + 1;
    const typeName = b['Product type'] ?? '';
    const unlisted = typeName === NOT_IN_FINDER;
    const decided = unlisted ? typeOfUnlisted(b) : { type: typeName, rule: '' };
    const info = TYPES[decided.type];
    // The Home UPS rows have no Model column: the model is the first code (a word with a digit) of the name.
    const listedModel = (b.Model ?? '').trim();
    const model =
      listedModel !== ''
        ? listedModel
        : ((b['Battery name'] ?? '').split(/\s+/).find((w) => /\d/.test(w)) ?? '');
    const itemCode = (b['Item code'] ?? '').trim();
    if (!info || model === '' || itemCode === '')
      throw new Error(`Row ${String(sourceRow)}: unknown product type, no model or no item code`);
    const title = titleName(b['Battery name'] ?? '');
    const name = title.en;
    const nameHi = title.hi;
    const range = rangeTitle(b.Range ?? '');
    const rangeName = range.en;

    let slug = slugify(name);
    if (slugs.has(slug)) {
      slugCollisions += 1;
      let n = 2;
      while (slugs.has(`${slug}-${String(n)}`)) n += 1;
      slug = `${slug}-${String(n)}`;
    }
    slugs.add(slug);
    let sku = `AMARON-${norm(itemCode)}`;
    if (skus.has(sku)) {
      skuCollisions += 1;
      sku = `${sku}-${String(sourceRow)}`;
    }
    skus.add(sku);

    const category = categoryFor(info.category);
    if (unlisted) notInFinder.push({ slug, name, category: category.slug, rule: decided.rule });

    const totalM = num(b['Total warranty (months)']);
    const freeM = num(b['Free replacement warranty (months)']);
    const proRaw = (b['Pro-rata warranty (months)'] ?? '').trim();
    const proM = proRaw === '0' ? 0 : num(proRaw);
    const warrantyMonths = totalM !== null && totalM >= 12 ? totalM : null;
    const split = warrantyMonths === null ? null : warrantySplit(totalM, freeM, proM);
    const capacityAh = num(b['Capacity (Ah)']);
    const ccaA = num(b['CCA (A)']);
    const voltageV = num(b['Voltage (V)']);
    const lengthMm = num(b['Length (mm)']);
    const widthMm = num(b['Width (mm)']);
    const heightMm = num(b['Height (mm)']);
    const layout = (b['Terminal layout'] ?? '').trim().toLowerCase();
    const terminal = layout === 'l-layout' ? 'left' : layout === 'r-layout' ? 'right' : '';
    const technology = (b.Technology ?? '').trim();
    const formFactor = (b['Form factor'] ?? '').trim();
    const backupMinutes = num(b['Backup duration (min, as listed by Amaron)']);
    const fit = byBattery.get(itemCode) ?? [];
    const combos = combosOf.get(itemCode) ?? [];
    const mrp = num(b['MRP / list price incl. GST (Rs)']);
    const sellingPaise = paise(b['Selling price incl. GST (Rs)']);
    const rebatePaise = paise(b['Old battery return rebate, up to (Rs)']);
    const gstRateM = /^(\d+(?:\.\d+)?)\s*%$/.exec((b['GST rate'] ?? '').trim());
    const gstRateBp = gstRateM?.[1] ? Math.round(Number(gstRateM[1]) * 100) : 1800;
    const { photos, kinds, mainShared } = photosOf(b, name, nameHi, exists);
    /** `range` = the main photo is shared with other products (so it may not show this exact model). */
    const photoKind = mainShared ? 'range' : 'model';

    const spec: Record<string, unknown> = { source: 'amaron', productType: info.code, model, itemCode };
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') spec[key] = value;
    };
    put('listedProductType', typeName);
    if (unlisted) {
      spec.inVehicleFinder = false;
      spec.categoryRule = decided.rule;
    }
    put('productPage', b['Product page']);
    put('sourceProductId', b['Product id']);
    put('rangeName', rangeName);
    put('series', b.Series);
    put('voltageV', voltageV);
    put('capacityAh', capacityAh);
    put('ccaA', ccaA);
    put('lengthMm', lengthMm);
    put('widthMm', widthMm);
    put('heightMm', heightMm);
    put('terminalLayout', terminal);
    put('technology', technology);
    put('formFactor', formFactor === '' ? '' : formFactor.toLowerCase().replace(/\s+/g, '_'));
    put('backupMinutes', backupMinutes);
    put('warrantyTotalMonths', warrantyMonths);
    put('warrantyFreeMonths', split?.free);
    put('warrantyProRataMonths', split?.pro);
    put('finderVehicles', num(b['Vehicles it is recommended for']));
    put('photoKind', photos.length > 0 ? photoKind : '');
    if (photos.length > 0) spec.photoKinds = kinds;
    // A row Amaron lists at 0 (the two AR tall tubular batteries) has no price: price on request, no price terms.
    if (mrp !== null)
      spec.amaronPrice = {
        sellingPaise,
        discountPaise: paise(b['Special discount (Rs)']),
        discountValid: discountValid.get(itemCode) ?? null,
        oldBatteryRebatePaise: rebatePaise,
        priceBeforeGstPaise: paise(b['Price before GST (Rs)']),
        gstRateBp,
      };
    if (combos.length > 0) spec.combos = combos;
    if (fit.length > 0) spec.fitment = fit;

    // Facts: one list feeds the highlights, the specification paragraph and the one-line summary.
    const facts: Fact[] = [];
    const fact = (key: string, labelEn: string, labelHi: string, valueEn: string, valueHi = valueEn) =>
      facts.push({ key, labelEn, labelHi, valueEn, valueHi });
    if (warrantyMonths !== null)
      fact(
        'warranty',
        'Total warranty',
        'कुल वारंटी',
        `${String(warrantyMonths)} months` +
          (split
            ? split.pro === 0
              ? ` (${String(split.free)} months free replacement)`
              : ` (${String(split.free)} months free replacement + ${String(split.pro)} months pro-rata)`
            : ''),
        monthsHi(warrantyMonths) +
          (split
            ? split.pro === 0
              ? ` (${monthsHi(split.free)} फ़्री रिप्लेसमेंट)`
              : ` (${monthsHi(split.free)} फ़्री रिप्लेसमेंट + ${monthsHi(split.pro)} आनुपातिक)`
            : ''),
      );
    if (capacityAh !== null) fact('capacity', 'Capacity', 'क्षमता', `${String(capacityAh)} Ah`);
    if (ccaA !== null) fact('cca', 'Cold cranking (CCA)', 'कोल्ड क्रैंकिंग (CCA)', `${String(ccaA)} A`);
    if (voltageV !== null) fact('voltage', 'Voltage', 'वोल्टेज', `${String(voltageV)} V`);
    if (lengthMm !== null && widthMm !== null && heightMm !== null) {
      const dims = `${String(lengthMm)} × ${String(widthMm)} × ${String(heightMm)}`;
      fact('size', 'Size (L × W × H)', 'आकार (L × W × H)', `${dims} mm`, `${dims} मिमी`);
    }
    if (terminal === 'left' || terminal === 'right')
      fact('terminal', 'Terminal', 'टर्मिनल', TERMINAL_EN[terminal] ?? '', TERMINAL_HI[terminal] ?? '');
    const techHi = TECHNOLOGY_HI[technology.toLowerCase()];
    if (technology !== '' && techHi) fact('technology', 'Technology', 'तकनीक', technology, techHi);
    const formHi = FORM_FACTOR_HI[formFactor.toLowerCase()];
    if (formFactor !== '' && formHi) fact('formFactor', 'Type', 'प्रकार', formFactor, formHi);
    if (backupMinutes !== null)
      fact(
        'backup',
        'Backup time',
        'बैकअप समय',
        `${String(backupMinutes)} minutes (as listed by Amaron)`,
        `${String(backupMinutes)} मिनट (Amaron के अनुसार)`,
      );
    const factOf = (key: string) => facts.find((f) => f.key === key);

    // Summary: capacity (or voltage), warranty, then terminal or size.
    const sumEn: string[] = [];
    const sumHi: string[] = [];
    const cap = factOf('capacity');
    const volts = factOf('voltage');
    const ter = factOf('terminal') ?? factOf('size');
    if (cap) {
      sumEn.push(cap.valueEn);
      sumHi.push(`क्षमता ${cap.valueHi}`);
    } else if (volts) {
      sumEn.push(volts.valueEn);
      sumHi.push(`वोल्टेज ${volts.valueHi}`);
    }
    if (warrantyMonths !== null) {
      sumEn.push(`${String(warrantyMonths)} months warranty`);
      sumHi.push(`वारंटी ${monthsHi(warrantyMonths)}`);
    }
    if (ter) {
      sumEn.push(ter.key === 'terminal' ? `${ter.valueEn} terminal` : ter.valueEn);
      sumHi.push(ter.key === 'terminal' ? `टर्मिनल ${ter.valueHi}` : ter.valueHi);
    }
    const specSummary = (sumEn.length > 0 ? sumEn : [info.en]).slice(0, 4).join(' · ');
    const specSummaryHi = (sumHi.length > 0 ? sumHi : [info.hi]).slice(0, 4).join(' · ');

    // Features, in both languages (a line with no Hindi is left out of both).
    const featsEn: string[] = [];
    const featsHi: string[] = [];
    for (const raw of (b.Features ?? '').split(/;\s*/)) {
      const line = cleanSpecText(raw).replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
      if (line === '') continue;
      const hit = FEATURES[line];
      if (!hit) {
        untranslated.add(line);
        continue;
      }
      featsEn.push(hit.en);
      featsHi.push(hit.hi);
    }

    // Old battery rebate and combos as highlights.
    const extra: [string, string][] = [];
    if (rebatePaise !== null && rebatePaise > 0) {
      const r = rupees(Math.round(rebatePaise / 100));
      extra.push([
        `Old battery exchange rebate up to ₹${r} at installation`,
        `पुरानी बैटरी देने पर इंस्टॉलेशन के समय ₹${r} तक की छूट`,
      ]);
    }
    if (combos.length > 0) {
      const n = String(combos.length);
      const withUps = info.code === 'inverter_battery';
      extra.push(
        withUps
          ? [
              `Also sold in ${n} combos with Amaron Home UPS inverters`,
              `Amaron होम UPS इन्वर्टर के साथ ${n} कॉम्बो में भी उपलब्ध`,
            ]
          : [
              `Also sold in ${n} combos with Amaron inverter batteries`,
              `Amaron इन्वर्टर बैटरी के साथ ${n} कॉम्बो में भी उपलब्ध`,
            ],
      );
    }
    const { highlights, highlightsHi } = highlightsOf(
      facts,
      ['warranty', 'capacity', 'cca', 'voltage', 'size', 'terminal', 'backup'],
      featsEn,
      featsHi,
      extra,
    );

    // Description.
    const descEn: string[] = [`${name}: ${info.en} by Amaron.`];
    const descHi: string[] = [`${nameHi}: Amaron की ${info.hi}।`];
    if (featsEn.length > 0) {
      descEn.push(`Features: ${featsEn.join('; ')}.`);
      descHi.push(`विशेषताएँ: ${featsHi.join('; ')}।`);
    }
    if (facts.length > 0) {
      descEn.push(`Specifications: ${facts.map((f) => `${f.labelEn} ${f.valueEn}`).join('; ')}.`);
      descHi.push(`तकनीकी जानकारी: ${facts.map((f) => `${f.labelHi} ${f.valueHi}`).join('; ')}।`);
    }
    if (extra[0] && rebatePaise !== null && rebatePaise > 0) {
      descEn.push(`${extra[0][0]}.`);
      descHi.push(`${extra[0][1]}।`);
    }

    const { compatibility, compatibilityHi } = compatibilityTexts(fit);
    const draft = photos.length === 0;
    const first = photos[0] ?? null;
    const modelPart = mfrPart(model);
    const itemPart = mfrPart(itemCode);
    const partNumbers = [
      modelPart,
      ...(itemPart.normalised !== modelPart.normalised ? [itemPart] : []),
    ].filter((n) => n.normalised !== '');
    const pack: PlannedVariant = {
      sku,
      model,
      mrpPaise: mrp === null ? null : Math.round(mrp * 100),
      weightG: null,
      netQuantity: { qty: 1, unit: 'piece' },
      options: { model },
      barcode: null,
      partNumbers,
    };
    const product: PlannedProduct = {
      sourceRow,
      productType: info.code,
      slug,
      range: { slug: slugify(rangeName), name: rangeName, nameHi: range.hi },
      category,
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
      warranty: warrantyMonths === null ? null : `${String(warrantyMonths)} months`,
      hsn: info.hsn,
      gstRateBp,
      status: draft ? 'draft' : 'live',
      variant: pack,
      variants: [pack],
      partNumbers,
      partNumber: modelPart,
      photos,
      photo: first,
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
      category: category.slug,
      mrpRupees: mrp === null ? '' : String(mrp),
      warrantyMonths: warrantyMonths === null ? '' : String(warrantyMonths),
      fitmentCount: fit.length,
      photoFile: first?.file ?? '',
      photoKind: first ? photoKind : 'model',
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
    combos: { total: input.combos.length, attached, unmatched },
    notInFinder,
  };
}

/** Hindi texts of the plan that still hold English words (hard rule 10; see `planHindiLeftovers`). */
export const amaronHindiLeftovers = planHindiLeftovers;
