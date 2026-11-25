import type { VehicleType } from '@mechdost/shared/vehicles';
import { csvRows, pictureExistsIn, readCsvFile, type CsvRow } from '../battery-import';
import { planLubeItems, type LubeBrand } from './build';
import { BPCL_HI } from './features-hi-bpcl';
import type { LubeCategory } from './kinds';
import {
  brandedName,
  featureLines,
  gradeText,
  hindiOfName,
  mergeItems,
  mergePacks,
  packOf,
  pictureHashIn,
  txt,
  withHindi,
} from './adapter';
import { ALLOWED_LATIN } from './hindi-allowed';
import { pictureOf, pictureShares } from './picture';
import { cleanLubeName, gradeKey, propertiesOf, splitGrades } from './text';
import type { LubeCheck, LubeItem, LubePack, LubePlan, SkippedRow } from './types';

/**
 * BPCL MAK lubricant plan (user 2026-11-25, runbook `catalogue-import.md` "HP and BPCL MAK lubricant imports"): the pure
 * step that turns `bpcl_mak_lubricants_products.csv`, `_packs.csv` and `_grades.csv` into one product per oil and
 * grade with each pack a variant. AUTOMOTIVE ONLY: the whole Industrial range and the marine products are skipped, each
 * listed with its reason. "Rs 354/-" next to a pack is that pack's MRP; a pack without a price is price on request.
 * Display name is "BPCL MAK" (the source's Brand column), slug `bpcl-mak`.
 */
export const BPCL_BRAND: LubeBrand = { slug: 'bpcl-mak', name: 'BPCL MAK' };

interface Rule {
  category: LubeCategory;
  vehicleTypes?: VehicleType[];
  typeEn?: string;
  typeHi?: string;
  hsn?: string;
}

/** The category of the Automobile range by the page's category label. */
const BY_CATEGORY: Readonly<Record<string, Rule>> = {
  'Cars and SUVs': { category: 'car-engine-oil', vehicleTypes: ['4W'] },
  'Trucks and buses': { category: 'heavy-duty-oils' },
  'Gears and transmission': { category: 'gear-oils' },
  'Bikes and scooters': { category: 'motorcycle-oil', vehicleTypes: ['2W'] },
  Agriculture: { category: 'tractor-agri-oils' },
  Greases: { category: 'greases' },
};

/** Pages with a blank or "Specialties" label: decided by what the product is. */
const BY_NAME: readonly [RegExp, Rule][] = [
  [
    /BRAKE FLUID/i,
    { category: 'brake-fluid-fork-oil', hsn: '3819', typeEn: 'brake fluid', typeHi: 'ब्रेक फ्लूइड' },
  ],
  [
    /FORK OIL/i,
    { category: 'brake-fluid-fork-oil', hsn: '2710', typeEn: 'front fork oil', typeHi: 'फ्रंट फ़ोर्क ऑयल' },
  ],
  [/KOOL/i, { category: 'coolants' }],
  [
    /ADBLUE|AUS 32/i,
    {
      category: 'speciality-oils',
      hsn: '3102',
      typeEn: 'diesel exhaust fluid (DEF)',
      typeHi: 'डीज़ल एग्जॉस्ट फ्लूइड (DEF)',
    },
  ],
  [
    /CHAIN SPRAY/i,
    {
      category: 'speciality-oils',
      hsn: '3403',
      typeEn: 'motorcycle chain spray',
      typeHi: 'मोटरसाइकिल चेन स्प्रे',
      vehicleTypes: ['2W'],
    },
  ],
  [
    /MULTIPURPOSE SPRAY/i,
    {
      category: 'speciality-oils',
      hsn: '3403',
      typeEn: 'multi-purpose spray',
      typeHi: 'मल्टी-पर्पज़ स्प्रे',
    },
  ],
  [/FLEET MINI/i, { category: 'heavy-duty-oils' }],
];

export interface BpclPlanInput {
  products: readonly CsvRow[];
  packs: readonly CsvRow[];
  grades: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; a missing one makes the product a draft. */
  pictureExists?: (file: string) => boolean;
  /** Content hash of a picture file (null = unreadable): the same bytes are the same picture. */
  pictureHash?: (file: string) => string | null;
}

/** The rule of one automobile row, or null (marine). */
function ruleOf(row: CsvRow): Rule | null {
  const labels = (row.Category ?? '').split(',').map((s) => s.trim());
  const name = row.Product ?? '';
  const byName = BY_NAME.find(([re]) => re.test(name));
  if (byName) return byName[1];
  if (labels.includes('Auto and CNG')) {
    const diesel = /diesel/i.test(`${row.Application ?? ''} ${row['Short description'] ?? ''}`);
    return { category: diesel ? 'diesel-engine-oil' : 'car-engine-oil', vehicleTypes: ['3W'] };
  }
  for (const label of labels) {
    const rule = BY_CATEGORY[label];
    if (rule) return rule;
  }
  if (labels.includes('Marine boats')) return null;
  throw new Error(`Row "${name}": no category rule for "${row.Category ?? ''}"`);
}

export function planBpcl(input: BpclPlanInput): LubePlan {
  const exists = input.pictureExists ?? (() => true);
  const share = pictureShares(
    input.products,
    (r) => (r.Range ?? '').startsWith('Automobile') && ruleOf(r) !== null,
    input.pictureHash,
  );
  const skipped: SkippedRow[] = [];
  const checks: LubeCheck[] = [];
  const missing = new Set<string>();
  const items: LubeItem[] = [];

  const packsByPage = new Map<string, CsvRow[]>();
  for (const p of input.packs) {
    const key = (p['Product page'] ?? '').trim();
    packsByPage.set(key, [...(packsByPage.get(key) ?? []), p]);
  }
  const gradesByProduct = new Map<string, CsvRow[]>();
  for (const g of input.grades)
    gradesByProduct.set(g.Product ?? '', [...(gradesByProduct.get(g.Product ?? '') ?? []), g]);

  input.products.forEach((row, index) => {
    const sourceRow = index + 1;
    const rawName = cleanLubeName(row.Product ?? '');
    const skip = (reason: SkippedRow['reason'], detail: string) =>
      skipped.push({
        sourceRow,
        name: rawName,
        listedRange: row.Range ?? '',
        listedCategory: row.Category ?? '',
        reason,
        detail,
      });
    if (!(row.Range ?? '').startsWith('Automobile')) {
      skip(
        'industrial',
        'Industrial range (not a road-vehicle product). Automotive only, user ruling 2026-11-25.',
      );
      return;
    }
    const rule = ruleOf(row);
    if (!rule) {
      skip(
        'marine',
        'Marine boat oil (outboard or inboard boat engines). Automotive only, user ruling 2026-11-25.',
      );
      return;
    }

    const pic = pictureOf(row, exists, share);
    const pages = [(row['Product page'] ?? '').trim()];
    const packs: LubePack[] = [];
    const notes: string[] = pic.note ? [pic.note] : [];
    for (const p of packsByPage.get(pages[0] ?? '') ?? []) {
      const pack = packOf(p['Pack size'] ?? '', p['Price (Rs)'] ?? '', (n) => notes.push(n));
      if (pack) packs.push(pack);
    }
    const merged = mergePacks(packs, (n) => notes.push(n));
    const features = featureLines(txt(row, 'Features and benefits')).map((f) =>
      withHindi(f, BPCL_HI, missing),
    );
    const application = withHindi(txt(row, 'Application'), BPCL_HI, missing);
    const shortDescription = withHindi(txt(row, 'Short description'), BPCL_HI, missing);
    if (merged.some((p) => p.mrpPaise !== null) && merged.some((p) => p.mrpPaise === null))
      notes.push(
        'Some packs of this product have a price on the page and some do not; the others are price on request.',
      );
    if (pic.sharedBy > 1)
      notes.push(`The page's picture is shown on ${String(pic.sharedBy)} products of the maker's site.`);
    const rows = gradesByProduct.get(row.Product ?? '') ?? [];

    for (const piece of splitGrades(rawName)) {
      const name = brandedName(piece, BPCL_BRAND.name, /^MAK\s+/i);
      const props = propertiesOf(rows, gradeKey(name));
      const itemNotes = [...notes];
      if (props.rejected.length > 0)
        itemNotes.push(
          `Property values left out because they cannot be right: ${props.rejected.join(', ')}.`,
        );
      if (/SCCOTECH/i.test(name))
        itemNotes.push(
          'The page spells the name "Sccotech" (probably "Scootech"); kept exactly as the page writes it, the admin can correct it.',
        );
      if (splitGrades(rawName).length > 1)
        itemNotes.push(
          `The page lists several grades ("${rawName}"); each grade is its own product with the page's packs and photo.`,
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
        packs: merged,
        photoFile: pic.file,
        draftReason: pic.reason,
        photoSharedBy: pic.sharedBy,
        properties: props.props,
        sourceDocs: {
          productPage: (row['Product page'] ?? '').trim(),
          dataSheetUrl: (row['Data sheet URL'] ?? '').trim(),
          pictureUrl: (row['Picture URL'] ?? '').trim(),
        },
        extraSpec: {},
        checks: itemNotes,
      });
    }
  });

  return planLubeItems(mergeItems(items), {
    brand: BPCL_BRAND,
    source: 'bpcl',
    skipped,
    checks,
    untranslated: [...missing],
    allowedWords: ALLOWED_LATIN,
  });
}

/** The bpcl_mak_lubricants folder: the products, packs and grades CSVs and `pictures/…`. */
export function planBpclDir(dir: string): LubePlan {
  return planBpcl({
    products: readCsvFile(dir, 'bpcl_mak_lubricants_products.csv'),
    packs: readCsvFile(dir, 'bpcl_mak_lubricants_packs.csv'),
    grades: readCsvFile(dir, 'bpcl_mak_lubricants_grades.csv'),
    pictureExists: pictureExistsIn(dir),
    pictureHash: pictureHashIn(dir),
  });
}

export { csvRows };
