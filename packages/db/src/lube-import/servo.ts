import type { VehicleType } from '@mechdost/shared/vehicles';
import { pictureExistsIn, readCsvFile, type CsvRow } from '../battery-import';
import { planLubeItems, type LubeBrand } from './build';
import { SERVO_HI } from './features-hi-servo';
import type { LubeCategory } from './kinds';
import {
  brandedName,
  gradeText,
  hindiOfName,
  mergeItems,
  packOf,
  pictureHashIn,
  txt,
  withHindi,
} from './adapter';
import { ALLOWED_LATIN } from './hindi-allowed';
import { pictureOf, pictureShares } from './picture';
import { SERVO_HIGH_CONFIDENCE_PACKS } from './servo-packs';
import { cleanLubeName } from './text';
import type { LubeCheck, LubeItem, LubePlan, SkipReason, SkippedRow } from './types';

/**
 * IOCL Servo plan (user 2026-11-25, runbook `catalogue-import.md` "Servo import"): the products of
 * `servo_lubricants_products.csv` that are automotive (automotive oils and automotive greases) AND have a picture. Every
 * other row is left out, not even as a draft, and listed with its reason. The pictures are IndiaMART seller photos: each is
 * flagged in the report (seller, what the label shows, a grade that differs from the row) and nothing is painted out.
 * "Seller price (IndiaMART)" are seller asking prices, never MRPs, so every pack is price on request; pack sizes come only
 * from listings with confidence High (`servo-packs.ts`). Brand `servo`, display "Servo", maker IndianOil (IOCL).
 */
export const SERVO_BRAND: LubeBrand = { slug: 'servo', name: 'Servo' };
const MAKER = 'IndianOil (IOCL)';

interface Rule {
  category: LubeCategory;
  vehicleTypes?: VehicleType[];
}

const BY_CATEGORY: Readonly<Record<string, Rule>> = {
  '2 - Stroke Engine Oils': { category: 'motorcycle-oil', vehicleTypes: ['2W', '3W'] },
  '4 - Stroke Engine Oils': { category: 'motorcycle-oil', vehicleTypes: ['2W', '3W'] },
  'Diesel Engine Oils': { category: 'heavy-duty-oils' },
  'Tractor Oils': { category: 'tractor-agri-oils' },
  'Passenger Car Motor Oils': { category: 'car-engine-oil', vehicleTypes: ['4W'] },
  'Gear Oils': { category: 'gear-oils' },
  'Automotive Greases': { category: 'greases' },
};

export interface ServoPlanInput {
  products: readonly CsvRow[];
  pictureExists?: (file: string) => boolean;
  pictureHash?: (file: string) => string | null;
}

/** Benefit lines of a data sheet ("A.; B." or "o A. o B." or "# A. # B."). */
export function benefitLines(text: string): string[] {
  return text
    .split(/;\s+|\s+[o#]\s+|^[o#]\s+/)
    .map((l) =>
      l
        .replace(/^[o#]\s+/, '')
        .replace(/\.$/, '')
        .trim(),
    )
    .filter((l) => l !== '' && !/^Servo Super Multigrade Oils$/i.test(l));
}

const SAE_IN = /\b(\d{1,2}W-\d{2,3})\b/g;

export function planServo(input: ServoPlanInput): LubePlan {
  const exists = input.pictureExists ?? (() => true);
  const skipped: SkippedRow[] = [];
  const checks: LubeCheck[] = [];
  const missing = new Set<string>();
  const items: LubeItem[] = [];
  const isAuto = (r: CsvRow) => (r.Range ?? '').startsWith('Automotive') && r.Category !== 'Boat Engine Oil';
  const share = pictureShares(
    input.products,
    (r) => isAuto(r) && (r['Picture file'] ?? '') !== '',
    input.pictureHash,
  );

  input.products.forEach((row, index) => {
    const sourceRow = index + 1;
    const rawName = cleanLubeName(row.Product ?? '');
    const skip = (reason: SkipReason, detail: string, name = rawName) =>
      skipped.push({
        sourceRow,
        name,
        listedRange: row.Range ?? '',
        listedCategory: row.Category ?? '',
        reason,
        detail,
      });
    if (!(row.Range ?? '').startsWith('Automotive')) {
      skip(
        'industrial',
        'Industrial or railroad product, not a road-vehicle product. Automotive only, user ruling 2026-11-25.',
      );
      return;
    }
    if (row.Category === 'Boat Engine Oil') {
      skip('marine', 'Boat engine oil. Automotive only, user ruling 2026-11-25.');
      return;
    }
    const file = (row['Picture file'] ?? '').trim();
    if (file === '') {
      skip(
        'no_picture',
        'No picture (the Servo pages show none and no IndiaMART listing was matched). Only products with a picture are imported, user ruling 2026-11-25.',
      );
      return;
    }
    const rule = BY_CATEGORY[row.Category ?? ''];
    if (!rule) throw new Error(`Row "${rawName}": no category rule for "${row.Category ?? ''}"`);

    const note = (row['Picture note'] ?? '').trim();
    const seller = /posted by the seller (.+?)\. The label shows/.exec(note)?.[1] ?? 'an unnamed seller';
    const label = /The label shows (.+?)\.(?: Checked|$)/.exec(note)?.[1] ?? '';
    const pic = pictureOf(row, exists, share);

    // A page that lists several grades: the picture shows one of them; only that grade has a picture of its own.
    const columnGrades = (row['Grade (SAE / viscosity)'] ?? '').split(/,\s*/).filter((g) => g !== '');
    let names = [rawName];
    let grade: string | null = null;
    if (columnGrades.length > 1) {
      const shown = [...label.matchAll(SAE_IN)].map((m) => m[1] ?? '');
      const chosen = columnGrades.find((g) => shown.includes(g));
      const base = rawName.replace(/\s*\d+W-\d+(?:\/\d+W-\d+)+$/, '');
      if (!chosen) throw new Error(`Row "${rawName}": the picture shows none of its grades`);
      for (const g of columnGrades)
        if (g !== chosen)
          skip(
            'grade_without_photo',
            `The picture shows only ${chosen}; the other grades of this page have no picture of their own.`,
            `${rawName} (${g})`,
          );
      names = [`${base} ${chosen}`];
      grade = chosen;
    } else if (columnGrades.length === 1) grade = columnGrades[0] ?? null;

    const notes: string[] = [
      `Photo: IndiaMART seller photo (seller ${seller}); the label shows ${label === '' ? 'no readable product name' : label}. The photo may carry the seller's or the maker's branding; nothing is painted out.`,
    ];
    const flags: string[] = [];
    const shownGrades = [...label.matchAll(SAE_IN)].map((m) => m[1] ?? '');
    if (/not readable/i.test(label + note)) flags.push('the grade on the label is not readable');
    if (grade !== null && shownGrades.length === 1 && shownGrades[0] !== grade)
      flags.push(`the label shows ${shownGrades[0] ?? ''} but the row's grade is ${grade}`);
    if (/barrel|drum|lid/i.test(label)) flags.push('the photo shows a drum or barrel, not a retail pack');
    for (const f of flags) notes.push(`Photo: ${f}.`);
    if (pic.sharedBy > 1) notes.push(`Photo: the same picture is used by ${String(pic.sharedBy)} products.`);

    const packs = (SERVO_HIGH_CONFIDENCE_PACKS[row.Product ?? ''] ?? []).flatMap((size) => {
      const pack = packOf(size, '', (n) => notes.push(n));
      return pack ? [pack] : [];
    });
    if ((row['Seller price (IndiaMART)'] ?? '').trim() !== '')
      notes.push(
        'IndiaMART seller prices exist for this product; they are asking prices, not MRPs, and are not used (price on request).',
      );

    const features = benefitLines(txt(row, 'Benefits')).map((f) => withHindi(f, SERVO_HI, missing));
    const application = withHindi(txt(row, 'Application'), SERVO_HI, missing);
    const description = withHindi(txt(row, 'Description'), SERVO_HI, missing);
    const approvals = txt(row, 'Manufacturer approvals');
    const extra: Record<string, unknown> = { maker: MAKER };
    if (approvals !== '') extra.manufacturerApprovals = approvals;
    if (flags.length > 0) extra.photoFlags = flags;

    for (const piece of names) {
      const name = brandedName(piece, SERVO_BRAND.name, /^SERVO\s+/i);
      items.push({
        sourceRows: [sourceRow],
        listedRange: row.Range ?? '',
        listedCategory: row.Category ?? '',
        name,
        nameHi: hindiOfName(name),
        category: rule.category,
        vehicleTypes: rule.vehicleTypes ?? [],
        grade: gradeText(name, rule.category) ?? grade,
        specsMet: txt(row, 'Specifications met'),
        application,
        shortDescription: description,
        features: features.filter((f): f is NonNullable<typeof f> => f !== null),
        packs,
        photoFile: pic.file,
        draftReason: pic.reason,
        photoSharedBy: pic.sharedBy,
        properties: {},
        sourceDocs: {
          productPage: (row['Product page'] ?? '').trim(),
          dataSheetUrl: (row['Data sheet URL'] ?? '').trim(),
          pictureUrl: (row['Picture URL'] ?? '').trim(),
          pictureListing: (row['Picture listing'] ?? '').trim(),
          pictureNote: note,
        },
        extraSpec: extra,
        checks: notes,
      });
    }
  });

  return planLubeItems(mergeItems(items), {
    brand: SERVO_BRAND,
    source: 'servo',
    skipped,
    checks,
    untranslated: [...missing],
    allowedWords: ALLOWED_LATIN,
  });
}

/** The servo_lubricants folder: the products CSV and `pictures/IndiaMART/…`. */
export function planServoDir(dir: string): LubePlan {
  return planServo({
    products: readCsvFile(dir, 'servo_lubricants_products.csv'),
    pictureExists: pictureExistsIn(dir),
    pictureHash: pictureHashIn(dir),
  });
}
