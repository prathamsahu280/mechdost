/**
 * Apollo tyre plan (user 2026-11-24): India only (every "Shop only" row, which includes all Vredestein, and the
 * brochure-only sizes are dropped and listed with their reason), one product per tread pattern with each size a variant,
 * MRP only from the shop column (else price on request), the EAN as the variant barcode, duplicate listings merged,
 * industrial tyres in `industrial-tyres` and earthmover tyres in `otr-tyres`, fitment private per size, Hindi complete.
 */
import { describe, expect, it } from 'vitest';
import { csvRows } from '../src/battery-import';
import { planApollo } from '../src/apollo';
import { planHindiLeftovers } from '../src/tyre-import';

const TYRE_COLUMNS = [
  'Tyre',
  'Brand',
  'Product type',
  'Pattern',
  'Size',
  'MRP incl. taxes (Rs)',
  'Width',
  'Aspect ratio',
  'Rim (inch)',
  'Load index',
  'Speed rating',
  'Ply rating',
  'Overall diameter (mm)',
  'Recommended rim width',
  'Alternative rim width',
  'Tubeless / tube type',
  'SKU (shop)',
  'EAN barcode',
  'Fits (shop)',
  'Description',
  'Shop features',
  'Shop tags',
  'Availability (shop)',
  'Name in shop',
  'Other size data',
  'Brochure',
  'source',
  'Pattern page',
  'Shop page',
  'Picture files',
  'Data checks',
] as const;
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const tyreCsv = (rows: Record<string, string>[]) =>
  `${TYRE_COLUMNS.join(',')}\n${rows.map((r) => TYRE_COLUMNS.map((c) => q(r[c] ?? '')).join(',')).join('\n')}`;

const ALNAC_DIR = 'pictures/Car - SUV - van tyre/ALNAC 4G';
const ALNAC_PICS = [
  `${ALNAC_DIR}/Apollo ALNAC 4G - shop photo.jpg`,
  `${ALNAC_DIR}/Apollo ALNAC 4G - 2.jpg`,
  `${ALNAC_DIR}/Apollo ALNAC 4G - 1.jpg`,
].join(' | ');
const PAGE = 'https://www.apollotyres.com/en-in/';
const ALNAC_DESC =
  'ALNAC 4G is a high-performance tyre for comfort and control, with low noise for a smoother drive.';
const ALNAC_FEATURES =
  'Best in Class Mileage and Durability Twin Steel Belt with JCP Protection High Puncture Resistance | Great Handling and Braking Block Based Design for maximum road grip Connected shoulder blocks for great cornering | Superb Ride Comfort Rounder contact patch for ride comfort Extended lateral grooves for minimum noise';

const alnac = (size: string, extra: Record<string, string>): Record<string, string> => ({
  Tyre: `Apollo ALNAC 4G ${size} TL`,
  Brand: 'Apollo',
  'Product type': 'Car / SUV / van tyre',
  Pattern: 'ALNAC 4G',
  Size: size,
  Width: '185',
  'Aspect ratio': '55',
  'Rim (inch)': '16',
  'Load index': '83',
  'Speed rating': 'H',
  'Tubeless / tube type': 'TL (tubeless)',
  Description: ALNAC_DESC,
  'Shop features': ALNAC_FEATURES,
  source: 'Product page + shop',
  'Pattern page': `${PAGE}car-suv-tyres/products/864-ALNAC-4G/`,
  'Picture files': ALNAC_PICS,
  ...extra,
});

const ROWS: Record<string, string>[] = [
  alnac('185/55 R16', {
    'MRP incl. taxes (Rs)': '6340.0',
    'SKU (shop)': 'RLGCH0AL43AH1',
    'EAN barcode': '8904156005372',
    'Shop page': 'https://shop.apollotyres.com/alnac-4g-185-55-83-r16-tl',
  }),
  alnac('185/60 R14', {
    'MRP incl. taxes (Rs)': '5560.0',
    'SKU (shop)': 'RLGDL0AL43AH1',
    'Shop page': 'https://shop.apollotyres.com/alnac-4g-185-82-r14-tl',
    'Aspect ratio': '60',
    'Rim (inch)': '14',
  }),
  alnac('195/65 R15', {
    'Aspect ratio': '65',
    'Rim (inch)': '15',
    source: 'Product page',
    'Shop features': '',
  }),
  {
    Tyre: 'Apollo ACTIZIP F2 2.75-18 TT',
    Brand: 'Apollo',
    'Product type': 'Bike / scooter tyre',
    Pattern: 'ACTIZIP F2',
    Size: '2.75-18',
    'Rim (inch)': '18',
    'Load index': '42',
    'Speed rating': 'P',
    'Ply rating': '4',
    'Tubeless / tube type': 'TT (tube type)',
    Description: 'Designed for effortless manoeuvrability, enhanced safety, and long-lasting city rides.',
    source: 'Product page',
    'Pattern page': `${PAGE}bike-tyres/products/1-ACTIZIP-F2/`,
    'Picture files': 'pictures/Bike - scooter tyre/ActiZIP F2/Apollo ActiZIP F2 - 1.jpg',
    'Data checks': '',
  },
  ...[1, 2].map((n) => ({
    Tyre: 'Apollo ENDURACE RA 235/75 R17.5 (load index 132/130)',
    Brand: 'Apollo',
    'Product type': 'Truck and bus tyre',
    Pattern: 'ENDURACE RA',
    Size: '235/75 R17.5',
    'Load index': '132/130',
    'Ply rating': '0',
    source: 'Product page',
    'Pattern page': `${PAGE}truck-and-bus-tyres/products/1208-ENDURACE-RA/`,
    'Picture files': 'pictures/Truck and bus tyre/ENDURACE RA/Apollo ENDURACE RA - 1.jpg',
    'Data checks': n === 1 || n === 2 ? 'Listed more than once on the site with the same details' : '',
  })),
  {
    Tyre: 'Apollo SL HD 6.50-10',
    Brand: 'Apollo',
    'Product type': 'Industrial tyre',
    Pattern: 'SL HD',
    Size: '6.50-10',
    'Rim (inch)': '10',
    source: 'Product page',
    'Pattern page': `${PAGE}industrial-tyres/products/2-SL-HD/`,
    'Picture files': 'pictures/Industrial tyre/SL HD/Apollo SL HD - 1.jpg',
  },
  {
    Tyre: 'Apollo ENDUTUFF MINING 18.00-25',
    Brand: 'Apollo',
    'Product type': 'Earthmover tyre',
    Pattern: 'EnduTuff Mining',
    Size: '18.00-25',
    'Rim (inch)': '25',
    source: 'Product page',
    'Pattern page': `${PAGE}earthmover-tyres/products/3-EnduTuff-Mining/`,
    'Picture files': '',
  },
  {
    Tyre: 'Apollo ALNAC 155/70 R13 TL',
    Brand: 'Apollo',
    'Product type': 'Car / SUV / van tyre',
    Pattern: 'ALNAC',
    Size: '155/70 R13',
    'MRP incl. taxes (Rs)': '4520.0',
    'SKU (shop)': 'RLGBC0ALC4AH2',
    source: 'Shop only',
    'Shop page': 'https://shop.apollotyres.com/alnac-155-75-r13-tl',
  },
  {
    Tyre: 'Vredestein Ultrac 205/65 R16',
    Brand: 'Vredestein',
    'Product type': 'Car / SUV / van tyre',
    Pattern: 'Ultrac',
    Size: '205/65 R16',
    'MRP incl. taxes (Rs)': '12000.0',
    'SKU (shop)': 'RL11P0ULT0VW1',
    source: 'Shop only',
    'Shop page': 'https://shop.apollotyres.com/vredestein-ultrac-205-65-r16',
  },
];

const BROCHURE = `Brochure,Pattern (as on the brochure),Size line (as printed),Size,Ply rating,Load index,Speed rating,Tubeless / tube type,Position,Also on the website
Apollo ActiZIP F2 brochure,"ACTIZIP F2, F3",2.75-18 4PR 42P TT,2.75-18,4,42,P,TT,,Yes
Apollo Tramplr brochure,TRAMPLR XR,3.00-10 4PR 50J TL,3.00-10,4,50,J,TL,,No (brochure only)`;

const FITMENT = `Vehicle,Tyre,Size,MRP incl. taxes (Rs),SKU (shop),Source,Shop page,Vehicle page
Honda City,Apollo ALNAC 4G 185/55 R16 TL,185/55 R16,6340.0,RLGCH0AL43AH1,"Shop product page (""Fit to model"")",,
Hyundai i20,Apollo ALNAC 4G 185/55 R16 TL,185/55 R16,6340.0,RLGCH0AL43AH1,Shop vehicle page,,
Tata Nexon,Apollo ALNAC 4G 999/99 R99 TL,999/99 R99,1.0,X,Shop vehicle page,,
Ford Figo,Vredestein Ultrac 205/65 R16,205/65 R16,12000.0,RL11P0ULT0VW1,Shop vehicle page,,`;

const plan = planApollo({
  tyres: csvRows(tyreCsv(ROWS)),
  brochure: csvRows(BROCHURE),
  fitment: csvRows(FITMENT),
});
const by = (slug: string) => plan.products.find((p) => p.slug === slug);
const sizeSpec = (slug: string, sku: string) =>
  (by(slug)?.spec.variantSpecs as Record<string, Record<string, unknown>> | undefined)?.[sku];

describe('Apollo plan', () => {
  it('India only: shop-only rows (all Vredestein) and brochure-only sizes are dropped, each listed with its reason', () => {
    expect(plan.dropped.map((d) => [d.source, d.brand, d.name, d.reason])).toEqual([
      ['tyres', 'Apollo', 'Apollo ENDURACE RA 235/75 R17.5 (load index 132/130)', 'duplicate'],
      ['tyres', 'Apollo', 'Apollo ALNAC 155/70 R13 TL', 'shop_only'],
      ['tyres', 'Vredestein', 'Vredestein Ultrac 205/65 R16', 'shop_only'],
      ['brochure', 'Apollo', 'Apollo Tramplr brochure: TRAMPLR XR 3.00-10 4PR 50J TL', 'brochure_only'],
    ]);
    expect(plan.dropped.every((d) => d.detail !== '')).toBe(true);
    expect(plan.products.some((p) => /vredestein/i.test(p.name))).toBe(false);
    expect(plan.rows).toHaveLength(7);
  });

  it('one product per pattern; sizes are variants labelled as Apollo writes them; duplicates merged', () => {
    expect(plan.products.map((p) => p.name)).toEqual([
      'Apollo Alnac 4G',
      'Apollo Actizip F2',
      'Apollo Endurace RA',
      'Apollo SL HD',
      'Apollo EnduTuff Mining',
    ]);
    expect(by('apollo-alnac-4g')?.variants.map((v) => [v.sku, v.options.size])).toEqual([
      ['APOLLO-RLGDL0AL43AH1', '185/60 R14 TL'],
      ['APOLLO-ALNAC-4G-195-65-R15-TL', '195/65 R15 TL'],
      ['APOLLO-RLGCH0AL43AH1', '185/55 R16 TL'],
    ]);
    expect(by('apollo-endurace-ra')?.variants).toHaveLength(1);
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
  });

  it('MRP only from the shop column; the EAN is the variant barcode and part of the size spec', () => {
    const v = by('apollo-alnac-4g')?.variants ?? [];
    expect(v.map((x) => x.mrpPaise)).toEqual([556000, null, 634000]);
    expect(v.map((x) => x.barcode)).toEqual([null, null, '8904156005372']);
    expect(sizeSpec('apollo-alnac-4g', 'APOLLO-RLGCH0AL43AH1')).toMatchObject({
      barcode: '8904156005372',
      shopSku: 'RLGCH0AL43AH1',
    });
    expect(v[2]?.partNumbers.map((n) => n.normalised)).toEqual(['RLGCH0AL43AH1']);
    expect(plan.priceOnRequest.map((p) => p.sku)).toEqual([
      'APOLLO-ALNAC-4G-195-65-R15-TL',
      'APOLLO-ACTIZIP-F2-2-75-18-TT',
      'APOLLO-ENDURACE-RA-235-75-R17-5-LOAD-INDEX-132-130',
      'APOLLO-SL-HD-6-50-10',
      'APOLLO-ENDUTUFF-MINING-18-00-25',
    ]);
  });

  it('categories: car, two-wheeler, truck and bus, industrial (own sub-category), earthmover in otr', () => {
    expect(plan.products.map((p) => p.category.slug)).toEqual([
      'car-suv-tyres',
      'two-wheeler-tyres',
      'truck-bus-tyres',
      'industrial-tyres',
      'otr-tyres',
    ]);
    expect(by('apollo-sl-hd')).toMatchObject({ productType: 'industrial_tyre', hsn: '4011' });
  });

  it('pattern pictures only (never shop photos first); no picture on the whole pattern = draft', () => {
    expect(by('apollo-alnac-4g')?.photos.map((p) => p.file.replace(/^.* - /, ''))).toEqual([
      '1.jpg',
      '2.jpg',
      'shop photo.jpg',
    ]);
    expect(by('apollo-endutuff-mining')?.status).toBe('draft');
    expect(by('apollo-sl-hd')?.status).toBe('live');
    expect(plan.noPhoto.map((n) => n.slug)).toEqual(['apollo-endutuff-mining']);
  });

  it('typed size data: load index pair, ply 0 is blank, speed letters; fitment per size, private', () => {
    expect(
      sizeSpec('apollo-endurace-ra', 'APOLLO-ENDURACE-RA-235-75-R17-5-LOAD-INDEX-132-130'),
    ).toMatchObject({
      loadIndexText: '132/130',
    });
    expect(
      sizeSpec('apollo-endurace-ra', 'APOLLO-ENDURACE-RA-235-75-R17-5-LOAD-INDEX-132-130'),
    ).not.toHaveProperty('plyRating');
    expect(sizeSpec('apollo-actizip-f2', 'APOLLO-ACTIZIP-F2-2-75-18-TT')).toMatchObject({
      plyRating: 4,
      speedSymbol: 'P',
      tubeless: false,
    });
    expect(sizeSpec('apollo-alnac-4g', 'APOLLO-RLGCH0AL43AH1')?.fitment).toEqual([
      expect.objectContaining({ make: 'Honda', model: 'City' }),
      expect.objectContaining({ make: 'Hyundai', model: 'i20' }),
    ]);
    expect(by('apollo-alnac-4g')?.spec).not.toHaveProperty('fitment');
    expect(plan.fitmentUnmatched).toEqual(['Apollo ALNAC 4G 999/99 R99 TL']);
  });

  it('Hindi: descriptions and shop features translated by hand; no English words left', () => {
    expect(plan.untranslated).toEqual([]);
    expect(planHindiLeftovers(plan)).toEqual([]);
    const p = by('apollo-alnac-4g');
    expect(p?.descriptionHi).toMatch(/[ऀ-ॿ]/);
    expect(p?.highlights.length).toBe(p?.highlightsHi.length);
    expect(p?.nameHi).toBe('Apollo Alnac 4G');
  });
});
