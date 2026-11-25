/**
 * HP packs and prices from the researched CSV (user 2026-11-25, `pnpm db:import:hp --packs <csv>`): the researched packs
 * replace the "Standard pack"; an MRP only from a row with `mrp_inr` and confidence high or medium; low confidence and
 * disagreeing sources leave the pack at price on request and are listed; `sale_price_inr` is never the MRP; the source
 * URL and check date stay private per pack; a product without researched rows keeps the Standard pack.
 */
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/battery-import';
import { parseHpPacksCsv, planHp } from '../src/lube-import';

const row = (r: Record<string, string>): CsvRow => r;
const products = [
  row({
    Product: 'HP RACER 10W-30, 20W-40',
    Range: 'Automotive Oils',
    Category: 'Bike Two Wheeler Engine Oils',
    'Picture file': 'p/racer.jpg',
  }),
  row({
    Product: 'HP DEF',
    Range: 'Specialties',
    Category: 'Diesel Exhaust Fluid',
    'Picture file': 'p/def.jpg',
  }),
  row({
    Product: 'HP EV KOOLGARD',
    Range: 'Automotive Oils',
    Category: 'Ev And Hybrid Range',
    'Picture file': 'p/ev.jpg',
  }),
];

const HEADER =
  'plan_slug,product_name,grade,pack_label,net_qty,net_unit,mrp_inr,sale_price_inr,source_url,source_type,checked_on,confidence,status,note';
const csv = [
  HEADER,
  'hp-racer-10w-30,HP Racer,10W-30,1 L,1000,ml,480,450,https://a.test/r1,retailer,2026-11-25,high,found,',
  'hp-racer-10w-30,HP Racer,10W-30,900 ml,900,ml,400,350,https://a.test/r2,retailer,2026-11-25,medium,found,',
  'hp-racer-10w-30,HP Racer,10W-30,3.5 Litre,3.5,L,1500,1400,https://a.test/r3,marketplace,2026-11-25,low,found,',
  'hp-racer-20w-40,HP Racer,20W-40,1 L,1000,ml,500,,https://a.test/s1,retailer,2026-11-24,high,found,',
  'hp-racer-20w-40,HP Racer,20W-40,1 L,1000,ml,520,,https://b.test/s2,retailer,2026-11-25,high,found,',
  'hp-def,HP DEF,,10 L,10,L,,800,https://a.test/d,retailer,2026-11-25,high,pack_only,',
  'hp-nothing,HP Nothing,,1 L,1000,ml,100,,https://a.test/n,retailer,2026-11-25,high,found,',
  'hp-ev-koolgard,HP EV Koolgard,,,,,,,,,2026-11-25,none,not_found,nothing found',
  'hp-ev-koolgard,HP EV Koolgard,,1 L,1000,ml,,,https://a.test/e,retailer,2026-11-25,medium,found,inferred link from a sibling product',
  'hp-def,HP DEF,,20 L,20,L,,,https://a.test/d2,retailer,2026-11-25,low,estimated,',
].join('\n');

const packs = parseHpPacksCsv(csv);
const plan = planHp({ products, grades: [], packs, packsMrp: true });
const noMrp = planHp({ products, grades: [], packs });
const by = (slug: string) => {
  const p = plan.products.find((x) => x.slug === slug);
  if (!p) throw new Error(`no product ${slug}`);
  return p;
};

describe('HP researched packs', () => {
  it('replaces the Standard pack with the researched packs (canonical label, net quantity, unique SKU)', () => {
    const r = by('hp-racer-10w-30');
    expect(r.variants.map((v) => [v.model, v.netQuantity])).toEqual([
      ['900 ml', { qty: 900, unit: 'ml' }],
      ['1 L', { qty: 1000, unit: 'ml' }],
      ['3.5 L', { qty: 3500, unit: 'ml' }],
    ]);
    expect(new Set(r.variants.map((v) => v.sku)).size).toBe(3);
    expect(r.variants.map((v) => v.options)).toEqual([
      { label: '900 ml' },
      { label: '1 L' },
      { label: '3.5 L' },
    ]);
  });

  it('sets the MRP only from high or medium confidence rows, and never from the sale price', () => {
    const r = by('hp-racer-10w-30');
    expect(r.variants.map((v) => [v.model, v.mrpPaise])).toEqual([
      ['900 ml', 40000],
      ['1 L', 48000],
      ['3.5 L', null],
    ]);
    expect(by('hp-def').variants.map((v) => [v.model, v.mrpPaise])).toEqual([['10 L', null]]);
  });

  it('lists a low confidence price and a pack whose sources disagree, and leaves them price on request', () => {
    expect(plan.research?.lowConfidence).toEqual([{ slug: 'hp-racer-10w-30', pack: '3.5 L', mrpInr: 1500 }]);
    expect(plan.research?.conflicts).toEqual([{ slug: 'hp-racer-20w-40', pack: '1 L', mrpInr: [500, 520] }]);
    expect(by('hp-racer-20w-40').variants.map((v) => [v.model, v.mrpPaise])).toEqual([['1 L', null]]);
  });

  it('keeps the source URL and check date per pack in the private spec', () => {
    const sources = by('hp-racer-10w-30').spec.packSources as Record<string, unknown>;
    const sku = by('hp-racer-10w-30').variants[1]?.sku ?? '';
    expect(sources[sku]).toMatchObject({
      sourceUrls: ['https://a.test/r1'],
      checkedOn: '2026-11-25',
      confidence: 'high',
    });
    const conflict = by('hp-racer-20w-40').spec.packSources as Record<string, { sourceUrls: string[] }>;
    expect(Object.values(conflict)[0]?.sourceUrls).toEqual(['https://a.test/s1', 'https://b.test/s2']);
  });

  it("keeps today's Standard pack where a product has no researched rows, and lists rows for no product", () => {
    expect(by('hp-ev-koolgard').variants.map((v) => [v.model, v.mrpPaise])).toEqual([
      ['Standard pack', null],
    ]);
    expect(plan.research?.unmatched).toEqual(['hp-nothing']);
  });

  it('counts what the research gave', () => {
    expect(plan.research).toMatchObject({
      rows: 10,
      productsWithPacks: 3,
      packs: 5,
      withMrp: 2,
      noData: 0,
      ignored: 3,
      unreadable: [],
    });
  });
});

describe('HP researched packs with the MRP switched off (the default, user ruling 2026-11-25)', () => {
  it('uses no MRP from the research at all, even from high and medium rows', () => {
    for (const p of noMrp.products) for (const v of p.variants) expect(v.mrpPaise).toBeNull();
    expect(
      noMrp.products.find((p) => p.slug === 'hp-racer-10w-30')?.variants.map((v) => [v.model, v.mrpPaise]),
    ).toEqual([
      ['900 ml', null],
      ['1 L', null],
      ['3.5 L', null],
    ]);
    expect(noMrp.research).toMatchObject({ packs: 5, withMrp: 0, conflicts: [], lowConfidence: [] });
  });

  it('uses only the pack sizes of pack_only and found rows whose note does not say "inferred link"', () => {
    const def = noMrp.products.find((p) => p.slug === 'hp-def');
    expect(def?.variants.map((v) => v.model)).toEqual(['10 L']);
    const ev = noMrp.products.find((p) => p.slug === 'hp-ev-koolgard');
    expect(ev?.variants.map((v) => v.model)).toEqual(['Standard pack']);
    expect(noMrp.research?.ignored).toBe(3);
  });
});
