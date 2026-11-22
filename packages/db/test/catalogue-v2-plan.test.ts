/**
 * Catalogue-v2 plan (design 2026-11-22): the pure step from the source JSON to what the database holds. Fixture:
 * ~20 real products copied from `catalogue-v2/site/data` (texts cut short, no pictures).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cleanText,
  emptyReport,
  fillMissingMrps,
  newPlanState,
  parseNetQuantity,
  parseSae,
  planSection,
  SECTIONS,
  skuBase,
  statusCsv,
  statusMarkdown,
  summarise,
  type PlannedProduct,
  type Section,
  type SourceProduct,
} from '../src/catalogue-v2';

type Fixture = Record<Section, SourceProduct[]> & { img: never[] };
const fx = JSON.parse(
  readFileSync(new URL('./fixtures/catalogue-v2.json', import.meta.url), 'utf8'),
) as Fixture;

function plan(translations?: Map<string, string>) {
  const report = emptyReport();
  const state = newPlanState();
  const products: PlannedProduct[] = [];
  for (const section of SECTIONS)
    products.push(
      ...planSection({ section, products: fx[section], images: fx.img, translations }, report, state),
    );
  return { products, report: summarise(products, report) };
}

describe('selection', () => {
  it('skips products whose only picture is representative (r) and counts them', () => {
    const { products, report } = plan();
    expect(report.skippedRepresentative).toBeGreaterThanOrEqual(5);
    expect(products.every((p) => p.photo !== null)).toBe(true);
  });

  it('keeps every pack of a product, with or without MRP', () => {
    const { products } = plan();
    const duramax = products.find((p) => p.name === 'DURAMAX LE');
    expect(duramax?.packs.length).toBeGreaterThanOrEqual(2);
    expect(duramax?.packs.some((k) => k.mrpPaise === null)).toBe(true);
    expect(duramax?.packs.some((k) => k.mrpPaise !== null)).toBe(true);
  });
});

describe('SKUs and slugs', () => {
  it('SKUs are valid, unique and stable between runs', () => {
    const a = plan().products.flatMap((p) => p.packs.map((k) => k.sku));
    const b = plan().products.flatMap((p) => p.packs.map((k) => k.sku));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const sku of a) expect(sku).toMatch(/^[A-Z0-9][A-Z0-9._-]{1,63}$/);
  });

  it('a very long name is cut with a hash so two long names never collide', () => {
    const long = 'X'.repeat(80);
    const one = skuBase('Brand', `${long}A`, '1 L');
    const two = skuBase('Brand', `${long}B`, '1 L');
    expect(one.length).toBeLessThanOrEqual(64);
    expect(one).not.toBe(two);
  });

  it('does not say the brand twice', () => {
    expect(skuBase('Valvoline', 'Valvoline Superkool', '1 L')).toBe('VALVOLINE-SUPERKOOL-1-L');
  });

  it('products sharing a name get different, deterministic slugs', () => {
    const { products } = plan();
    const dupes = products.filter((p) => p.name === 'ENDURACE LD');
    expect(dupes.length).toBe(2);
    expect(new Set(dupes.map((p) => p.slug)).size).toBe(2);
    expect(new Set(products.map((p) => p.slug)).size).toBe(products.length);
  });
});

describe('MRP and pack size', () => {
  it('rupees become integer paise; a blank MRP stays null (price on request)', () => {
    const { products } = plan();
    const exide = products.find((p) => p.brand.slug === 'exide' && p.name === 'Exide Xplore');
    expect(exide?.packs[0]?.mrpPaise).toBe(117500);
    expect(Number.isInteger(exide?.packs[0]?.mrpPaise)).toBe(true);
    expect(products.find((p) => p.brand.slug === 'apollo')?.packs.every((k) => k.mrpPaise === null)).toBe(
      true,
    );
  });

  it('reads pack sizes in a base unit', () => {
    expect(parseNetQuantity('900 ml')).toEqual({ qty: 900, unit: 'ml' });
    expect(parseNetQuantity('3.5 L')).toEqual({ qty: 3500, unit: 'ml' });
    expect(parseNetQuantity('0.200L')).toEqual({ qty: 200, unit: 'ml' });
    expect(parseNetQuantity('5 kg')).toEqual({ qty: 5000, unit: 'g' });
    expect(parseNetQuantity('37 gm')).toEqual({ qty: 37, unit: 'g' });
    expect(parseNetQuantity('1 nos.')).toEqual({ qty: 1, unit: 'piece' });
    expect(parseNetQuantity('XLTZ4A')).toBeNull();
    expect(parseNetQuantity('210 L')).toEqual({ qty: 210000, unit: 'ml' });
  });

  it('an empty pack label falls back to the "Packs" spec', () => {
    const helmet = plan().products.find((p) => p.name === 'MOTUL HELMET CARE KIT');
    expect(helmet?.packs[0]?.label).toBe('0.200L');
    expect(helmet?.packs[0]?.netQuantity).toEqual({ qty: 200, unit: 'ml' });
  });
});

describe('attributes, tax, fitment', () => {
  it('reads the viscosity grade in any spelling', () => {
    expect(parseSae('ACTIV 4T 10W-30')).toBe('10W30');
    expect(parseSae('Gulf 20 W 40')).toBe('20W40');
    expect(parseSae('5W/30 SN')).toBe('5W30');
    expect(parseSae('SAE 90')).toBeNull();
  });

  it('typed attributes only where valid; motorcycle oil is a 2W product', () => {
    const { products } = plan();
    const castrol = products.find((p) => p.brand.slug === 'castrol' && p.name.startsWith('ACTIV 4T'));
    expect(castrol?.attributes.saeGrade).toBe('10W30');
    expect(castrol?.vehicleTypes).toEqual(['2W']);
    expect(castrol?.category.slug).toBe('motorcycle-oil');
    expect(castrol?.category.parent).toBe('lubricants');
    const exide = products.find((p) => p.name === 'Exide Xplore');
    expect(exide?.attributes).toMatchObject({ freeReplacementMonths: 24, proRataMonths: 24 });
  });

  it('HSN and GST per section; tyres are 18 %', () => {
    const { products } = plan();
    expect(products.find((p) => p.brand.slug === 'apollo')).toMatchObject({ hsn: '4011', gstRateBp: 1800 });
    expect(products.find((p) => p.name === 'Exide Xplore')).toMatchObject({ hsn: '8507', gstRateBp: 1800 });
    expect(products.find((p) => p.brand.slug === 'castrol' && p.name.startsWith('ACTIV'))).toMatchObject({
      hsn: '2710',
    });
    expect(products.find((p) => p.brand.slug === 'fleetguard')).toMatchObject({ hsn: '8421' });
  });

  it('a names-only entry (no product list) is a draft, not live', () => {
    const { products, report } = plan();
    const pz = products.find((p) => p.brand.slug === 'powerzone');
    expect(pz?.status).toBe('draft');
    expect(pz?.draftReason).toBe('names_only');
    expect(report.drafts).toBeGreaterThanOrEqual(1);
    expect(products.find((p) => p.name === 'Exide Xplore')?.status).toBe('live');
  });

  it('ranges come from the source series', () => {
    const exide = plan().products.find((p) => p.name === 'Exide Xplore');
    expect(exide?.range).toMatchObject({ name: 'Exide Xplore' });
    expect(exide?.range?.slug).toBe('exide-xplore');
  });
});

describe('Hindi', () => {
  it('names and sub-categories are translated where the glossary knows the words; brands stay Latin', () => {
    const { products } = plan();
    const diesel = products.find((p) => p.name.startsWith('Valvoline Premium Blue'));
    expect(diesel?.nameHi).toContain('डीज़ल');
    expect(diesel?.nameHi).toContain('Valvoline');
    expect(diesel?.category.nameHi).toBe('डीज़ल इंजन ऑयल');
    expect(products.every((p) => p.specSummaryHi.length > 0 && p.nameHi.length > 0)).toBe(true);
  });

  it('highlights line up one for one in both languages', () => {
    for (const p of plan().products) expect(p.highlightsHi.length).toBe(p.highlights.length);
  });

  it('descriptions are not machine-translated word by word; a translations file fills them', () => {
    const none = plan().products.find((p) => p.description !== null);
    expect(none?.descriptionHi).toBeNull();
    const text = none?.description ?? '';
    const withFile = plan(new Map([[text, 'हिंदी विवरण']])).products.find((p) => p.description === text);
    expect(withFile?.descriptionHi).toBe('हिंदी विवरण');
  });
});

describe('text cleaning', () => {
  it('repairs the broken bytes of the export', () => {
    expect(cleanText('windshield�s clarity')).toBe("windshield's clarity");
    expect(cleanText('Fleetguard� provides')).toBe('Fleetguard provides');
  });
});

describe('price list fills', () => {
  const row = (over: Partial<Parameters<typeof fillMissingMrps>[1][number]>) => ({
    file: 'gulf.pdf',
    page: 3,
    brand: 'Gulf',
    product: 'DURAMAX LE',
    pack: '210 L',
    mrpRupees: 71000,
    ...over,
  });

  it('fills a missing MRP on an exact brand + product + pack match and reports file and page', () => {
    const { products } = plan();
    const fills = fillMissingMrps(products, [row({})]);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ pack: '210 L', mrpPaise: 7_100_000, file: 'gulf.pdf', page: 3 });
    const pack = products.find((p) => p.name === 'DURAMAX LE')?.packs.find((k) => k.label === '210 L');
    expect(pack?.mrpPaise).toBe(7_100_000);
    expect(pack?.mrpFill).toEqual({ file: 'gulf.pdf', page: 3 });
  });

  it('compares pack sizes as quantities (0.9 L = 900 ml)', () => {
    const { products } = plan();
    const target = products.flatMap((p) => p.packs).find((k) => k.label === '210 L');
    expect(target).toBeDefined();
    expect(fillMissingMrps(products, [row({ pack: '210 Ltr' })])).toHaveLength(1);
  });

  it('never fills on a near match, another brand, a blank brand, an ambiguous pair or a zero price', () => {
    const { products } = plan();
    expect(fillMissingMrps(products, [row({ product: 'DURAMAX LEX' })])).toHaveLength(0);
    expect(fillMissingMrps(products, [row({ brand: 'Castrol' })])).toHaveLength(0);
    expect(fillMissingMrps(products, [row({ brand: '' })])).toHaveLength(0);
    expect(fillMissingMrps(products, [row({ mrpRupees: 0 })])).toHaveLength(0);
    expect(
      fillMissingMrps(products, [row({ mrpRupees: 100 }), row({ mrpRupees: 200, page: 4 })]),
    ).toHaveLength(0);
  });

  it('never overwrites an MRP catalogue-v2 already has', () => {
    const { products } = plan();
    const castrol = products.find((p) => p.brand.slug === 'castrol' && p.name.startsWith('ACTIV'));
    const pack = castrol?.packs.find((k) => k.mrpPaise !== null);
    const before = pack?.mrpPaise;
    fillMissingMrps(products, [
      {
        file: 'x.pdf',
        page: 1,
        brand: 'Castrol',
        product: castrol?.name ?? '',
        pack: pack?.label ?? '',
        mrpRupees: 1,
      },
    ]);
    expect(pack?.mrpPaise).toBe(before);
  });
});

describe('selection: price-list brands with a real picture', () => {
  const run = (over: Partial<Parameters<typeof planSection>[0]> = {}) => {
    const report = emptyReport();
    const out: PlannedProduct[] = [];
    const state = newPlanState();
    for (const section of SECTIONS)
      out.push(...planSection({ section, products: fx[section], images: fx.img, ...over }, report, state));
    return { products: out, report: summarise(out, report) };
  };

  it('imports only the chosen brands; every other product gets a status row with a reason', () => {
    const { products, report } = run({ brands: new Set(['castrol', 'exide']) });
    expect(new Set(products.map((p) => p.brand.slug))).toEqual(new Set(['castrol', 'exide']));
    const total = SECTIONS.reduce((n, s) => n + fx[s].length, 0);
    expect(report.rows).toHaveLength(total);
    expect(report.rows.filter((r) => r.status === 'imported')).toHaveLength(products.length);
    const skipped = report.rows.filter((r) => r.status === 'skipped');
    expect(skipped.every((r) => r.reason !== '')).toBe(true);
    expect(skipped.some((r) => r.reason === 'not_price_list_brand')).toBe(true);
    expect(report.rows.filter((r) => r.status === 'imported').every((r) => r.slug !== '')).toBe(true);
  });

  it('a representative picture is skipped with its own reason', () => {
    const { report } = run({
      brands: new Set(['castrol', 'gulf', 'motul', 'exide', 'apollo', 'fleetguard']),
    });
    expect(report.rows.some((r) => r.reason === 'representative_picture')).toBe(true);
  });

  it('never imports a product whose picture entry is missing or empty (no_picture_bytes)', () => {
    const empty = fx.img.map((e, i) => (i === 0 ? [e[0], [e[1][0], 0, 0]] : e));
    const { products, report } = run({ images: empty as never, brands: new Set(['castrol']) });
    const first = fx.lub.find((p) => p.b === 'Castrol' && !p.r && p.i === 0);
    if (first) {
      expect(products.some((p) => p.sourceId === first.id && p.section === 'lub')).toBe(false);
      const row = report.rows.find((r) => r.section === 'lub' && r.sourceId === first.id);
      expect(row).toMatchObject({ status: 'skipped', reason: 'no_picture_bytes', detail: 'EMPTY_PICTURE' });
    }
    expect(products.every((p) => p.photo !== null && p.photo.length > 0)).toBe(true);
    const missing = run({ images: [] as never, brands: new Set(['castrol']) });
    expect(missing.products).toHaveLength(0);
    expect(missing.report.skippedNoPhoto.length).toBeGreaterThan(0);
  });

  it('writes the status report as CSV (one row each, quoted) and a markdown summary', () => {
    const { report } = run({ brands: new Set(['castrol']) });
    const csv = statusCsv(report.rows);
    expect(csv.split('\n')[0]).toBe(
      'section,source_id,brand,range,product,packs,packs_with_mrp,mrp_filled_from_price_list,status,reason,detail,slug',
    );
    expect(csv.trim().split('\n')).toHaveLength(report.rows.length + 1);
    const first = report.rows[0];
    if (first) expect(statusCsv([{ ...first, name: 'A, "B"' }])).toContain('"A, ""B"""');
    const md = statusMarkdown(report.rows, { run: 'dry run', brands: 'castrol' });
    expect(md).toContain('not_price_list_brand');
    expect(md).toContain('pnpm db:import:catalogue');
  });
});
