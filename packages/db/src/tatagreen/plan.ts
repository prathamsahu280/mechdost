import { slugify } from '@mechdost/shared/catalogue-import';
import type { VehicleType } from '@mechdost/shared/vehicles';
import {
  addVehicleWords,
  categoryFor,
  compatibilityTexts,
  highlightsOf,
  INDUSTRIAL_CATEGORY,
  mfrPart,
  monthsHi,
  norm,
  num,
  paise,
  parseEra,
  planHindiLeftovers,
  sortFitment,
  titleWord as titleWordWith,
  type BatteryFitment,
  type BatteryPlan,
  type CategoryRef,
  type CsvRow,
  type Fact,
  type PlannedPhoto,
  type PlannedProduct,
  type ReportRow,
} from '../battery-import';
import { NAME_WORDS_HI, RANGES } from './hindi';

/**
 * Tata Green catalogue plan (user 2026-11-24, runbook `catalogue-import.md` "Tata Green import"): the pure step that
 * turns `tatagreen_batteries.csv` and `tatagreen_vehicle_fitment.csv` into what the database should hold: one product per
 * source row named as Tata Green names it ("Tata Green Premio 40B20L PR2436"), one pack, the model as manufacturer
 * part number, typed specs, the vehicle fitment, one photo, and Tata Green's offer price next to the MRP. No I/O here.
 * What the brands share lives in `../battery-import`.
 */
export const BRAND = { slug: 'tata-green', name: 'Tata Green' } as const;

interface TypeInfo {
  code: string;
  category: CategoryRef;
  vehicleTypes: VehicleType[];
  hsn: string;
  en: string;
  hi: string;
}

const T = (
  code: string,
  category: CategoryRef,
  vehicleTypes: VehicleType[],
  hsn: string,
  en: string,
  hi: string,
): TypeInfo => ({ code, category, vehicleTypes, hsn, en, hi });

/** Product type (CSV) → code, category, vehicle types and HSN (batteries 8507, Home UPS inverters 8504). */
const TYPES: Readonly<Record<string, TypeInfo>> = {
  'Car / SUV / MUV battery': T(
    'car_suv_muv_battery',
    'bat|Car/SUV Battery',
    ['4W'],
    '8507',
    'car, SUV and MUV battery',
    'कार, SUV और MUV बैटरी',
  ),
  'Commercial vehicle battery': T(
    'truck_bus_battery',
    'bat|CV Battery',
    [],
    '8507',
    'truck and bus (commercial vehicle) battery',
    'ट्रक और बस (व्यावसायिक वाहन) की बैटरी',
  ),
  'Tractor battery': T(
    'tractor_battery',
    'bat|Tractor Battery',
    [],
    '8507',
    'tractor battery',
    'ट्रैक्टर की बैटरी',
  ),
  'Two-wheeler battery': T(
    'two_wheeler_battery',
    'bat|2-Wheeler Battery',
    ['2W'],
    '8507',
    'two-wheeler battery',
    'दोपहिया वाहन की बैटरी',
  ),
  'E-rickshaw battery': T(
    'e_rickshaw_battery',
    'bat|E-Rickshaw Battery',
    [],
    '8507',
    'lithium e-rickshaw battery',
    'लिथियम ई-रिक्शा बैटरी',
  ),
  'Genset battery': T(
    'genset_battery',
    'bat|Genset Battery',
    [],
    '8507',
    'genset battery',
    'जेनसेट की बैटरी',
  ),
  'Industrial battery': T(
    'industrial_battery',
    INDUSTRIAL_CATEGORY,
    [],
    '8507',
    'sealed industrial battery',
    'सीलबंद औद्योगिक बैटरी',
  ),
  'Inverter battery': T('inverter_battery', 'home', [], '8507', 'inverter battery', 'इन्वर्टर बैटरी'),
  'Home UPS inverter': T('home_ups_inverter', 'home', [], '8504', 'home UPS inverter', 'होम UPS इन्वर्टर'),
};

/**
 * What the product's own name on the site says it is (its last words), which wins over the product type of the
 * listing page where both are about vehicles (Tata Green lists the TG car batteries under "commercial", the Jeevan
 * tractor batteries under "commercial", and so on).
 */
const SITE_NAME_TYPES: readonly [RegExp, string][] = [
  [/\b(?:Car|SUV) Battery\??$/i, 'Car / SUV / MUV battery'],
  [/\bCommercial Vehicle Battery\??$/i, 'Commercial vehicle battery'],
  [/\bTractor Battery\??$/i, 'Tractor battery'],
];
const VEHICLE_LISTINGS = new Set([
  'Car / SUV / MUV battery',
  'Commercial vehicle battery',
  'Tractor battery',
]);

/** Fitment vehicle types of the finder → the codes of `spec.fitment`. Industrial and Inverter / UPS rows are the product itself, not vehicles. */
const FITMENT_TYPES: Readonly<Record<string, string>> = {
  'Car / SUV / MUV': 'car_suv_muv',
  'Commercial vehicle': 'lcv_hcv',
  Tractor: 'tractor',
  'Two-wheeler': 'two_wheeler',
};
const NOT_VEHICLES = new Set(['Industrial', 'Inverter / UPS']);

const ACRONYMS = new Set([
  'TGUPS',
  'SLV',
  'TGI',
  'TGX',
  'TG',
  'ISS',
  'ADV',
  'TVS',
  'BH',
  'UPS',
  'MSIL',
  'CV',
  'KVA',
]);

/** Words written in capitals in the source that are not acronyms are title-cased; words with a lower-case letter keep their spelling ("SwitchOn", "(IoT)"). */
const titleWord = (word: string) => (/[a-z]/.test(word) ? word : titleWordWith(word, ACRONYMS));

/** The name as Tata Green writes it, in title case, without the stray "?" the site has on one product. */
function titleName(raw: string): { en: string; hi: string } {
  const words = raw
    .replace(/\?+$/, '')
    .split(/\s+/)
    .filter((w) => w !== '');
  const en = words.map(titleWord);
  const hi = en.map((w) => {
    const m = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(w);
    const core = m?.[2] ?? w;
    const hit = NAME_WORDS_HI[core.toLowerCase()];
    return hit ? `${m?.[1] ?? ''}${hit}${m?.[3] ?? ''}` : w;
  });
  return { en: en.join(' '), hi: hi.join(' ') };
}

/** The range of the source grouped as Tata Green's names read ("TG350L" → "Tata Green TG"). */
export function rangeTitle(range: string): { en: string; hi: string } {
  const hit = RANGES[range.trim().toLowerCase()];
  if (!hit) throw new Error(`Unknown Tata Green range: ${range}`);
  return { en: `Tata Green ${hit.en}`, hi: `Tata Green ${hit.hi}` };
}

const parseMonths = (text: string | undefined) => {
  const t = (text ?? '').trim();
  const free = /(\d+)\s*Months\s+Free Replacement/i.exec(t);
  const pro = /\+\s*(\d+)\s*Months\s+Pro-rata/i.exec(t);
  const whole = /^(\d+)\s*Months\s+Warranty/i.exec(t);
  if (free?.[1]) {
    const f = Number(free[1]);
    const p = pro?.[1] ? Number(pro[1]) : 0;
    return { total: f + p, free: f, pro: p };
  }
  if (whole?.[1]) return { total: Number(whole[1]), free: null, pro: null };
  return null;
};

/** "12%" → 1200 basis points. */
const discountBp = (text: string | undefined) => {
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec((text ?? '').trim());
  return m?.[1] ? Math.round(Number(m[1]) * 100) : null;
};

export interface ReclassifiedRow {
  slug: string;
  name: string;
  listedAs: string;
  category: string;
  rule: string;
}

export interface TataGreenPlan extends BatteryPlan {
  /** Rows whose category follows the name the site gives them, not the listing page. */
  reclassified: ReclassifiedRow[];
  /** Products planned without a picture: no file, or only the site's placeholder image. */
  noPhoto: { slug: string; name: string; reason: 'no_file' | 'placeholder' }[];
}

export interface TataGreenPlanInput {
  batteries: readonly CsvRow[];
  fitment: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; a missing one is left out, no picture = draft. */
  pictureExists?: (file: string) => boolean;
  /** Picture paths that are the site's grey "picture not available" image: treated as no picture. */
  placeholderPictures?: readonly string[];
}

export function planTataGreen(input: TataGreenPlanInput): TataGreenPlan {
  const exists = input.pictureExists ?? (() => true);
  const placeholders = new Set(input.placeholderPictures ?? []);
  const byName = new Map(input.batteries.map((b) => [b['Battery name'] ?? '', b]));

  // Fitment per battery (by name), once.
  const byBattery = new Map<string, BatteryFitment[]>();
  const vehicleWords = new Set<string>();
  const seenFit = new Set<string>();
  let orphanFitment = 0;
  for (const f of input.fitment) {
    const kind = f['Vehicle type'] ?? '';
    if (NOT_VEHICLES.has(kind)) continue;
    const key = f.Battery ?? '';
    const type = FITMENT_TYPES[kind];
    const make = (f.Make ?? '').trim();
    const model = (f.Model ?? '').trim();
    if (!byName.has(key) || !type || make === '' || model === '') {
      orphanFitment += 1;
      continue;
    }
    const era = parseEra(f['Model year / era (from the name)'] ?? '');
    const entry: BatteryFitment = {
      type,
      make,
      model,
      fuel: null,
      yearFrom: era.yearFrom,
      yearTo: era.yearTo,
      era: era.era,
    };
    const dedupe = `${key}|${type}|${make}|${model}|${String(entry.yearFrom)}|${String(entry.yearTo)}|${entry.era ?? ''}`;
    if (seenFit.has(dedupe)) continue;
    seenFit.add(dedupe);
    byBattery.set(key, [...(byBattery.get(key) ?? []), entry]);
  }
  for (const list of byBattery.values()) {
    sortFitment(list);
    addVehicleWords(list, vehicleWords);
  }

  const slugs = new Set<string>();
  const skus = new Set<string>();
  const products: PlannedProduct[] = [];
  const rows: ReportRow[] = [];
  const reclassified: ReclassifiedRow[] = [];
  const noPhoto: TataGreenPlan['noPhoto'] = [];
  let slugCollisions = 0;
  let skuCollisions = 0;

  input.batteries.forEach((b, index) => {
    const sourceRow = index + 1;
    const listed = b['Product type'] ?? '';
    const siteName = (b['Name on site'] ?? '').trim();
    const bySite = VEHICLE_LISTINGS.has(listed)
      ? SITE_NAME_TYPES.find(([re]) => re.test(siteName))?.[1]
      : undefined;
    const typeName = bySite ?? listed;
    const info = TYPES[typeName];
    // The three big Home UPS units have a Model column without their code ("48V 3.5KVA" for "TGUPS 48V 3.5KVA").
    const listedModel = (b.Model ?? '').trim();
    const model =
      listedModel !== '' &&
      (b['Battery name'] ?? '').toUpperCase().includes(`TGUPS ${listedModel.toUpperCase()}`)
        ? `TGUPS ${listedModel}`
        : listedModel;
    if (!info || model === '') throw new Error(`Row ${String(sourceRow)}: unknown product type or no model`);
    const title = titleName(b['Battery name'] ?? '');
    const name = title.en;
    const nameHi = title.hi;
    const range = rangeTitle(b.Range ?? '');

    let slug = slugify(name);
    if (slugs.has(slug)) {
      slugCollisions += 1;
      let n = 2;
      while (slugs.has(`${slug}-${String(n)}`)) n += 1;
      slug = `${slug}-${String(n)}`;
    }
    slugs.add(slug);
    let sku = `TATAGREEN-${norm((b['Battery name'] ?? '').replace(/^Tata Green\s+/i, ''))}`;
    if (skus.has(sku)) {
      skuCollisions += 1;
      sku = `${sku}-${String(sourceRow)}`;
    }
    skus.add(sku);

    const category = categoryFor(info.category);
    if (bySite && bySite !== listed)
      reclassified.push({
        slug,
        name,
        listedAs: listed,
        category: category.slug,
        rule: `the site names it "${siteName}"; its listing page says "${listed}"`,
      });

    const warranty = parseMonths(b.Warranty);
    const warrantyMonths = warranty && warranty.total >= 12 ? warranty.total : null;
    const isUps = info.code === 'home_ups_inverter';
    const capacityAh = isUps ? null : num(b['Capacity (Ah)']);
    // The CSV fills Voltage with 12 on every row, also for UPS units named 48 V / 96 V / 120 V and for the lithium e-rickshaw
    // battery: only the name states a UPS voltage, and the e-rickshaw voltage is not known.
    const nameVolts = /(\d+)\s*V\b/i.exec(b['Battery name'] ?? '')?.[1];
    const voltageV = isUps
      ? nameVolts
        ? Number(nameVolts)
        : null
      : info.code === 'e_rickshaw_battery'
        ? null
        : num(b['Voltage (V)']);
    const ratingMatch = /Rating shown as capacity:\s*(\d+(?:\.\d+)?)\s*Ah/i.exec(b['Other details'] ?? '');
    const ratingVa = isUps && ratingMatch?.[1] ? Number(ratingMatch[1]) : null;
    const lengthMm = num(b['Length (mm)']);
    const widthMm = num(b['Width (mm)']);
    const heightMm = num(b['Height (mm)']);
    const fit = byBattery.get(b['Battery name'] ?? '') ?? [];
    const mrp = num(b['MRP incl. taxes (Rs)']);
    const offerPaise = paise(b['Offer price incl. taxes (Rs)']);

    // "Picture file" holds one file, or two or more joined by " | " (the first is the main photo).
    const files = (b['Picture file'] ?? '')
      .split(' | ')
      .map((f) => f.trim())
      .filter((f) => f !== '');
    const urls = (b['Picture URL'] ?? '').split(' | ').map((u) => u.trim());
    const photos: PlannedPhoto[] = [];
    files.forEach((file, i) => {
      if (placeholders.has(file) || !exists(file) || photos.some((p) => p.file === file)) return;
      const n = String(photos.length + 1);
      photos.push({
        file,
        sourceUrl: (urls[i] ?? '').slice(0, 500),
        alt: photos.length === 0 ? name : `${name} (photo ${n})`,
        altHi: photos.length === 0 ? nameHi : `${nameHi} (फ़ोटो ${n})`,
      });
    });
    if (photos.length === 0)
      noPhoto.push({
        slug,
        name,
        reason: files.some((f) => placeholders.has(f)) ? 'placeholder' : 'no_file',
      });
    const photoKind = /same photo/i.test(b['Picture note'] ?? '') ? 'range' : 'model';

    const spec: Record<string, unknown> = { source: 'tatagreen', productType: info.code, model };
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') spec[key] = value;
    };
    put('listedProductType', listed);
    if (bySite && bySite !== listed)
      put('categoryRule', `the site names it "${siteName}"; its listing page says "${listed}"`);
    put('productPage', b['Product page']);
    put('sourceProductId', b['Product id']);
    put('rangeName', range.en);
    put('voltageV', voltageV);
    put('capacityAh', capacityAh);
    put('ratingVa', ratingVa);
    put('lengthMm', lengthMm);
    put('widthMm', widthMm);
    put('heightMm', heightMm);
    put('warrantyTotalMonths', warrantyMonths);
    put('warrantyFreeMonths', warrantyMonths !== null ? warranty?.free : null);
    put('warrantyProRataMonths', warrantyMonths !== null ? warranty?.pro : null);
    put('finderVehicles', fit.length > 0 ? fit.length : null);
    put('photoKind', photos.length > 0 ? photoKind : '');
    if (mrp !== null && offerPaise !== null)
      spec.tataGreenPrice = {
        offerPaise,
        discountBp: discountBp(b['Discount shown']),
        gstIncluded: true,
        gstRateBp: 1800,
      };
    if (fit.length > 0) spec.fitment = fit;

    // Facts: one list feeds the highlights, the specification paragraph and the one-line summary.
    const facts: Fact[] = [];
    const fact = (key: string, labelEn: string, labelHi: string, valueEn: string, valueHi = valueEn) =>
      facts.push({ key, labelEn, labelHi, valueEn, valueHi });
    if (warrantyMonths !== null && warranty) {
      const { free, pro } = warranty;
      const splitEn =
        free === null
          ? ''
          : pro === 0
            ? ` (${String(free)} months free replacement)`
            : ` (${String(free)} months free replacement + ${String(pro)} months pro-rata)`;
      const splitHi =
        free === null
          ? ''
          : pro === 0
            ? ` (${monthsHi(free)} फ़्री रिप्लेसमेंट)`
            : ` (${monthsHi(free)} फ़्री रिप्लेसमेंट + ${monthsHi(pro)} आनुपातिक)`;
      fact(
        'warranty',
        'Total warranty',
        'कुल वारंटी',
        `${String(warrantyMonths)} months${splitEn}`,
        `${monthsHi(warrantyMonths)}${splitHi}`,
      );
    }
    if (capacityAh !== null) fact('capacity', 'Capacity', 'क्षमता', `${String(capacityAh)} Ah`);
    if (ratingVa !== null) fact('rating', 'Rating', 'रेटिंग', `${String(ratingVa)} VA`);
    if (voltageV !== null) fact('voltage', 'Voltage', 'वोल्टेज', `${String(voltageV)} V`);
    if (lengthMm !== null && widthMm !== null && heightMm !== null) {
      const dims = `${String(lengthMm)} × ${String(widthMm)} × ${String(heightMm)}`;
      fact('size', 'Size (L × W × H)', 'आकार (L × W × H)', `${dims} mm`, `${dims} मिमी`);
    }
    const factOf = (key: string) => facts.find((f) => f.key === key);

    // Summary: capacity (rating or voltage), warranty, then size.
    const sumEn: string[] = [];
    const sumHi: string[] = [];
    const lead = factOf('capacity') ?? factOf('rating');
    const volts = factOf('voltage');
    if (lead) {
      sumEn.push(lead.valueEn);
      sumHi.push(`${lead.labelHi} ${lead.valueHi}`);
    } else if (volts) {
      sumEn.push(volts.valueEn);
      sumHi.push(`वोल्टेज ${volts.valueHi}`);
    }
    if (warrantyMonths !== null) {
      sumEn.push(`${String(warrantyMonths)} months warranty`);
      sumHi.push(`वारंटी ${monthsHi(warrantyMonths)}`);
    }
    const size = factOf('size');
    if (size) {
      sumEn.push(size.valueEn);
      sumHi.push(size.valueHi);
    }
    const specSummary = (sumEn.length > 0 ? sumEn : [info.en]).slice(0, 4).join(' · ');
    const specSummaryHi = (sumHi.length > 0 ? sumHi : [info.hi]).slice(0, 4).join(' · ');

    const { highlights, highlightsHi } = highlightsOf(
      facts,
      ['warranty', 'capacity', 'rating', 'voltage', 'size'],
      [],
      [],
    );
    const descEn: string[] = [`${name}: ${info.en} by Tata Green.`];
    const descHi: string[] = [`${nameHi}: Tata Green की ${info.hi}।`];
    if (facts.length > 0) {
      descEn.push(`Specifications: ${facts.map((f) => `${f.labelEn} ${f.valueEn}`).join('; ')}.`);
      descHi.push(`तकनीकी जानकारी: ${facts.map((f) => `${f.labelHi} ${f.valueHi}`).join('; ')}।`);
    }

    const { compatibility, compatibilityHi } = compatibilityTexts(fit);
    const draft = photos.length === 0;
    const first = photos[0] ?? null;
    const modelPart = mfrPart(model);
    // "34B19L-M (MSIL Co-Branded)": the code alone is also a part number (a bracket with lower-case words is not part of the code).
    const codeOnly = model.replace(/\s*\([^)]*[a-z][^)]*\)/g, '').trim();
    const codePart = mfrPart(codeOnly);
    const partNumbers = [
      modelPart,
      ...(codePart.normalised !== modelPart.normalised ? [codePart] : []),
    ].filter((n) => n.normalised !== '');
    const product: PlannedProduct = {
      sourceRow,
      productType: info.code,
      slug,
      range: { slug: slugify(range.en), name: range.en, nameHi: range.hi },
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
      gstRateBp: 1800,
      status: draft ? 'draft' : 'live',
      variant: {
        sku,
        model,
        mrpPaise: mrp === null ? null : Math.round(mrp * 100),
        weightG: null,
        netQuantity: { qty: 1, unit: 'piece' },
        options: { model },
      },
      partNumbers,
      partNumber: modelPart,
      photos,
      photo: first,
      fitmentCount: fit.length,
    };
    products.push(product);
    rows.push({
      sourceRow,
      productType: listed,
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
    untranslated: [],
    vehicleWords,
    slugCollisions,
    skuCollisions,
    orphanFitment,
    reclassified,
    noPhoto,
  };
}

/** Hindi texts of the plan that still hold English words (hard rule 10; see `planHindiLeftovers`). */
export const tataGreenHindiLeftovers = planHindiLeftovers;
