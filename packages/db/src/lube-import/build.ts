import { slugify } from '@mechdost/shared/catalogue-import';
import {
  highlightsOf,
  mfrPart,
  type Fact,
  type PlannedPhoto,
  type PlannedProduct,
  type PlannedVariant,
  type ReportRow,
} from '../battery-import';
import { parseApi, parseBaseType, parseJaso, parseSae, skuBase } from '../catalogue-v2/plan';
import { LUBE_WORDS_HI } from './hindi';
import { LUBE_CATEGORIES, LUBE_GST_RATE_BP } from './kinds';
import { lubeSlug } from './packs-research';
import type { LubeCheck, LubeItem, LubePlan, LubeText, PackResearch, SkippedRow } from './types';

export interface LubeBrand {
  slug: string;
  /** The name products start with and the writer's brand row ("HP", "BPCL MAK"). */
  name: string;
}

export interface LubeBuildOptions {
  brand: LubeBrand;
  /** `spec.source` (the writer finds its own products by it): "hp", "bpcl". */
  source: string;
  skipped: SkippedRow[];
  /** What the researched pack list gave (HP `--packs`). */
  research?: PackResearch;
  checks: LubeCheck[];
  untranslated: string[];
  /** Latin words the Hindi text may keep besides the product names (vehicle makers, standards bodies). */
  allowedWords: ReadonlySet<string>;
}

const BASE_HI: Readonly<Record<string, string>> = {
  mineral: 'मिनरल',
  semi_synthetic: 'सेमी-सिंथेटिक',
  synthetic: 'सिंथेटिक',
};
const BASE_EN: Readonly<Record<string, string>> = {
  mineral: 'Mineral',
  semi_synthetic: 'Semi-synthetic',
  synthetic: 'Synthetic',
};

/** The standards a "Specifications met" text names, as the codes people search for ("API SN/CF", "JASO MA2"). */
export function standardsOf(text: string): {
  api: string[];
  acea: string[];
  jaso: string[];
  ilsac: string[];
} {
  const all = (re: RegExp, fmt: (m: RegExpExecArray) => string) =>
    [...new Set([...text.matchAll(re)].map((m) => fmt(m)))].slice(0, 3);
  return {
    api: all(
      /\bAPI[ :-]*((?:[A-Z]{2}-?\d?|GL-\d)(?: ?(?:PLUS|Plus))?(?:\/(?:[A-Z]{2}-?\d?|GL-\d)(?: ?(?:PLUS|Plus))?)*)/g,
      (m) => `API ${(m[1] ?? '').replace(/ ?(?:PLUS|Plus)/g, ' Plus')}`,
    ),
    acea: all(/\bACEA[ :]*([A-E]\d(?:[/-][A-E]?\d+)*)/g, (m) => `ACEA ${m[1] ?? ''}`),
    jaso: all(
      /\bJASO[ :]*(MA ?2|MA ?1|MA|MB|FC|FD|DH-?\d)/g,
      (m) => `JASO ${(m[1] ?? '').replace(/ /g, '')}`,
    ),
    ilsac: all(/\bILSAC[ :]*(GF-\d[AB]?)/g, (m) => `ILSAC ${m[1] ?? ''}`),
  };
}

/** "API SN, API SL/CF" -> "SN, SL/CF": the fact's label already says which standard it is. */
const codes = (list: readonly string[]): string => list.map((s) => s.replace(/^[A-Z]+ /, '')).join(', ');

const packSpan = (item: LubeItem): string | null => {
  const sorted = [...item.packs].sort((a, b) => a.net.qty - b.net.qty);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return null;
  return first.label === last.label ? first.label : `${first.label} - ${last.label}`;
};

const join = (parts: (string | null | undefined)[], sep: string) =>
  parts.filter((p): p is string => p !== null && p !== undefined && p !== '').join(sep);

function sentence(text: LubeText | null): { en: string; hi: string } | null {
  return text ? { en: text.en.trim(), hi: text.hi.trim() } : null;
}

/** The base oil type the name or the short text says. */
function baseTypeOf(item: LubeItem): string | null {
  return parseBaseType(`${item.name} ${item.shortDescription?.en ?? ''}`);
}

/**
 * The shared planner of the HP and BPCL MAK imports: items (one per oil and grade) -> products, report rows and
 * checks. One product per oil and grade, each pack size a variant (exact label, net quantity, MRP or price on request,
 * its own SKU); the picture is one set per product, never a generic one (a product with only a generic photo is a draft).
 */
export function planLubeItems(items: readonly LubeItem[], opts: LubeBuildOptions): LubePlan {
  const slugs = new Set<string>();
  const skus = new Set<string>();
  const products: PlannedProduct[] = [];
  const rows: ReportRow[] = [];
  const drafts: LubePlan['drafts'] = [];
  const priceOnRequest: LubePlan['priceOnRequest'] = [];
  const checks = [...opts.checks];
  let slugCollisions = 0;
  let skuCollisions = 0;
  const names = new Set<string>();

  for (const item of items) {
    const info = LUBE_CATEGORIES[item.category];
    const category = info.category;
    let slug = lubeSlug(item.name);
    if (slugs.has(slug)) {
      slugCollisions += 1;
      let n = 2;
      while (slugs.has(`${slug}-${String(n)}`)) n += 1;
      slug = `${slug}-${String(n)}`;
      checks.push({
        slug,
        name: item.name,
        note: 'Another product has the same name; the slug got a number.',
      });
    }
    slugs.add(slug);
    names.add(item.name);
    for (const note of item.checks) checks.push({ slug, name: item.name, note });

    // Packs -> variants. No pack listed: one variant, price on request.
    const variants: PlannedVariant[] = [];
    const labels = new Set<string>();
    const list = item.packs.length > 0 ? item.packs : [null];
    for (const pack of list) {
      const label = pack?.label ?? 'Standard pack';
      if (labels.has(label)) continue;
      labels.add(label);
      let sku = skuBase(opts.brand.name, item.name.replace(/\+/g, ' PLUS '), label);
      if (skus.has(sku)) {
        skuCollisions += 1;
        sku = `${sku.slice(0, 58)}-${String(skuCollisions)}`;
      }
      skus.add(sku);
      variants.push({
        sku,
        model: label,
        mrpPaise: pack?.mrpPaise ?? null,
        weightG: null,
        netQuantity: pack?.net ?? { qty: 1, unit: 'piece' },
        options: { label },
        barcode: null,
        partNumbers: [],
      });
      if ((pack?.mrpPaise ?? null) === null) priceOnRequest.push({ slug, name: item.name, sku });
    }
    const first = variants[0];
    if (!first) continue;

    // Facts: what the product page and the compare table show first.
    const stds = standardsOf(`${item.specsMet} ${item.name}`);
    const base = [
      'car-engine-oil',
      'motorcycle-oil',
      'diesel-engine-oil',
      'heavy-duty-oils',
      'gear-oils',
      'tractor-agri-oils',
    ].includes(item.category)
      ? baseTypeOf(item)
      : null;
    const facts: Fact[] = [];
    const fact = (key: string, labelEn: string, labelHi: string, valueEn: string, valueHi = valueEn) =>
      facts.push({ key, labelEn, labelHi, valueEn, valueHi });
    if (item.grade) fact('grade', 'Grade', 'ग्रेड', item.grade);
    if (stds.api.length > 0) fact('api', 'API', 'API', codes(stds.api));
    if (stds.acea.length > 0) fact('acea', 'ACEA', 'ACEA', codes(stds.acea));
    if (stds.jaso.length > 0) fact('jaso', 'JASO', 'JASO', codes(stds.jaso));
    if (stds.ilsac.length > 0) fact('ilsac', 'ILSAC', 'ILSAC', codes(stds.ilsac));
    if (base) fact('base', 'Oil type', 'ऑयल का प्रकार', BASE_EN[base] ?? base, BASE_HI[base] ?? base);
    const span = packSpan(item);
    if (span) fact('packs', 'Pack sizes', 'पैक साइज़', span);

    const app = sentence(item.application);
    const short = sentence(item.shortDescription);
    const features = item.features;
    const { highlights, highlightsHi } = highlightsOf(
      facts,
      ['grade', 'api', 'acea', 'jaso', 'ilsac', 'base', 'packs'],
      features.map((f) => f.en),
      features.map((f) => f.hi),
    );

    const typeEn = item.typeEn ?? info.typeEn;
    const typeHi = item.typeHi ?? info.typeHi;
    const descEn = [`${item.name}: ${typeEn} by ${opts.brand.name}.`];
    const descHi = [`${item.nameHi}: ${opts.brand.name} का ${typeHi}।`];
    if (short) {
      descEn.push(short.en);
      descHi.push(short.hi);
    }
    if (app) {
      descEn.push(`Application: ${app.en}`);
      descHi.push(`उपयोग: ${app.hi}`);
    }
    if (facts.length > 0) {
      descEn.push(`Specifications: ${facts.map((f) => `${f.labelEn} ${f.valueEn}`).join('; ')}.`);
      descHi.push(`तकनीकी जानकारी: ${facts.map((f) => `${f.labelHi} ${f.valueHi}`).join('; ')}।`);
    }

    // Typed spec (the same shape as Castrol: `saeGrade`, `apiClass`, `jasoClass`, `baseType`) plus the maker's data.
    const spec: Record<string, unknown> = { source: opts.source, productType: item.category };
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') spec[key] = value;
    };
    put('saeGrade', parseSae(item.grade ?? ''));
    put('apiClass', parseApi(item.specsMet) ?? parseApi(item.name));
    put('jasoClass', parseJaso(`${item.specsMet} ${item.name}`));
    put('baseType', base);
    put('grade', item.grade);
    put('listedRange', item.listedRange);
    put('listedCategory', item.listedCategory);
    put('standards', Object.values(stds).flat());
    put('specificationsMet', item.specsMet);
    if (Object.keys(item.properties).length > 0) spec.properties = item.properties;
    put('packCount', item.packs.length);
    put('photoKind', item.photoFile && item.draftReason === null && item.photoSharedBy > 1 ? 'range' : '');
    put('draftReason', item.draftReason);
    put('sourceDocs', item.sourceDocs);
    const packSources = item.packSources;
    if (packSources)
      spec.packSources = Object.fromEntries(
        variants.flatMap((v) => {
          const source = packSources[v.model];
          return source ? [[v.sku, source]] : [];
        }),
      );
    for (const [k, v] of Object.entries(item.extraSpec)) put(k, v);

    const photos: PlannedPhoto[] =
      item.photoFile && item.draftReason === null
        ? [
            {
              file: item.photoFile,
              sourceUrl: item.sourceDocs.pictureUrl.slice(0, 500),
              alt: item.name,
              altHi: item.nameHi,
            },
          ]
        : [];
    const draft = photos.length === 0;
    if (draft) {
      const reason = item.draftReason ?? 'no_photo_file';
      drafts.push({ slug, name: item.name, reason });
    }

    const specSummary = join([category.name, item.grade, span], ' · ').slice(0, 200);
    const specSummaryHi = join([category.nameHi, item.grade, span], ' · ').slice(0, 200);
    const vehicleTypes = item.vehicleTypes.length > 0 ? item.vehicleTypes : info.vehicleTypes;

    products.push({
      sourceRow: item.sourceRows[0] ?? 0,
      productType: item.category,
      slug,
      range: {
        slug: slugify(`${opts.brand.slug} ${category.slug}`),
        name: `${opts.brand.name} ${category.name}`,
        nameHi: `${opts.brand.name} ${category.nameHi}`,
      },
      category,
      name: item.name,
      nameHi: item.nameHi,
      description: descEn.join('\n\n'),
      descriptionHi: descHi.join('\n\n'),
      specSummary,
      specSummaryHi,
      compatibility: null,
      compatibilityHi: null,
      highlights,
      highlightsHi,
      vehicleTypes,
      spec,
      warranty: null,
      hsn: item.hsn ?? info.hsn,
      gstRateBp: LUBE_GST_RATE_BP,
      status: draft ? 'draft' : 'live',
      variants,
      variant: first,
      partNumbers: [],
      partNumber: mfrPart(first.sku),
      photos,
      photo: photos[0] ?? null,
      fitmentCount: 0,
    });

    for (const v of variants) {
      rows.push({
        sourceRow: item.sourceRows[0] ?? 0,
        productType: item.category,
        range: item.listedCategory,
        model: v.model,
        name: item.name,
        slug,
        sku: v.sku,
        category: category.slug,
        mrpRupees: v.mrpPaise === null ? '' : String(v.mrpPaise / 100),
        warrantyMonths: '',
        fitmentCount: 0,
        photoFile: photos[0]?.file ?? '',
        photoKind: photos[0] && item.photoSharedBy > 1 ? 'range' : 'model',
        status: draft ? `draft: ${item.draftReason ?? 'no_photo_file'}` : 'live',
      });
    }
  }

  // Latin words the Hindi text may keep: makers and standards (given), the brand, and the model words of the product names.
  const words = new Set<string>(opts.allowedWords);
  for (const p of products)
    for (const w of `${p.nameHi} ${p.range.nameHi} ${p.name}`.match(/[A-Za-z]{3,}/g) ?? []) {
      const word = w.toLowerCase();
      if (!(word in LUBE_WORDS_HI)) words.add(word);
    }
  return {
    products,
    rows,
    untranslated: opts.untranslated,
    vehicleWords: words,
    slugCollisions,
    skuCollisions,
    orphanFitment: 0,
    skipped: opts.skipped,
    research: opts.research,
    drafts,
    checks,
    priceOnRequest,
  };
}
