/**
 * HP and BPCL MAK lubricant plans (user 2026-11-25): automotive only (every skipped row listed with its reason), one product
 * per oil and grade, each pack a variant with its exact label, net quantity and MRP (BPCL "Rs 354/-" is the MRP; no price
 * means price on request; HP has no prices), a generic photo is never a product photo (the product is a draft), duplicates
 * merge, typed spec like Castrol's, the data-sheet link is private, and the Hindi is complete.
 */
import { describe, expect, it } from 'vitest';
import { planHindiLeftovers, type CsvRow } from '../src/battery-import';
import { planBpcl, planHp } from '../src/lube-import';

const row = (r: Record<string, string>): CsvRow => r;
const PAGE = 'https://www.bharatpetroleum.in/x/';

const bpclProducts = [
  row({
    Product: 'MAK ALPHA ZENITH 5W-40',
    Range: 'Automobile lubricants',
    Category: 'Cars and SUVs',
    'Specifications met': 'ACEA A3/B4 API SN',
    'Product page': `${PAGE}az`,
    'Picture file': 'pictures/az.jpg',
    'Picture note': 'Own photo',
    'Data sheet URL': 'https://example.test/az.pdf',
  }),
  row({
    Product: 'MAK SPIROL EP 80W, 90, 140, 80W-90',
    Range: 'Automobile lubricants',
    Category: 'Gears and transmission',
    'Product page': `${PAGE}spirol`,
    'Picture file': 'pictures/spirol.jpg',
    'Picture note': 'Own photo',
  }),
  row({
    Product: 'MAK ATF-A',
    Range: 'Automobile lubricants',
    Category: 'Gears and transmission',
    'Product page': `${PAGE}atf`,
    'Picture file': 'pictures/barrel.jpg',
    'Picture note': 'Same photo used for 145 products',
  }),
  row({
    Product: 'MAK PLATINUM 15W-40',
    Range: 'Automobile lubricants',
    Category: 'Trucks and buses',
    'Product page': `${PAGE}plat1`,
    'Picture file': 'pictures/plat.jpg',
    'Picture note': 'Own photo',
  }),
  row({
    Product: 'MAK PLATINUM 15W-40',
    Range: 'Automobile lubricants',
    Category: 'Trucks and buses',
    'Product page': `${PAGE}plat2`,
    'Picture file': 'pictures/plat.jpg',
    'Picture note': 'Own photo',
  }),
  row({
    Product: 'MAK® BRAKE FLUID',
    Range: 'Automobile lubricants',
    Category: 'Specialties',
    'Product page': `${PAGE}bf`,
    'Picture file': 'pictures/bf.jpg',
    'Picture note': 'Own photo',
  }),
  row({
    Product: 'MAK BOAT XP 15W-40',
    Range: 'Automobile lubricants',
    Category: 'Marine boats',
    'Product page': `${PAGE}boat`,
  }),
  row({
    Product: 'MAK HYDROL 68',
    Range: 'Industrial lubricants',
    Category: 'Industrial oils',
    'Product page': `${PAGE}hydrol`,
  }),
];
const pack = (page: string, size: string, price: string) =>
  row({ 'Product page': `${PAGE}${page}`, 'Pack size': size, 'Price (Rs)': price });
const bpclPacks = [
  pack('az', '1 Litre', '670.0'),
  pack('az', '3.5 Litre', '2275.0'),
  pack('az', '210 Litre', ''),
  pack('spirol', '500 ML', '189.0'),
  pack('plat1', '1 Litre', '405.0'),
  pack('plat2', '1 Litre', '405.0'),
  pack('plat2', '500 ml', '205.0'),
  pack('bf', '100 ML', '46.0'),
];
const bpclGrades = [
  row({
    Product: 'MAK ALPHA ZENITH 5W-40',
    Grade: 'Alpha Zenith 5W-40',
    Property: 'KV@100�C, cSt',
    Value: '14',
  }),
  row({ Product: 'MAK ALPHA ZENITH 5W-40', Grade: 'Alpha Zenith 5W-40', Property: 'VI', Value: '170' }),
  row({
    Product: 'MAK SPIROL EP 80W, 90, 140, 80W-90',
    Grade: 'MAK SPIROL EP 90',
    Property: 'VI',
    Value: '96',
  }),
  row({
    Product: 'MAK SPIROL EP 80W, 90, 140, 80W-90',
    Grade: 'MAK SPIROL EP 80W',
    Property: 'VI',
    Value: '100',
  }),
];
const bpcl = planBpcl({ products: bpclProducts, packs: bpclPacks, grades: bpclGrades });
const bySlug = (p: typeof bpcl, slug: string) => {
  const found = p.products.find((x) => x.slug === slug);
  if (!found) throw new Error(`no product ${slug}`);
  return found;
};

describe('BPCL MAK plan', () => {
  it('skips the industrial and marine rows with their reason, and keeps one product per grade', () => {
    expect(bpcl.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['MAK BOAT XP 15W-40', 'marine'],
      ['MAK HYDROL 68', 'industrial'],
    ]);
    expect(bpcl.products.map((p) => p.name)).toEqual([
      'BPCL MAK Alpha Zenith 5W-40',
      'BPCL MAK Spirol EP 80W',
      'BPCL MAK Spirol EP 90',
      'BPCL MAK Spirol EP 140',
      'BPCL MAK Spirol EP 80W-90',
      'BPCL MAK ATF-A',
      'BPCL MAK Platinum 15W-40',
      'BPCL MAK Brake Fluid',
    ]);
  });

  it('writes each pack with its exact label, net quantity and MRP, and price on request without a price', () => {
    const az = bySlug(bpcl, 'bpcl-mak-alpha-zenith-5w-40');
    expect(az.variants.map((v) => [v.model, v.netQuantity, v.mrpPaise])).toEqual([
      ['1 L', { qty: 1000, unit: 'ml' }, 67000],
      ['3.5 L', { qty: 3500, unit: 'ml' }, 227500],
      ['210 L', { qty: 210000, unit: 'ml' }, null],
    ]);
    expect(az.variants.map((v) => v.options)).toEqual([
      { label: '1 L' },
      { label: '3.5 L' },
      { label: '210 L' },
    ]);
    expect(new Set(az.variants.map((v) => v.sku)).size).toBe(3);
    expect(bpcl.priceOnRequest.map((p) => p.sku)).toContain(az.variants[2]?.sku);
  });

  it('keeps the typed spec like Castrol and the data sheet link private-keyed', () => {
    const az = bySlug(bpcl, 'bpcl-mak-alpha-zenith-5w-40');
    expect(az.spec).toMatchObject({
      source: 'bpcl',
      saeGrade: '5W40',
      apiClass: 'SN',
      grade: '5W-40',
      properties: { kv100Cst: 14, viscosityIndex: 170 },
      sourceDocs: { dataSheetUrl: 'https://example.test/az.pdf' },
    });
    expect(az.hsn).toBe('2710');
    expect(az.gstRateBp).toBe(1800);
    expect(az.category.slug).toBe('car-engine-oil');
    expect(bySlug(bpcl, 'bpcl-mak-brake-fluid').hsn).toBe('3819');
  });

  it('gives each grade of a multi-grade page its own grade properties', () => {
    expect(bySlug(bpcl, 'bpcl-mak-spirol-ep-90').spec).toMatchObject({ properties: { viscosityIndex: 96 } });
    expect(bySlug(bpcl, 'bpcl-mak-spirol-ep-80w').spec).toMatchObject({
      properties: { viscosityIndex: 100 },
    });
  });

  it('never uses a generic photo: the product is a draft with its reason and no photo', () => {
    const atf = bySlug(bpcl, 'bpcl-mak-atf-a');
    expect(atf.status).toBe('draft');
    expect(atf.photos).toEqual([]);
    expect(bpcl.drafts).toEqual([
      { slug: 'bpcl-mak-atf-a', name: 'BPCL MAK ATF-A', reason: 'generic_photo_only' },
    ]);
    expect(bySlug(bpcl, 'bpcl-mak-alpha-zenith-5w-40').status).toBe('live');
  });

  it('merges a product listed twice and its packs', () => {
    const plat = bySlug(bpcl, 'bpcl-mak-platinum-15w-40');
    expect(plat.variants.map((v) => v.model)).toEqual(['500 ml', '1 L']);
    expect(bpcl.checks.some((c) => c.slug === plat.slug && c.note.includes('Listed 2 times'))).toBe(true);
  });

  it('plans the Hindi without English leftovers for names, and untranslated texts are reported', () => {
    expect(planHindiLeftovers(bpcl)).toEqual([]);
    expect(bySlug(bpcl, 'bpcl-mak-brake-fluid').nameHi).toBe('BPCL MAK ब्रेक फ्लूइड');
  });
});

const hpProducts = [
  row({
    Product: 'HP RACER 10W-30, 20W-40',
    Range: 'Automotive Oils',
    Category: 'Bike Two Wheeler Engine Oils',
    'Specifications met': 'API SL; JASO MA2',
    'Product page': 'https://www.hplubricants.in/racer',
    'Picture file': 'pictures/racer.jpg',
    'Picture note': 'Own photo',
  }),
  row({
    Product: 'HP RAIL ROAD OIL 613',
    Range: 'Automotive Oils',
    Category: 'Railroad Engine Oils',
  }),
  row({
    Product: 'HP DEF',
    Range: 'Specialties',
    Category: 'Diesel Exhaust Fluid',
    'Picture file': 'pictures/def.jpg',
  }),
  row({
    Product: 'HP EV KOOLGARD',
    Range: 'Automotive Oils',
    Category: 'Ev And Hybrid Range',
    'Picture file': 'pictures/ev.jpg',
  }),
  row({
    Product: 'HP GEAR OIL XP 80W 90',
    Range: 'Automotive Oils',
    Category: 'Gear And Transmission Oils',
    'Picture file': 'pictures/drum.jpg',
    'Picture note': 'Same photo used for 223 products',
  }),
  row({
    Product: 'HP RACER SYNTH GEN6 10W-50',
    Range: 'Automotive Oils',
    Category: 'Bike Two Wheeler Engine Oils',
    'Picture file': 'pictures/synth.jpg',
    'Picture note': 'Own photo',
  }),
  row({
    Product: 'HP HYDRAULIC 68',
    Range: 'Industrial Oils',
    Category: 'Hydraulic Oils',
    'Picture file': 'pictures/synth2.jpg',
  }),
  row({
    Product: 'HP NATURAL GAS ENGINE OIL A 40',
    Range: 'Automotive Oils',
    Category: 'Auto Lpg And Cng Engine Oils',
  }),
];
const same: Record<string, string> = { 'pictures/synth.jpg': 'drum', 'pictures/synth2.jpg': 'drum' };
const hash = (f: string) => same[f] ?? f;
const hp = planHp({
  products: hpProducts,
  grades: [],
  pictureHash: hash,
});

describe('HP plan', () => {
  it('keeps automotive rows and skips railroad, industrial and stationary gas engine rows', () => {
    expect(hp.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['HP RAIL ROAD OIL 613', 'railroad'],
      ['HP HYDRAULIC 68', 'industrial'],
      ['HP NATURAL GAS ENGINE OIL A 40', 'stationary_gas_engine'],
    ]);
    expect(hp.products.map((p) => [p.name, p.category.slug])).toEqual([
      ['HP Racer 10W-30', 'motorcycle-oil'],
      ['HP Racer 20W-40', 'motorcycle-oil'],
      ['HP DEF', 'speciality-oils'],
      ['HP EV Koolgard', 'coolants'],
      ['HP Gear Oil XP 80W-90', 'gear-oils'],
      ['HP Racer Synth GEN6 10W-50', 'motorcycle-oil'],
    ]);
  });

  it('has no prices and no pack sizes: one price-on-request pack per product', () => {
    for (const p of hp.products) {
      expect(p.variants).toHaveLength(1);
      expect(p.variants[0]?.mrpPaise).toBeNull();
    }
    expect(hp.priceOnRequest).toHaveLength(hp.products.length);
  });

  it('treats a file shared with an industrial product as generic even when the note says own photo', () => {
    const synth = hp.products.find((p) => p.slug === 'hp-racer-synth-gen6-10w-50');
    expect(synth?.status).toBe('draft');
    expect(hp.drafts.map((d) => [d.slug, d.reason])).toEqual([
      ['hp-gear-oil-xp-80w-90', 'generic_photo_only'],
      ['hp-racer-synth-gen6-10w-50', 'generic_photo_only'],
    ]);
  });

  it('a pack photo of another product is not used for a different product, but grades of one page share theirs', () => {
    const plan = planHp({
      products: [
        row({
          Product: 'HP GEAR OIL EP 80W 90',
          Range: 'Automotive Oils',
          Category: 'Gear And Transmission Oils',
          'Picture file': 'a.jpg',
        }),
        row({
          Product: 'HP GEAR OIL XP 80W 90',
          Range: 'Automotive Oils',
          Category: 'Gear And Transmission Oils',
          'Picture file': 'b.jpg',
        }),
        row({
          Product: 'HP RACER 10W-30, 20W-40',
          Range: 'Automotive Oils',
          Category: 'Bike Two Wheeler Engine Oils',
          'Picture file': 'c.jpg',
        }),
      ],
      grades: [],
      pictureHash: (f) => (f === 'a.jpg' || f === 'b.jpg' ? 'same' : f),
    });
    expect(plan.drafts.map((d) => [d.slug, d.reason])).toEqual([
      ['hp-gear-oil-ep-80w-90', 'photo_of_another_product'],
      ['hp-gear-oil-xp-80w-90', 'photo_of_another_product'],
    ]);
    expect(plan.products.filter((p) => p.status === 'live').map((p) => p.slug)).toEqual([
      'hp-racer-10w-30',
      'hp-racer-20w-40',
    ]);
  });

  it('tags the EV range and the DEF HSN, and splits the racer grades', () => {
    const ev = hp.products.find((p) => p.slug === 'hp-ev-koolgard');
    expect(ev?.spec).toMatchObject({ evRange: true });
    expect(hp.products.find((p) => p.slug === 'hp-def')?.hsn).toBe('3102');
    expect(hp.products.find((p) => p.slug === 'hp-racer-20w-40')?.spec).toMatchObject({
      source: 'hp',
      saeGrade: '20W40',
      apiClass: 'SL',
      jasoClass: 'MA2',
    });
  });

  it('plans the Hindi without English leftovers', () => {
    expect(planHindiLeftovers(hp)).toEqual([]);
  });
});
