import type { CsvRow } from '../battery-import';
import { cleanSpecText } from '../battery-import/text';
import {
  APOLLO_DESCRIPTIONS_HI,
  APOLLO_FEATURES_HI,
  decimalOf,
  hindiTyreName,
  intOf,
  loadIndexText,
  planTyrePhotos,
  planTyreRows,
  rupeesToPaise,
  speedSymbol,
  titleTyreName,
  type TyreCheck,
  type TyreFitment,
  type TyreKind,
  type TyrePlan,
  type TyreRow,
} from '../tyre-import';
import { tyrePatternName } from '../tyre-import/build';

/**
 * Apollo catalogue plan (user 2026-11-24, runbook `catalogue-import.md` "Apollo tyre import"): the pure step that turns
 * `apollo_tyres.csv`, `apollo_brochure_products.csv` and `apollo_vehicle_fitment.csv` into one product per tread
 * pattern with each size a variant. INDIA ONLY: every "Shop only" row (sold on shop.apollotyres.com but not on the India
 * site, which includes all Vredestein) and every brochure-only size is dropped, each listed with its reason. The MRP
 * comes only from the shop column (else price on request); the EAN is the variant barcode. No I/O here.
 */
export const BRAND = { slug: 'apollo', name: 'Apollo' } as const;
/** Brands whose products this import archives besides `apollo` (Vredestein was sold on the Apollo shop; not imported). */
export const ALSO_ARCHIVE_BRANDS = ['vredestein'] as const;

const KIND_OF: Readonly<Record<string, TyreKind>> = {
  'Car / SUV / van tyre': 'car_suv',
  'Bike / scooter tyre': 'two_wheeler',
  'Truck and bus tyre': 'truck_bus',
  'Industrial tyre': 'industrial',
  'Farm tyre': 'farm',
  'Earthmover tyre': 'otr',
};

/** The descriptions by their text with runs of spaces squeezed (the site has stray double spaces). */
const DESCRIPTIONS_HI = new Map(
  Object.entries(APOLLO_DESCRIPTIONS_HI).map(([en, hi]) => [en.replace(/[ 	]+/g, ' '), hi]),
);

const INDIA_PAGE = 'https://www.apollotyres.com/en-in/';

export type DropReason = 'shop_only' | 'brochure_only' | 'duplicate' | 'not_india';

/** A source row that is not imported, with the reason (the report lists every one). */
export interface DroppedRow {
  source: 'tyres' | 'brochure';
  /** 1-based row of its CSV (header excluded). */
  sourceRow: number;
  brand: string;
  name: string;
  reason: DropReason;
  detail: string;
}

export interface ApolloPlan extends TyrePlan {
  dropped: DroppedRow[];
  /** Tyre names of the fitment list that match no row of `apollo_tyres.csv`. */
  fitmentUnmatched: string[];
}

export interface ApolloPlanInput {
  tyres: readonly CsvRow[];
  brochure: readonly CsvRow[];
  fitment: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; a missing one is left out. */
  pictureExists?: (file: string) => boolean;
}

/** The text as plain text: HTML entities decoded and tags removed (the site escapes them). */
export function plainText(raw: string): string {
  return raw
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const REASON_TEXT: Readonly<Record<DropReason, string>> = {
  shop_only:
    'Sold only on shop.apollotyres.com; not on the India site (apollotyres.com/en-in). The import is India only (user ruling 2026-11-24).',
  brochure_only:
    'Appears only in the brochure, not on the website. Not imported (India only, user ruling 2026-11-24).',
  duplicate: 'Listed more than once on the site with the same details; merged into one size.',
  not_india: 'Neither on the India pattern pages nor on the shop. Not imported.',
};

/** Radial when the size says R, bias when it says D or a hyphen, else unknown. */
function constructionOf(size: string): 'radial' | 'bias' | null {
  if (/\d\s*Z?R\s*\d/i.test(size)) return 'radial';
  if (/\d\s*D\s*\d/i.test(size) || /\d-\d/.test(size)) return 'bias';
  return null;
}

const FIT_SEP = '|';

export function planApollo(input: ApolloPlanInput): ApolloPlan {
  const exists = input.pictureExists ?? (() => true);
  const untranslated = new Set<string>();
  const checks: TyreCheck[] = [];
  const dropped: DroppedRow[] = [];
  const known = new Set(input.tyres.map((t) => (t.Tyre ?? '').trim()));

  // Fitment per tyre name (the shop lists the vehicle as one text; its first word is the make).
  const byTyre = new Map<string, TyreFitment[]>();
  const seenFit = new Set<string>();
  const unmatched = new Set<string>();
  for (const f of input.fitment) {
    const tyre = (f.Tyre ?? '').trim();
    const vehicle = (f.Vehicle ?? '').trim();
    if (!known.has(tyre)) {
      unmatched.add(tyre === '' ? '(blank tyre name)' : tyre);
      continue;
    }
    if (vehicle === '' || /^\d/.test(vehicle)) continue;
    const [make = '', ...rest] = vehicle.split(/\s+/);
    const key = `${tyre}${FIT_SEP}${vehicle}`;
    if (seenFit.has(key)) continue;
    seenFit.add(key);
    byTyre.set(tyre, [
      ...(byTyre.get(tyre) ?? []),
      {
        vehicleType: '',
        make,
        model: rest.join(' '),
        variant: null,
        years: null,
        option: null,
        position: null,
      },
    ]);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const list of byTyre.values()) list.sort((a, b) => cmp(a.make, b.make) || cmp(a.model, b.model));

  // Rows to keep, with their duplicates merged.
  interface Kept {
    t: CsvRow;
    sourceRow: number;
    alsoAt: string[];
  }
  const keptByName = new Map<string, Kept>();
  const keptList: Kept[] = [];
  input.tyres.forEach((t, index) => {
    const sourceRow = index + 1;
    const raw = (t.Tyre ?? '').trim();
    const brand = (t.Brand ?? '').trim() || 'Apollo';
    const drop = (reason: DropReason, detail = REASON_TEXT[reason]) =>
      dropped.push({ source: 'tyres', sourceRow, brand, name: raw, reason, detail });
    if ((t.source ?? '').trim() === 'Shop only') {
      drop('shop_only');
      return;
    }
    const onIndiaSite = (t['Pattern page'] ?? '').startsWith(INDIA_PAGE);
    const onShop = (t['Shop page'] ?? '').includes('shop.apollotyres.com');
    if (!onIndiaSite && !onShop) {
      drop('not_india');
      return;
    }
    const first = keptByName.get(raw);
    if (first) {
      const page = (t['Pattern page'] ?? '').trim();
      if (page !== '' && page !== (first.t['Pattern page'] ?? '').trim()) first.alsoAt.push(page);
      drop('duplicate', `${REASON_TEXT.duplicate} Kept: source row ${String(first.sourceRow)}.`);
      return;
    }
    const entry: Kept = { t, sourceRow, alsoAt: [] };
    keptByName.set(raw, entry);
    keptList.push(entry);
  });
  input.brochure.forEach((b, index) => {
    if (!(b['Also on the website'] ?? '').startsWith('No')) return;
    dropped.push({
      source: 'brochure',
      sourceRow: index + 1,
      brand: 'Apollo',
      name: `${(b.Brochure ?? '').trim()}: ${(b['Pattern (as on the brochure)'] ?? '').trim()} ${(b['Size line (as printed)'] ?? '').trim()}`,
      reason: 'brochure_only',
      detail: REASON_TEXT.brochure_only,
    });
  });

  // Pattern pictures: the numbered views of the pattern page (every size of the pattern), then one shop photo. Brochure
  // images are never product photos.
  const patternKey = (t: CsvRow) =>
    `${t['Product type'] ?? ''}|${(t.Pattern ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const viewNumber = (file: string) => /^.* - (\d+)\.[^.]+$/.exec(file)?.[1] ?? null;
  const picturesOf = new Map<string, string[]>();
  for (const { t } of keptList) {
    const key = patternKey(t);
    const have = picturesOf.get(key) ?? [];
    for (const f of (t['Picture files'] ?? '').split(' | ').map((x) => x.trim())) {
      if (f === '' || /brochure/i.test(f) || have.includes(f)) continue;
      if (
        viewNumber(f) !== null ||
        (/ - shop photo\.[^.]+$/.test(f) && !have.some((h) => / - shop photo\./.test(h)))
      )
        have.push(f);
    }
    picturesOf.set(key, have);
  }

  const rows: TyreRow[] = [];
  for (const { t, sourceRow, alsoAt } of keptList) {
    const listed = t['Product type'] ?? '';
    const kind = KIND_OF[listed];
    if (!kind) throw new Error(`Row ${String(sourceRow)}: unknown Apollo product type "${listed}"`);
    const name = titleTyreName(t.Tyre ?? '');
    const nameHi = hindiTyreName(name, kind);
    const pattern = titleTyreName(t.Pattern ?? '');
    const sizeText = (t.Size ?? '').trim();
    const shopSku = (t['SKU (shop)'] ?? '').trim();
    const ean = (t['EAN barcode'] ?? '').trim();

    const extraSpec: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') extraSpec[key] = value;
    };
    put('shopSku', shopSku);
    put('shopName', (t['Name in shop'] ?? '').trim());
    put('shopPage', (t['Shop page'] ?? '').trim());
    put('overallDiameterMm', decimalOf(t['Overall diameter (mm)']));
    put('recommendedRimWidthInch', decimalOf(t['Recommended rim width']));
    put('alternativeRimWidthInch', decimalOf(t['Alternative rim width']));
    put('otherSizeData', (t['Other size data'] ?? '').trim());
    put(
      'shopTags',
      (t['Shop tags'] ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== ''),
    );
    put('mrpSource', (t['MRP incl. taxes (Rs)'] ?? '').trim() === '' ? '' : 'shop');
    put('source', (t.source ?? '').trim());
    const sourceChecks: string[] = [];
    const dataCheck = (t['Data checks'] ?? '').trim();
    if (dataCheck !== '' && !dataCheck.startsWith('Listed more than once')) sourceChecks.push(dataCheck);
    for (const url of alsoAt) sourceChecks.push(`Also listed on ${url}`);
    if (sourceChecks.length > 0) extraSpec.sourceChecks = sourceChecks;
    if (dataCheck.startsWith('The site shows no size table'))
      checks.push({
        slug: '',
        name,
        note: `${dataCheck}. Handled: the size comes from the row itself.`,
      });
    if (alsoAt.length > 0)
      checks.push({
        slug: '',
        name,
        note: `Listed on more than one pattern page; merged into one size (also on ${alsoAt.join(', ')}).`,
      });

    const features = (t['Shop features'] ?? '')
      .split(' | ')
      .map((f) => f.trim())
      .filter((f) => f !== '')
      .map((en) => {
        const hi = APOLLO_FEATURES_HI[en];
        if (hi === undefined) untranslated.add(en);
        return { en: cleanSpecText(en), hi: hi ?? '' };
      })
      .filter((f) => f.hi !== '');
    const descEn = plainText(t.Description ?? '');
    const descHi = DESCRIPTIONS_HI.get(descEn);
    if (descEn !== '' && descHi === undefined) untranslated.add(descEn);

    if (pattern.toLowerCase() === 'others')
      checks.push({
        slug: '',
        name,
        note: 'The site lists this size under the pattern "Others" (no tread pattern name). Handled: imported as the product "Apollo Others"; the admin can rename it.',
      });
    const tl = t['Tubeless / tube type'] ?? '';
    const ply = intOf(t['Ply rating']);
    const patternName = tyrePatternName('Apollo', pattern);
    const { photos, missing } = planTyrePhotos({
      files: picturesOf.get(patternKey(t)) ?? [],
      urls: [],
      name: patternName,
      nameHi: hindiTyreName(patternName, kind),
      order: ['1', '2', '3', '4', '5'],
      exists,
    });
    for (const f of missing)
      checks.push({ slug: '', name, note: `Picture file ${f} is not in the folder; left out.` });
    const fitment = (byTyre.get((t.Tyre ?? '').trim()) ?? []).map((f) => ({ ...f, vehicleType: kind }));

    rows.push({
      sourceRow,
      brand: { name: 'Apollo', label: 'Apollo' },
      kind,
      listedType: listed,
      name,
      nameHi,
      pattern,
      sizeText,
      sourceSku: shopSku === '' ? null : shopSku,
      partNumber: shopSku,
      mrpPaise: rupeesToPaise(t['MRP incl. taxes (Rs)']),
      barcode: ean === '' ? null : ean,
      widthMm: decimalOf(t.Width),
      aspectPct: decimalOf(t['Aspect ratio']),
      rimInch: decimalOf(t['Rim (inch)']),
      construction: constructionOf(sizeText),
      loadIndex: loadIndexText(t['Load index']),
      speedRating: speedSymbol(t['Speed rating']),
      plyRating: ply !== null && ply > 0 ? ply : null,
      tubeless: tl.startsWith('TL') ? true : tl.startsWith('TT') ? false : null,
      tubeIncluded: null,
      position: null,
      features,
      tagline: descEn !== '' && descHi !== undefined ? { en: descEn, hi: descHi } : null,
      extraFacts: [],
      extraSpec,
      photos,
      fitment,
      productPage: (t['Pattern page'] ?? '').trim(),
      sharedPhotos: true,
      noPhotoOnSite: (picturesOf.get(patternKey(t)) ?? []).length === 0,
    });
  }

  if (unmatched.size > 0)
    checks.push({
      slug: '',
      name: 'Fitment list',
      note: `${String(unmatched.size)} tyre names of the fitment list match no tyre row and carry no fitment: ${[...unmatched].join('; ')}.`,
    });
  const plan = planTyreRows(rows, {
    source: 'apollo',
    skuPrefix: 'APOLLO',
    checks,
    untranslated: [...untranslated],
  });
  return { ...plan, dropped, fitmentUnmatched: [...unmatched] };
}
