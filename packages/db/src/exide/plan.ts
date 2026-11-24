import { hindiLeftovers } from '@mechdost/shared/catalogue-hindi';
import { slugify } from '@mechdost/shared/catalogue-import';
import type { VehicleType } from '@mechdost/shared/vehicles';
import {
  addVehicleWords,
  categoryFor,
  cleanSpecText,
  compatibilityTexts,
  csvRows,
  highlightsOf,
  mfrPart,
  norm,
  num,
  parseEra,
  parseModelYears,
  planHindiLeftovers,
  sortFitment,
  titleWord as titleWordWith,
  type BatteryFitment,
  type BatteryPlan,
  type CsvRow,
  type Fact,
  type PlannedProduct,
  type PlannedVariant,
  type ReportRow,
} from '../battery-import';
import {
  FEATURES_HI,
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
 * model code as the manufacturer part number, typed specs and the full fitment list. No I/O here. The parts every
 * battery brand shares (CSV reading, years and eras, fitment texts, plan shapes) live in `../battery-import`.
 */
export { csvRows, type CsvRow };
export {
  COMPATIBILITY_CAP,
  HOME_POWER,
  cleanSpecText,
  parseEra,
  parseModelYears,
  titleVehicle,
  yearText,
  type PlannedCategory,
} from '../battery-import';

export const BRAND = { slug: 'exide', name: 'Exide' } as const;

export type ExideFitment = BatteryFitment;
export type ExidePlannedProduct = PlannedProduct;
export type ExideReportRow = ReportRow;
export type ExidePlan = BatteryPlan;

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

const FITMENT_TYPES: Readonly<Record<string, string>> = {
  'Car / SUV / MUV': 'car_suv_muv',
  'LCV / HCV': 'lcv_hcv',
  Tractor: 'tractor',
  'Two-wheeler': 'two_wheeler',
  'Three-wheeler': 'three_wheeler',
  Genset: 'genset',
};

const GST_BP = 1800;

const ACRONYMS = new Set(['HUPS', 'GQP', 'HB', 'EL', 'UPS', 'LIB']);

/** Title case of the letter runs of one word ("E-RIDE" → "E-Ride", "HUPS" stays); words with digits are codes. */
function titleWord(word: string): string {
  if (!/\d/.test(word) && word.toUpperCase() === 'AGMI') return 'AGMi';
  return titleWordWith(word, ACRONYMS);
}

/** The range as Exide titles it: "EXIDE INVA ZEN" → "Exide Inva Zen"; a range without the brand gets it in front. */
export function rangeTitle(range: string): { en: string; hi: string; words: string[] } {
  const tokens = range.split(/\s+/).filter((t) => t !== '');
  const rest = tokens[0]?.toLowerCase() === 'exide' ? tokens.slice(1) : tokens;
  const words = rest.map(titleWord);
  const hi = rest.map((w) => RANGE_WORDS_HI[w.toLowerCase()] ?? titleWord(w));
  return { en: ['Exide', ...words].join(' '), hi: ['Exide', ...hi].join(' '), words };
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
    const type = FITMENT_TYPES[f['Vehicle type'] ?? ''];
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
  for (const list of byModel.values()) {
    sortFitment(list);
    addVehicleWords(list, vehicleWords);
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
    const { highlights, highlightsHi } = highlightsOf(
      facts,
      ['warranty', 'capacity', 'rating', 'ccaEn', 'size', 'weight', 'terminal'],
      featsEn,
      featsHi,
    );

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
    const { compatibility, compatibilityHi } = compatibilityTexts(fit);

    const draft = pictureFile === '' || !exists(pictureFile);
    const photo =
      pictureFile === ''
        ? null
        : {
            file: pictureFile,
            sourceUrl: ((b['Picture URL'] ?? '').split('|')[0] ?? '').trim().slice(0, 500),
            alt: name,
            altHi: nameHi,
          };
    const pack: PlannedVariant = {
      sku,
      model,
      mrpPaise: mrp === null ? null : Math.round(mrp * 100),
      weightG: weightKg === null ? null : Math.round(weightKg * 1000),
      netQuantity: { qty: 1, unit: 'piece' },
      options: { model },
      barcode: null,
      partNumbers: [mfrPart(model)],
    };
    const product: ExidePlannedProduct = {
      sourceRow,
      productType: info.code,
      slug,
      range: {
        slug: slugify(`exide-${rangeName.replace(/^Exide /, '')}`),
        name: rangeName,
        nameHi: rangeNameHi,
      },
      category: categoryFor(info.category),
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
      variant: pack,
      variants: [pack],
      partNumbers: [mfrPart(model)],
      partNumber: mfrPart(model),
      photos: photo ? [photo] : [],
      photo,
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

/** Hindi texts of the plan that still hold English words (hard rule 10; see `planHindiLeftovers`). */
export const exideHindiLeftovers = planHindiLeftovers;
