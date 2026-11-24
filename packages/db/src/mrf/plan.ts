import type { CsvRow } from '../battery-import';
import {
  decimalOf,
  hindiTyreName,
  intOf,
  loadIndexText,
  MRF_FEATURES_HI,
  MRF_VIEW_ORDER,
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
import { MRF_DISCONTINUED_TITLES } from './discontinued';

/**
 * MRF catalogue plan (user 2026-11-24, runbook `catalogue-import.md` "MRF tyre import"): the pure step that turns
 * `mrf_tyres.csv` and `mrf_vehicle_fitment.csv` into one product per tyre, tube or flap, named as MRF names it in title
 * case ("MRF Zwyde 175/60R13 77T TL"). Only passenger car and two-wheeler tyres have an MRP on the site; the rest are
 * "price on request". No I/O here.
 */
export const BRAND = { slug: 'mrf', name: 'MRF' } as const;

const KIND_OF: Readonly<Record<string, TyreKind>> = {
  'Passenger car tyre': 'car_suv',
  'Two-wheeler tyre': 'two_wheeler',
  'Three-wheeler tyre': 'three_wheeler',
  'Pick-up tyre': 'light_commercial',
  'LCV tyre (light commercial)': 'light_commercial',
  'SCV tyre (small commercial)': 'light_commercial',
  'ICV tyre (intermediate commercial)': 'truck_bus',
  'MCV tyre (medium commercial)': 'truck_bus',
  'Truck and bus tyre': 'truck_bus',
  'Farm tyre': 'farm',
  'OTR tyre (off the road)': 'otr',
};

const FIT_TYPE: Readonly<Record<string, string>> = { 'Car / SUV': 'car_suv', 'Two-wheeler': 'two_wheeler' };

export interface MrfPlanInput {
  tyres: readonly CsvRow[];
  fitment: readonly CsvRow[];
  /** Whether a picture path (relative to the folder) exists; a missing one is left out. */
  pictureExists?: (file: string) => boolean;
}

interface Entry {
  t: CsvRow;
  sourceRow: number;
  kind: TyreKind;
  /** Title-cased name from the source, before duplicates are told apart. */
  base: string;
  ply: number | null;
  name: string;
  alsoAt: string[];
}

function kindOf(t: CsvRow, sourceRow: number): TyreKind {
  const listed = t['Product type'] ?? '';
  if (listed === 'Tube / flap') return /flap/i.test(`${t.Pattern ?? ''} ${t.Tyre ?? ''}`) ? 'flap' : 'tube';
  const kind = KIND_OF[listed];
  if (!kind) throw new Error(`Row ${String(sourceRow)}: unknown MRF product type "${listed}"`);
  return kind;
}

export function planMrf(input: MrfPlanInput): TyrePlan {
  const exists = input.pictureExists ?? (() => true);
  const untranslated = new Set<string>();
  const checks: TyreCheck[] = [];
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  // Fitment per tyre name (MRF lists the vehicle as one text; its first words are the make).
  const byTyre = new Map<string, TyreFitment[]>();
  const seenFit = new Set<string>();
  for (const f of input.fitment) {
    const tyre = (f.Tyre ?? '').trim();
    const type = FIT_TYPE[f['Vehicle type'] ?? ''];
    const vehicle = (f['Vehicle (as on site)'] ?? '').trim();
    const make = (f['Make (first word)'] ?? '').trim();
    if (tyre === '' || !type || vehicle === '' || make === '') continue;
    const model = vehicle.toLowerCase().startsWith(make.toLowerCase())
      ? vehicle.slice(make.length).trim()
      : vehicle;
    const key = `${tyre}|${type}|${make}|${model}`;
    if (seenFit.has(key)) continue;
    seenFit.add(key);
    byTyre.set(tyre, [
      ...(byTyre.get(tyre) ?? []),
      { vehicleType: type, make, model, variant: null, years: null, option: null, position: null },
    ]);
  }
  for (const list of byTyre.values())
    list.sort((a, b) => cmp(a.vehicleType, b.vehicleType) || cmp(a.make, b.make) || cmp(a.model, b.model));

  // Tell duplicated names apart: one page of a size with a different ply keeps the name plus the ply; pages that say the same are merged.
  const entries: Entry[] = input.tyres.map((t, i) => {
    const plyRaw = (t['Ply rating'] ?? '').trim();
    const ply = intOf(plyRaw);
    const base = titleTyreName(t.Tyre ?? '');
    return {
      t,
      sourceRow: i + 1,
      kind: kindOf(t, i + 1),
      base,
      ply: ply !== null && ply <= 40 ? ply : null,
      name: base,
      alsoAt: [],
    };
  });
  const groups = new Map<string, Entry[]>();
  for (const e of entries) groups.set(e.base, [...(groups.get(e.base) ?? []), e]);
  const dropped = new Set<Entry>();
  for (const [base, list] of groups) {
    if (list.length < 2) continue;
    const plies = new Set(list.map((e) => e.ply));
    if (plies.size > 1)
      for (const e of list)
        e.name = `${base} (${e.ply === null ? 'ply not stated' : `${String(e.ply)} Ply`})`;
    const kept = new Map<string, Entry>();
    for (const e of list) {
      const first = kept.get(e.name);
      if (first) {
        first.alsoAt.push((e.t['Product page'] ?? '').trim());
        dropped.add(e);
      } else kept.set(e.name, e);
    }
    const note =
      plies.size > 1
        ? `The site has ${String(list.length)} pages with this name and different ply ratings; each is a product, named with its ply rating.`
        : `The site has ${String(list.length)} pages with this name and the same data; merged into one product.`;
    for (const e of kept.values()) checks.push({ slug: '', name: e.name, note });
  }

  const rows: TyreRow[] = [];
  for (const e of entries) {
    if (dropped.has(e)) continue;
    const t = e.t;
    const kind = e.kind;
    const name = e.name;
    const nameHi = hindiTyreName(name, kind);
    const pattern = titleTyreName(t.Pattern ?? '');
    const listed = t['Product type'] ?? '';
    const plyRaw = (t['Ply rating'] ?? '').trim();
    const extraSpec: Record<string, unknown> = {};
    const sourceChecks: string[] = [];
    if (/^\d{5}$/.test(plyRaw)) {
      sourceChecks.push(
        `Ply rating shows ${plyRaw} on the site (a spreadsheet date, not a ply count); left blank.`,
      );
      checks.push({
        slug: '',
        name,
        note: `The ply rating reads ${plyRaw} in the source (a date turned into a number); the ply rating is left blank.`,
      });
    }
    for (const url of e.alsoAt) sourceChecks.push(`Also listed on ${url}`);
    if ((t['Tube sold with tyre'] ?? '') === 'undefined')
      sourceChecks.push('Tube sold with tyre: the site says "undefined"; left blank.');
    if (sourceChecks.length > 0) extraSpec.sourceChecks = sourceChecks;

    const constructionRaw = (t.Construction ?? '').toLowerCase();
    const construction = constructionRaw === 'radial' || constructionRaw === 'bias' ? constructionRaw : null;
    const tl = t['Tubeless (TL) / tube type (TT)'] ?? '';
    const tubeless = tl.startsWith('TL') ? true : tl.startsWith('TT') ? false : null;
    const tubeIncluded = (t['Tube sold with tyre'] ?? '').toLowerCase() === 'yes' ? true : null;

    const features = (t.Features ?? '')
      .split('; ')
      .map((f) => f.trim())
      .filter((f) => f !== '')
      .map((en) => {
        const hi = MRF_FEATURES_HI[en];
        if (hi === undefined) untranslated.add(en);
        return { en, hi: hi ?? '' };
      })
      .filter((f) => f.hi !== '');

    const { photos, missing } = planTyrePhotos({
      files: (t['Picture files'] ?? '').split(' | '),
      urls: (t['Picture URLs'] ?? '').split(' | '),
      name,
      nameHi,
      order: MRF_VIEW_ORDER,
      exists,
    });
    for (const f of missing)
      checks.push({ slug: '', name, note: `Picture file ${f} is not in the folder; left out.` });

    const sizeRaw = (t.Size ?? '').trim().replace(/\s+/g, ' ');
    rows.push({
      sourceRow: e.sourceRow,
      brand: { name: 'MRF', label: 'MRF' },
      kind,
      listedType: listed,
      name,
      nameHi,
      pattern,
      sizeText: sizeRaw.replace(/\s+(TL|TT)$/i, ''),
      sourceSku: null,
      partNumber: (t['Tyre name on site'] ?? '').trim() || `${sizeRaw} ${pattern}`,
      mrpPaise: rupeesToPaise(t['MRP incl. GST (Rs)']),
      widthMm: decimalOf(t.Width),
      aspectPct: decimalOf(t['Aspect ratio']),
      rimInch: decimalOf(t['Rim (inch)']),
      construction,
      loadIndex: loadIndexText(t['Load index']),
      speedRating: speedSymbol(t['Speed rating']),
      plyRating: e.ply,
      tubeless,
      tubeIncluded,
      position: null,
      features,
      tagline: null,
      extraFacts: [],
      extraSpec,
      photos,
      fitment: byTyre.get((t.Tyre ?? '').trim()) ?? [],
      productPage: (t['Product page'] ?? '').trim(),
      sharedPhotos: true,
      noPhotoOnSite: (t['Picture files'] ?? '').trim() === '',
    });
  }

  const discontinued = new Set(MRF_DISCONTINUED_TITLES.map((n) => n.toLowerCase()));
  for (const r of rows)
    if (discontinued.has(r.name.toLowerCase()))
      checks.push({
        slug: '',
        name: r.name,
        note: 'The title is on the discontinued pages list; check the page before selling.',
      });
  checks.push({
    slug: '',
    name: 'Discontinued pages',
    note: `${String(MRF_DISCONTINUED_TITLES.length)} pages still exist on mrftyres.com but show no product (listed in the sheet "Discontinued pages" of MRF_Tyres.xlsx). None is in mrf_tyres.csv, so none becomes a product.`,
  });

  const plan = planTyreRows(rows, {
    source: 'mrf',
    skuPrefix: 'MRF',
    checks,
    untranslated: [...untranslated],
  });
  const slugOf = new Map(plan.products.map((p) => [p.name, p.slug]));
  for (const c of plan.checks) if (c.slug === '') c.slug = slugOf.get(c.name) ?? '';
  return plan;
}
