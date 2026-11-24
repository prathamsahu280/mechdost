import type { CsvRow } from '../battery-import';
import { cleanSpecText } from '../battery-import/text';
import {
  CEAT_APPLICATIONS_HI,
  CEAT_FEATURES_HI,
  CEAT_TAGLINES_HI,
  CEAT_USAGE_HI,
  decimalOf,
  hindiTyreName,
  intOf,
  loadIndexText,
  planTyreRows,
  planTyrePhotos,
  rupeesToPaise,
  speedSymbol,
  titleTyreName,
  CEAT_VIEW_ORDER,
  type TyreCheck,
  type TyreFitment,
  type TyreKind,
  type TyrePlan,
  type TyreRow,
} from '../tyre-import';
import type { Fact } from '../battery-import';

/**
 * CEAT catalogue plan (user 2026-11-24, runbook `catalogue-import.md` "CEAT tyre import"): the pure step that turns
 * `ceat_tyres.csv` and `ceat_vehicle_fitment.csv` into one product per tyre size, named as CEAT names it in title case
 * ("CEAT Milaze X3 145/70R12 69T TL"). "Price incl. taxes" shown on the page is the MRP; the price that sits only in
 * CEAT's hidden site data is kept privately in `spec.ceatPrice.siteData`, never the MRP (user ruling 2026-11-24).
 * No I/O here.
 */
export const BRAND = { slug: 'ceat', name: 'CEAT' } as const;

const KIND_OF: Readonly<Record<string, TyreKind>> = {
  'Car / SUV tyre': 'car_suv',
  'Motorcycle tyre': 'two_wheeler',
  'Scooter tyre': 'two_wheeler',
  'Commercial (truck / bus) tyre': 'truck_bus',
};

const FIT_TYPE: Readonly<Record<string, string>> = {
  Car: 'car',
  Motorcycle: 'motorcycle',
  Scooter: 'scooter',
};
const FIT_OPTION: Readonly<Record<string, TyreFitment['option']>> = {
  Recommended: 'recommended',
  'Other option': 'other',
  'Upsize option': 'upsize',
};

/** The source text (CEAT's `�` bytes turned into an apostrophe). */
const clean = (t: string | undefined) => (t ?? '').replace(/�/g, "'").trim();

const FEATURE_SPLIT = '; ';

export interface CeatPlanInput {
  tyres: readonly CsvRow[];
  fitment: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; a missing one is left out. */
  pictureExists?: (file: string) => boolean;
}

/** How each source oddity was handled (the import follows the value the CSV states; this text goes into the report). */
function handling(note: string): string {
  if (note.startsWith('Price not shown')) return '';
  if (note.includes('Page label says Tube Less'))
    return `${note}. Handled: the tyre is imported as tube type (TT), as the page address and CEAT's product name say.`;
  if (note.startsWith('Rim shown as'))
    return `${note}. Handled: the rim comes from the size (22.5 inch), not from the page's rim text.`;
  if (note.startsWith('Pattern written'))
    return `${note}. Handled: the pattern name in the product name is used.`;
  if (note.startsWith('No picture on the page'))
    return `${note}. Handled: no photo exists, so the product is a draft until a photo is added.`;
  if (note.startsWith('Page heading says'))
    return `${note}. Handled: the tyre keeps the name of the CSV's "Tyre" column (CEAT's own product name).`;
  if (/category|Listed under/.test(note)) return `${note}. Handled: the product type of the CSV is used.`;
  return `${note}. Handled: the value in the CSV is used.`;
}

export function planCeat(input: CeatPlanInput): TyrePlan {
  const exists = input.pictureExists ?? (() => true);
  const untranslated = new Set<string>();

  // Fitment per tyre name.
  const byTyre = new Map<string, TyreFitment[]>();
  const seen = new Set<string>();
  let orphanFitment = 0;
  for (const f of input.fitment) {
    const tyre = (f.Tyre ?? '').trim();
    const type = FIT_TYPE[f['Vehicle type'] ?? ''];
    if (tyre === '' || !type) {
      orphanFitment += 1;
      continue;
    }
    const option = FIT_OPTION[f.Option ?? ''] ?? null;
    const pos = f['Front / rear'] === 'Front' ? 'front' : f['Front / rear'] === 'Rear' ? 'rear' : null;
    const entry: TyreFitment = {
      vehicleType: type,
      make: (f.Make ?? '').trim(),
      model: (f.Model ?? '').trim(),
      variant: (f.Variant ?? '').trim() || null,
      years: (f['Manufacturing years'] ?? '').trim() || null,
      option,
      position: pos,
    };
    const key = `${tyre}|${type}|${entry.make}|${entry.model}|${entry.variant ?? ''}|${entry.years ?? ''}|${option ?? ''}|${pos ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byTyre.set(tyre, [...(byTyre.get(tyre) ?? []), entry]);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const list of byTyre.values())
    list.sort(
      (a, b) =>
        cmp(a.vehicleType, b.vehicleType) ||
        cmp(a.make, b.make) ||
        cmp(a.model, b.model) ||
        cmp(a.variant ?? '', b.variant ?? '') ||
        cmp(a.years ?? '', b.years ?? ''),
    );

  const checks: TyreCheck[] = [];
  const rows: TyreRow[] = [];

  input.tyres.forEach((t, index) => {
    const sourceRow = index + 1;
    const listed = t['Product type'] ?? '';
    const kind = KIND_OF[listed];
    if (!kind) throw new Error(`Row ${String(sourceRow)}: unknown CEAT product type "${listed}"`);
    const sku = (t.SKU ?? '').trim();
    if (!/^\d+$/.test(sku)) throw new Error(`Row ${String(sourceRow)}: no SKU`);
    const name = titleTyreName(t.Tyre ?? '');
    const nameHi = hindiTyreName(name, kind);
    const pattern = titleTyreName(t.Pattern ?? '');

    const priceShown = rupeesToPaise(t['Price incl. taxes (Rs)']);
    const priceSite = rupeesToPaise(t['Price in site data, not shown on page (Rs)']);
    const extraSpec: Record<string, unknown> = {};
    if (priceShown === null && priceSite !== null)
      extraSpec.ceatPrice = { siteData: { paise: priceSite, gstIncluded: true } };

    const constructionRaw = (t.Construction ?? '').toLowerCase();
    const construction = constructionRaw === 'radial' || constructionRaw === 'bias' ? constructionRaw : null;
    const tl = t['Tubeless / tube type'] ?? '';
    const tubeless = tl === 'Tube Less' ? true : tl === 'Tube Type' ? false : null;
    const posRaw = t.Position ?? '';
    // Front/rear matters on two-wheelers; "Front/Rear" on a car or truck tyre says nothing.
    const position =
      posRaw === 'Front'
        ? 'front'
        : posRaw === 'Rear'
          ? 'rear'
          : posRaw === 'Front/Rear' && kind === 'two_wheeler'
            ? 'both'
            : null;

    const features = (t.Features ?? '')
      .split(FEATURE_SPLIT)
      .map((f) => f.trim())
      .filter((f) => f !== '')
      .map((en) => {
        const hi = CEAT_FEATURES_HI[en];
        if (hi === undefined) untranslated.add(en);
        return { en: cleanSpecText(en.replace(/�/g, "'")), hi: hi ?? '' };
      })
      .filter((f) => f.hi !== '');
    const tagEn = (t.Tagline ?? '').trim();
    const tagHi = CEAT_TAGLINES_HI[tagEn];
    if (tagEn !== '' && tagHi === undefined) untranslated.add(tagEn);

    // Truck and bus extras.
    const extraFacts: Fact[] = [];
    const num = (key: string, labelEn: string, labelHi: string, text: string | undefined, unitHi: string) => {
      const v = decimalOf(text);
      if (v === null) return;
      extraSpec[key] = v;
      extraFacts.push({
        key,
        labelEn,
        labelHi,
        valueEn: `${String(v)} mm`,
        valueHi: `${String(v)} ${unitHi}`,
      });
    };
    num('overallDiameterMm', 'Overall diameter', 'कुल व्यास', t['Overall diameter (mm)'], 'मिमी');
    num('sectionWidthMm', 'Section width', 'सेक्शन चौड़ाई', t['Section width (mm)'], 'मिमी');
    num('treadDepthMm', 'Tread depth', 'ट्रेड की गहराई', t['Tread depth (mm)'], 'मिमी');
    const mPlus = intOf(t['M+ rating']);
    if (mPlus !== null) {
      extraSpec.mPlusRating = mPlus;
      extraFacts.push({
        key: 'mplus',
        labelEn: 'M+ rating',
        labelHi: 'M+ रेटिंग',
        valueEn: String(mPlus),
        valueHi: String(mPlus),
      });
    }
    const usage = clean(t.Usage).replace(/\s+/g, ' ');
    const apps = clean(t.Applications);
    const usageRaw = (t.Usage ?? '').trim();
    const appsRaw = (t.Applications ?? '').trim();
    if (usageRaw !== '') {
      const hi = CEAT_USAGE_HI[usageRaw];
      if (hi === undefined) untranslated.add(usageRaw);
      else {
        extraSpec.usage = usage;
        extraFacts.push({ key: 'usage', labelEn: 'Usage', labelHi: 'उपयोग', valueEn: usage, valueHi: hi });
      }
    }
    if (appsRaw !== '') {
      const hi = CEAT_APPLICATIONS_HI[appsRaw];
      if (hi === undefined) untranslated.add(appsRaw);
      else {
        extraSpec.applications = apps;
        extraFacts.push({
          key: 'applications',
          labelEn: 'Applications',
          labelHi: 'उपयोग के क्षेत्र',
          valueEn: apps,
          valueHi: hi,
        });
      }
    }
    const rimAsShown = clean(t['Rim size (as shown)']);
    if (rimAsShown !== '') extraSpec.rimSizeAsShown = rimAsShown;

    // Source oddities (the "Data checks" column); price notes are covered by the price handling.
    const notes = clean(t['Data checks'])
      .split(/;\s+(?=[A-Z])/)
      .map((n) => n.trim())
      .filter((n) => n !== '');
    if (notes.length > 0) extraSpec.sourceChecks = notes;

    // Pictures: per pattern, 4 views.
    const files = (t['Picture files'] ?? '').split(' | ');
    const urls = (t['Picture URLs'] ?? '').split(' | ');
    const { photos, missing } = planTyrePhotos({
      files,
      urls,
      name,
      nameHi,
      order: CEAT_VIEW_ORDER,
      exists,
    });
    const noPhotoOnSite = (t['Picture files'] ?? '').trim() === '';
    for (const f of missing)
      checks.push({ slug: '', name, note: `Picture file ${f} is not in the folder; left out.` });

    const row: TyreRow = {
      sourceRow,
      brand: { name: 'CEAT', label: 'CEAT' },
      kind,
      listedType: listed,
      name,
      nameHi,
      pattern,
      sizeText: (t.Size ?? '').trim(),
      sourceSku: sku,
      partNumber: sku,
      mrpPaise: priceShown,
      widthMm: decimalOf(t.Width),
      aspectPct: decimalOf(t['Aspect ratio']),
      rimInch: decimalOf(t['Rim (inch)']),
      construction,
      loadIndex: loadIndexText(t['Load index']),
      speedRating: speedSymbol(t['Speed rating']),
      plyRating: intOf(t['Ply rating']),
      tubeless,
      tubeIncluded: (t['Tube included'] ?? '').startsWith('Yes') ? true : null,
      position,
      features,
      tagline: tagEn !== '' && tagHi !== undefined ? { en: tagEn, hi: tagHi } : null,
      extraFacts,
      extraSpec,
      photos,
      fitment: byTyre.get((t.Tyre ?? '').trim()) ?? [],
      productPage: (t['Product page'] ?? '').trim(),
      sharedPhotos: true,
      noPhotoOnSite,
    };
    rows.push(row);
    for (const note of notes) {
      const text = handling(note);
      if (text !== '') checks.push({ slug: '', name, note: text });
    }
  });

  const plan = planTyreRows(rows, {
    source: 'ceat',
    skuPrefix: 'CEAT',
    checks,
    untranslated: [...untranslated],
    orphanFitment,
  });
  // The checks were collected by name; give them the slug of their product.
  const slugOf = new Map(plan.products.map((p) => [p.name, p.slug]));
  for (const c of plan.checks) c.slug = c.slug === '' ? (slugOf.get(c.name) ?? '') : c.slug;
  return plan;
}
