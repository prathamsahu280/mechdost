import { readFileSync } from 'node:fs';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { pictureExistsIn, readCsvFile, type CsvRow } from '../battery-import';
import { planLubeItems, type LubeBrand } from './build';
import { HP_HI } from './features-hi-hp';
import type { LubeCategory } from './kinds';
import {
  brandedName,
  featureLines,
  gradeText,
  hindiOfName,
  mergeItems,
  pictureHashIn,
  txt,
  withHindi,
} from './adapter';
import { ALLOWED_LATIN } from './hindi-allowed';
import { applyResearchedPacks, parseHpPacksCsv } from './packs-research';
import { pictureOf, pictureShares } from './picture';
import { cleanLubeName, gradeKey, propertiesOf, splitGrades } from './text';
import type { LubeCheck, LubeItem, LubePlan, SkipReason, SkippedRow } from './types';

/**
 * HP lubricant plan (user 2026-11-25, runbook `catalogue-import.md` "HP and BPCL MAK lubricant imports"): the pure step
 * that turns `hp_lubricants_products.csv` and `hp_lubricants_grades.csv` into one product per oil and grade.
 * AUTOMOTIVE ONLY: engine, gear and transmission oils, brake and fork fluids, coolants, automotive greases, tractor oils,
 * the EV and hybrid range, FUTUR-X and diesel exhaust fluid. Industrial, metal-working, marine, railroad, stationary
 * gas-engine and agricultural-spray rows are skipped with their reason. HP shows no prices and no pack sizes (the
 * "Pack sizes" column is empty on every row), so each product has one "Standard pack" variant at price on request.
 */
export const HP_BRAND: LubeBrand = { slug: 'hp', name: 'HP' };

interface Rule {
  category: LubeCategory;
  vehicleTypes?: VehicleType[];
  typeEn?: string;
  typeHi?: string;
  hsn?: string;
  ev?: boolean;
}

const SKIP: Readonly<Record<string, [SkipReason, string]>> = {
  'Railroad Engine Oils': ['railroad', 'Locomotive engine oil (railways), not a road vehicle.'],
  'Outboatd Marine Oils': ['marine', 'Outboard and boat engine oil.'],
  'Hp Spray Oil': ['agri_spray', 'Spray oil for plantations and crops, not a vehicle product.'],
};

/** Rows of "Natural Gas Engine Oil" for stationary DG sets (A 40, L 40, M 40); the CNG-vehicle ones stay. */
const STATIONARY = /NATURAL GAS ENGINE OIL (?:A|L|M)\b/i;

/** Category of the "Automotive Oils" range by HP's category label; some labels are decided by name below. */
const BY_CATEGORY: Readonly<Record<string, Rule>> = {
  'Agriculture Oils': { category: 'tractor-agri-oils' },
  'Bike Two Wheeler Engine Oils': { category: 'motorcycle-oil', vehicleTypes: ['2W'] },
  'Two Wheeler Engine Oils': { category: 'motorcycle-oil', vehicleTypes: ['2W'] },
  'Brake Fluids': {
    category: 'brake-fluid-fork-oil',
    hsn: '3819',
    typeEn: 'brake fluid',
    typeHi: 'ब्रेक फ्लूइड',
  },
  'Shock Absorber And Front Fork Oils': {
    category: 'brake-fluid-fork-oil',
    hsn: '2710',
    typeEn: 'shock absorber and front fork oil',
    typeHi: 'शॉक एब्ज़ॉर्बर और फ्रंट फ़ोर्क ऑयल',
  },
  'Diesel Engine Oils': { category: 'diesel-engine-oil' },
  'Heavy Duty Diesel Engine Oils': { category: 'heavy-duty-oils' },
  'Gear And Transmission Oils': { category: 'gear-oils' },
  'Passenger Car Engine Oils': { category: 'car-engine-oil', vehicleTypes: ['4W'] },
  'Radiator Coolants': { category: 'coolants' },
  'Automotive Greases': { category: 'greases' },
  'Natural Gas And Cng Engine Oils': { category: 'heavy-duty-oils' },
  'Auto Rickshaw Three Wheeler Engine Oils': { category: 'diesel-engine-oil', vehicleTypes: ['3W'] },
  'Three Wheeler Engine Oils': { category: 'car-engine-oil', vehicleTypes: ['3W'] },
  'Diesel Exhaust Fluid': {
    category: 'speciality-oils',
    hsn: '3102',
    typeEn: 'diesel exhaust fluid (DEF)',
    typeHi: 'डीज़ल एग्जॉस्ट फ्लूइड (DEF)',
  },
};

/** By product name where the label alone cannot tell (BS VI grades, FUTUR-X, the EV range, LPG and CNG). */
const BY_NAME: readonly [RegExp, Rule][] = [
  [
    /AIR FILTER OIL/i,
    {
      category: 'speciality-oils',
      hsn: '2710',
      typeEn: 'foam air filter oil',
      typeHi: 'फ़ोम एयर फ़िल्टर ऑयल',
      vehicleTypes: ['2W'],
    },
  ],
  [
    /\bEV\b.*BRAKE FLUID/i,
    {
      category: 'brake-fluid-fork-oil',
      hsn: '3819',
      typeEn: 'brake fluid for electric vehicles',
      typeHi: 'इलेक्ट्रिक गाड़ियों का ब्रेक फ्लूइड',
      ev: true,
    },
  ],
  [
    /\bEV\b.*GREASE/i,
    {
      category: 'greases',
      typeEn: 'grease for electric vehicles',
      typeHi: 'इलेक्ट्रिक गाड़ियों की ग्रीज़',
      ev: true,
    },
  ],
  [
    /\bEV\b.*KOOLGARD/i,
    {
      category: 'coolants',
      typeEn: 'coolant for electric vehicles',
      typeHi: 'इलेक्ट्रिक गाड़ियों का कूलेंट',
      ev: true,
    },
  ],
  [
    /\bEV\b.*(?:STEERING|TRANSMISSION) FLUID/i,
    {
      category: 'gear-oils',
      typeEn: 'steering or transmission fluid for electric vehicles',
      typeHi: 'इलेक्ट्रिक गाड़ियों का स्टीयरिंग या ट्रांसमिशन फ्लूइड',
      ev: true,
    },
  ],
  [
    /GASENOL|CNG BOOSTER/i,
    {
      category: 'car-engine-oil',
      vehicleTypes: ['3W', '4W'],
      typeEn: 'engine oil for CNG and LPG vehicles',
      typeHi: 'CNG और LPG गाड़ियों का इंजन ऑयल',
    },
  ],
  [
    /GREEN ENGINE OIL|LONG DRAIN CNG|MILCY CNG/i,
    {
      category: 'heavy-duty-oils',
      typeEn: 'engine oil for CNG vehicles',
      typeHi: 'CNG गाड़ियों का इंजन ऑयल',
    },
  ],
  [/MILCY|HYLUBE|HDX|KLT|NO\.1|X-3/i, { category: 'heavy-duty-oils' }],
  [/NEOSYNTH|NEO (?:CRUISE|SUPER)|CRUISE/i, { category: 'car-engine-oil', vehicleTypes: ['4W'] }],
  [/RACER|PROLUBE|SKUTEX/i, { category: 'motorcycle-oil', vehicleTypes: ['2W'] }],
];

export interface HpPlanInput {
  products: readonly CsvRow[];
  grades: readonly CsvRow[];
  pictureExists?: (file: string) => boolean;
  /** Content hash of a picture file (null = unreadable): the same bytes are the same picture. */
  pictureHash?: (file: string) => string | null;
  /** Rows of the researched pack list (`--packs`); none = every product keeps its Standard pack. */
  packs?: readonly CsvRow[];
}

const NAME_DECIDED: ReadonlySet<string> = new Set([
  'Bs Vi Grades',
  'Ev And Hybrid Range',
  'Auto Lpg And Cng Engine Oils',
  'Natural Gas And Cng Engine Oils',
  'Three Wheeler Engine Oils',
]);

type Decision = { skip: [SkipReason, string] } | { rule: Rule };

function decide(row: CsvRow): Decision {
  const range = row.Range ?? '';
  const category = row.Category ?? '';
  const name = row.Product ?? '';
  if (/leaflet/i.test(name)) return { skip: ['leaflet', 'A leaflet page, not a product.'] };
  const byCat = SKIP[category];
  if (byCat) return { skip: byCat };
  if (range === 'Marine Oils') return { skip: ['marine', 'Marine oil.'] };
  if (STATIONARY.test(name))
    return {
      skip: ['stationary_gas_engine', 'Natural gas engine oil for stationary DG sets, not a vehicle.'],
    };
  const auto =
    range === 'Automotive Oils' ||
    range === 'Futurx' ||
    category === 'Automotive Greases' ||
    category === 'Diesel Exhaust Fluid';
  if (!auto)
    return {
      skip: [
        'industrial',
        `${range} / ${category}: not a road-vehicle product. Automotive only, user ruling 2026-11-25.`,
      ],
    };
  if (range === 'Futurx' || NAME_DECIDED.has(category) || /AIR FILTER OIL/i.test(name)) {
    const named = BY_NAME.find(([re]) => re.test(name))?.[1];
    if (named) return { rule: named };
  }
  const rule = BY_CATEGORY[category];
  if (rule) return { rule };
  throw new Error(`Row "${name}": no category rule for "${range} / ${category}"`);
}

export function planHp(input: HpPlanInput): LubePlan {
  const exists = input.pictureExists ?? (() => true);
  const share = pictureShares(input.products, (r) => 'rule' in decide(r), input.pictureHash);
  const skipped: SkippedRow[] = [];
  const checks: LubeCheck[] = [];
  const missing = new Set<string>();
  const items: LubeItem[] = [];
  const gradesByProduct = new Map<string, CsvRow[]>();
  for (const g of input.grades)
    gradesByProduct.set(g.Product ?? '', [...(gradesByProduct.get(g.Product ?? '') ?? []), g]);

  input.products.forEach((row, index) => {
    const sourceRow = index + 1;
    const rawName = cleanLubeName(row.Product ?? '');
    const d = decide(row);
    if ('skip' in d) {
      skipped.push({
        sourceRow,
        name: rawName,
        listedRange: row.Range ?? '',
        listedCategory: row.Category ?? '',
        reason: d.skip[0],
        detail: d.skip[1],
      });
      return;
    }
    const { rule } = d;
    const pic = pictureOf(row, exists, share);
    const notes: string[] = pic.note ? [pic.note] : [];
    if ((row['Data checks'] ?? '').includes('Product page shows no details'))
      notes.push(
        "The maker's page shows no details; the name and description come from the page's hidden data block.",
      );
    if (pic.sharedBy > 1)
      notes.push(`The page's picture is shown on ${String(pic.sharedBy)} products of the maker's site.`);
    const application = withHindi(txt(row, 'Application'), HP_HI, missing);
    const shortDescription = withHindi(txt(row, 'Short description'), HP_HI, missing);
    const features = featureLines(txt(row, 'Features and benefits')).map((f) => withHindi(f, HP_HI, missing));
    const pieces = splitGrades(rawName);
    const gradeRows = gradesByProduct.get(row.Product ?? '') ?? [];
    for (const piece of pieces) {
      const name = brandedName(piece, HP_BRAND.name, null);
      const props = propertiesOf(gradeRows, gradeKey(name));
      const itemNotes = [...notes];
      if (props.rejected.length > 0)
        itemNotes.push(
          `Property values left out because they cannot be right: ${props.rejected.join(', ')}.`,
        );
      if (pieces.length > 1)
        itemNotes.push(
          `The page lists several grades ("${rawName}"); each grade is its own product with the page's photo.`,
        );
      items.push({
        sourceRows: [sourceRow],
        listedRange: row.Range ?? '',
        listedCategory: row.Category ?? '',
        name,
        nameHi: hindiOfName(name),
        category: rule.category,
        vehicleTypes: rule.vehicleTypes ?? [],
        typeEn: rule.typeEn,
        typeHi: rule.typeHi,
        hsn: rule.hsn,
        grade: gradeText(name, rule.category),
        specsMet: txt(row, 'Specifications met'),
        application,
        shortDescription,
        features: features.filter((f): f is NonNullable<typeof f> => f !== null),
        packs: [],
        photoFile: pic.file,
        draftReason: pic.reason,
        photoSharedBy: pic.sharedBy,
        properties: props.props,
        sourceDocs: {
          productPage: (row['Product page'] ?? '').trim(),
          dataSheetUrl: (row['Data sheet URL'] ?? '').trim(),
          pictureUrl: (row['Picture URL'] ?? '').trim(),
        },
        extraSpec: rule.ev ? { evRange: true } : {},
        checks: itemNotes,
      });
    }
  });

  const merged = mergeItems(items);

  const researched = input.packs ? applyResearchedPacks(merged, input.packs) : null;
  if (researched && researched.research.unmatched.length > 0)
    checks.push({
      slug: '',
      name: 'Researched packs',
      note: `Rows for no planned product: ${researched.research.unmatched.join(', ')}.`,
    });
  return planLubeItems(researched?.items ?? merged, {
    brand: HP_BRAND,
    source: 'hp',
    skipped,
    checks,
    untranslated: [...missing],
    allowedWords: ALLOWED_LATIN,
    research: researched?.research,
  });
}

/** The hp_lubricants folder: the products and grades CSVs and `pictures/…`. */
export function planHpDir(dir: string, opts: { packs?: string } = {}): LubePlan {
  return planHp({
    products: readCsvFile(dir, 'hp_lubricants_products.csv'),
    grades: readCsvFile(dir, 'hp_lubricants_grades.csv'),
    pictureExists: pictureExistsIn(dir),
    pictureHash: pictureHashIn(dir),
    packs: opts.packs ? parseHpPacksCsv(readFileSync(opts.packs, 'utf8')) : undefined,
  });
}
