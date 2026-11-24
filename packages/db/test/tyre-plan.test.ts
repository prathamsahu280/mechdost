/**
 * CEAT and MRF tyre plans (user 2026-11-24): exact title-case names, the sub-categories under `tyres`, prices (the
 * hidden CEAT price is never the MRP), source oddities handled and reported, pictures per pattern in gallery order,
 * drafts without a picture, fitment, and no Hindi text with English words (hard rule 10).
 */
import { describe, expect, it } from 'vitest';
import { planCeat } from '../src/ceat';
import { planMrf } from '../src/mrf';
import { csvRows } from '../src/battery-import';
import { planHindiLeftovers, titleTyreName, TYRE_CATEGORY_LIST } from '../src/tyre-import';

const CEAT_HEADER =
  'Tyre,Product type,Pattern,Size,SKU,Price incl. taxes (Rs),"Price in site data, not shown on page (Rs)",Width,Aspect ratio,Rim (inch),Load index,Speed rating,Ply rating,Construction,Tubeless / tube type,Tube included,Position,Overall diameter (mm),Section width (mm),Tread depth (mm),M+ rating,Usage,Applications,Tagline,Features,Product page,Picture files,Picture URLs,Data checks';
const FRONT = 'pictures/Car - SUV tyre/MILAZE X3/CEAT MILAZE X3 - Front.jpg';
const A60 = 'pictures/Car - SUV tyre/MILAZE X3/CEAT MILAZE X3 - Angle 60.jpg';
const A120 = 'pictures/Car - SUV tyre/MILAZE X3/CEAT MILAZE X3 - Angle 120.jpg';
const SIDE = 'pictures/Car - SUV tyre/MILAZE X3/CEAT MILAZE X3 - Side.jpg';
const CEAT_PICS = `${SIDE} | ${A60} | ${FRONT} | ${A120}`;
const CEAT_ROWS = [
  `CEAT MILAZE X3 145/70R12 69T TL,Car / SUV tyre,MILAZE X3,145/70R12,105037,2900,,145,70,12,69,T,,Radial,Tube Less,,Front/Rear,,,,,,,The 1 lakh km tyre,Zig-Zag tread pattern: Improved traction even if tyres are submerged in mud,https://ceat.example/a,${CEAT_PICS},u1 | u2 | u3 | u4,`,
  `CEAT MILAZE X3 155/70R12 73T TL,Car / SUV tyre,MILAZE X3,155/70R12,105038,,3100,155,70,12,73,T,,Radial,Tube Less,,Front/Rear,,,,,,,The 1 lakh km tyre,Zig-Zag tread pattern: Improved traction even if tyres are submerged in mud,https://ceat.example/a2,${CEAT_PICS},u1 | u2 | u3 | u4,Price not shown on the page (the site has it only in its hidden data)`,
  `CEAT ZOOM X3 110/80-17 57P TL,Motorcycle tyre,ZOOM X3,110/80-17,113577,,8808,110,80,17,57,P,,Bias,Tube Less,,Front,,,,,,,,,https://ceat.example/b,pictures/Motorcycle tyre/ZOOM X3/CEAT ZOOM X3 - Front.jpg,,Price not shown on the page (the site has it only in its hidden data)`,
  `CEAT GRIPP 110/70-12 47P TL,Scooter tyre,GRIPP,110/70-12,107261,1619,,110,70,12,47,P,,Bias,Tube Less,,,,,,,,,,,https://ceat.example/c,,,"No picture on the page; Page heading says GRIPP, but CEAT’s product name for this page is ""110/70-12 Energy Ride EV 47P"""`,
  `CEAT FM SUPER 10.00-20 (SKU 100014),Commercial (truck / bus) tyre,FM SUPER,10.00-20,100014,,,10.0,,20,,,16,Bias,,,,1080,280,16.5,17,Heavy Load -Short Haul Application,"General Goods, Cement",,,https://ceat.example/d,pictures/Commercial (truck - bus) tyre/FM SUPER/CEAT FM SUPER - Front.jpg,,`,
].join('\n');
const CEAT_FIT = `Vehicle type,Make,Model,Variant,Manufacturing years,Front / rear,Option,Tyre,Size,Has product page
Car,MARUTI,800,NA,1983-2014,,Recommended,CEAT MILAZE X3 145/70R12 69T TL,145/70R12,Yes
Car,MARUTI,Omni,ALL,2000 ONWARDS,,Other option,CEAT MILAZE X3 145/70R12 69T TL,145/70R12,Yes
Motorcycle,ROYAL ENFIELD,Classic 350,NA,2020-2025,Front,Recommended,CEAT ZOOM X3 110/80-17 57P TL,110/80-17,Yes
Car,MARUTI,Alto 800,NA,2012-2019,,Recommended,CEAT MILAZE X3 155/70R12 73T TL,155/70R12,Yes
Car,TATA,Nano,NA,2012-2018,,Recommended,,,No (CEAT lists the SKU in its finder but has no product page for it)`;

const ceat = (rows = CEAT_ROWS, exists?: (f: string) => boolean) =>
  planCeat({
    tyres: csvRows(`${CEAT_HEADER}\n${rows}`),
    fitment: csvRows(CEAT_FIT),
    ...(exists ? { pictureExists: exists } : {}),
  });

describe('title-case names', () => {
  it('keeps size, load/speed notation and codes exact', () => {
    expect(titleTyreName('CEAT MILAZE X3 145/70R12 69T TL')).toBe('CEAT Milaze X3 145/70R12 69T TL');
    expect(titleTyreName('CEAT SPORTRAD ST FRONT 120/70ZR17 58W TL')).toBe(
      'CEAT Sportrad ST Front 120/70ZR17 58W TL',
    );
    expect(titleTyreName('MRF ZVTS 145/80R12 74T TT')).toBe('MRF ZVTS 145/80R12 74T TT');
    expect(titleTyreName('MRF ZSPORT 205/55R16 91V TL')).toBe('MRF ZSport 205/55R16 91V TL');
    expect(titleTyreName('MRF 215/75R15LT 115/113S UA23 TT (tube included)')).toBe(
      'MRF 215/75R15LT 115/113S UA23 TT (tube included)',
    );
    expect(titleTyreName('CEAT FM SUPER 10.00-20 (SKU 100014)')).toBe('CEAT FM Super 10.00-20 (SKU 100014)');
    expect(titleTyreName('MRF THE LUG-PLUS 12.00-20')).toBe('MRF The Lug-Plus 12.00-20');
  });
});

describe('CEAT plan', () => {
  const plan = ceat();
  const by = (slug: string) => plan.products.find((p) => p.slug === slug);
  const milaze = () => by('ceat-milaze-x3');
  const sizeSpec = (slug: string, sku: string) =>
    (by(slug)?.spec.variantSpecs as Record<string, Record<string, unknown>> | undefined)?.[sku];

  it('one product per pattern named after the pattern, each size a variant labelled as CEAT writes it', () => {
    expect(plan.products.map((p) => p.name)).toEqual([
      'CEAT Milaze X3',
      'CEAT Zoom X3',
      'CEAT Gripp',
      'CEAT FM Super',
    ]);
    expect(milaze()?.nameHi).toBe('CEAT Milaze X3');
    expect(milaze()?.variants.map((v) => [v.sku, v.options, v.model])).toEqual([
      [
        'CEAT-105037',
        { size: '145/70R12 69T TL', loadIndex: '69', speedRating: 'T', construction: 'radial', tlTt: 'TL' },
        '145/70R12 69T TL',
      ],
      [
        'CEAT-105038',
        { size: '155/70R12 73T TL', loadIndex: '73', speedRating: 'T', construction: 'radial', tlTt: 'TL' },
        '155/70R12 73T TL',
      ],
    ]);
    expect(by('ceat-fm-super')?.variants[0]?.options).toEqual({
      size: '10.00-20 (SKU 100014)',
      construction: 'bias',
      ply: '16',
    });
    expect(by('ceat-zoom-x3')?.variants[0]?.options.frontRear).toBe('front');
    expect(milaze()?.variant).toBe(milaze()?.variants[0]);
    expect(milaze()?.variants[0]?.partNumbers.map((n) => n.normalised)).toEqual(['105037']);
    expect(milaze()?.variants.every((v) => v.barcode === null)).toBe(true);
    expect(milaze()?.range.slug).toBe('ceat-milaze-x3');
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
    expect(plan.rows).toHaveLength(5);
    expect(plan.rows.filter((r) => r.slug === 'ceat-milaze-x3').map((r) => r.name)).toEqual([
      'CEAT Milaze X3 145/70R12 69T TL',
      'CEAT Milaze X3 155/70R12 73T TL',
    ]);
  });

  it('puts every product under a sub-category of tyres, with English and Hindi names and descriptions', () => {
    expect(plan.products.map((p) => p.category.slug)).toEqual([
      'car-suv-tyres',
      'two-wheeler-tyres',
      'two-wheeler-tyres',
      'truck-bus-tyres',
    ]);
    expect(TYRE_CATEGORY_LIST.map((c) => c.slug).sort()).toEqual([
      'car-suv-tyres',
      'farm-tyres',
      'industrial-tyres',
      'light-commercial-tyres',
      'otr-tyres',
      'three-wheeler-tyres',
      'truck-bus-tyres',
      'tubes-flaps',
      'two-wheeler-tyres',
    ]);
    for (const c of TYRE_CATEGORY_LIST) {
      expect(c.parent).toBe('tyres');
      expect(c.nameHi).toMatch(/[ऀ-ॿ]/);
      expect(c.description).toBeTruthy();
      expect(c.descriptionHi).toMatch(/[ऀ-ॿ]/);
    }
    expect(TYRE_CATEGORY_LIST.find((c) => c.slug === 'industrial-tyres')).toMatchObject({
      name: 'Industrial tyres',
      nameHi: 'इंडस्ट्रियल टायर',
    });
  });

  it('the price shown on the page is the size MRP; the hidden site price is kept privately per size and never the MRP', () => {
    expect(milaze()?.variants.map((v) => v.mrpPaise)).toEqual([290000, null]);
    expect(sizeSpec('ceat-milaze-x3', 'CEAT-105038')?.ceatPrice).toEqual({
      siteData: { paise: 310000, gstIncluded: true },
    });
    expect(sizeSpec('ceat-milaze-x3', 'CEAT-105037')).not.toHaveProperty('ceatPrice');
    expect(milaze()?.spec).not.toHaveProperty('ceatPrice');
    expect(by('ceat-zoom-x3')?.variants[0]?.mrpPaise).toBeNull();
    expect(by('ceat-fm-super')?.variants[0]?.mrpPaise).toBeNull();
    expect(plan.priceOnRequest.map((p) => [p.slug, p.sku, p.siteDataPaise])).toEqual([
      ['ceat-milaze-x3', 'CEAT-105038', 310000],
      ['ceat-zoom-x3', 'CEAT-113577', 880800],
      ['ceat-fm-super', 'CEAT-100014', null],
    ]);
  });

  it('pattern data on the product, size data per SKU under spec.variantSpecs; HSN and GST', () => {
    expect(milaze()?.spec).toMatchObject({
      source: 'ceat',
      pattern: 'Milaze X3',
      sizeCount: 2,
      construction: 'radial',
      tubeless: true,
    });
    for (const key of ['size', 'widthMm', 'loadIndex', 'fitment'])
      expect(milaze()?.spec).not.toHaveProperty(key);
    expect(sizeSpec('ceat-milaze-x3', 'CEAT-105037')).toMatchObject({
      size: '145/70R12',
      widthMm: 145,
      aspectRatioPct: 70,
      rimInch: 12,
      construction: 'radial',
      loadIndex: 69,
      speedSymbol: 'T',
      tubeless: true,
    });
    expect(sizeSpec('ceat-milaze-x3', 'CEAT-105037')).not.toHaveProperty('position');
    expect(sizeSpec('ceat-zoom-x3', 'CEAT-113577')).toMatchObject({
      position: 'front',
      construction: 'bias',
    });
    expect(sizeSpec('ceat-fm-super', 'CEAT-100014')).toMatchObject({
      plyRating: 16,
      sectionWidthInch: 10,
      overallDiameterMm: 1080,
      treadDepthMm: 16.5,
      mPlusRating: 17,
    });
    expect(sizeSpec('ceat-fm-super', 'CEAT-100014')).not.toHaveProperty('widthMm');
    expect(by('ceat-fm-super')?.hsn).toBe('4011');
    expect(by('ceat-fm-super')?.gstRateBp).toBe(1800);
  });

  it('fitment goes to the size it is listed for; the product page text lists every vehicle once; unmatched lines are counted', () => {
    expect(sizeSpec('ceat-milaze-x3', 'CEAT-105037')?.fitment).toEqual([
      expect.objectContaining({ make: 'MARUTI', model: '800', years: '1983-2014', option: 'recommended' }),
      expect.objectContaining({ make: 'MARUTI', model: 'Omni', years: '2000 ONWARDS', option: 'other' }),
    ]);
    expect(sizeSpec('ceat-milaze-x3', 'CEAT-105038')?.fitment).toEqual([
      expect.objectContaining({ make: 'MARUTI', model: 'Alto 800' }),
    ]);
    expect(milaze()?.compatibility).toBe('Maruti 800, Maruti Omni, Maruti Alto 800');
    expect(milaze()?.fitmentCount).toBe(3);
    expect(plan.orphanFitment).toBe(1);
  });

  it('pictures per pattern in gallery order front, angle, angle, side; draft only when the pattern has none', () => {
    expect(milaze()?.photos.map((p) => p.file)).toEqual([FRONT, A60, A120, SIDE]);
    expect(milaze()?.photos[0]?.alt).toBe('CEAT Milaze X3 (front view)');
    const scooter = by('ceat-gripp');
    expect(scooter?.status).toBe('draft');
    expect(scooter?.photos).toEqual([]);
    expect(plan.products.filter((p) => p.status === 'draft')).toHaveLength(1);
    expect(milaze()?.status).toBe('live');
    expect(plan.noPhoto).toEqual([{ slug: 'ceat-gripp', name: 'CEAT Gripp', reason: 'no_photo_on_site' }]);
  });

  it('a picture file missing from the folder is left out and reported', () => {
    const p = ceat(CEAT_ROWS, (f) => f !== A60);
    expect(p.products[0]?.photos.map((x) => x.file)).toEqual([FRONT, A120, SIDE]);
    expect(p.checks.some((c) => c.note.includes('is not in the folder'))).toBe(true);
  });

  it('source oddities are reported with how they were handled and the slug of their pattern product', () => {
    expect(plan.checks.map((c) => c.name)).toEqual([
      'CEAT Gripp 110/70-12 47P TL',
      'CEAT Gripp 110/70-12 47P TL',
    ]);
    expect(plan.checks[0]?.note).toContain('Handled:');
    expect(plan.checks.every((c) => c.slug === 'ceat-gripp')).toBe(true);
  });

  it('Hindi: no English words outside brand, model and code names; every feature translated; sizes counted', () => {
    expect(planHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
    expect(milaze()?.highlightsHi.at(-1)).toMatch(/[ऀ-ॿ]/);
    expect(milaze()?.highlights.length).toBe(milaze()?.highlightsHi.length);
    expect(milaze()?.specSummary).toBe('2 sizes · Radial · Tubeless (TL)');
    expect(milaze()?.specSummaryHi).toBe('2 साइज़ · रेडियल · ट्यूबलेस (TL)');
    expect(by('ceat-gripp')?.specSummary).toBe('1 size · Bias · Tubeless (TL)');
  });
});

const MRF_HEADER =
  'Tyre,Product type,Pattern,Size,MRP incl. GST (Rs),Width,Aspect ratio,Rim (inch),Construction,Load index,Speed rating,Ply rating,Tubeless (TL) / tube type (TT),Tube sold with tyre,Features,Tyre name on site,Product page,Picture files,Picture URLs';
const MRF_PICS =
  'pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Side.jpg | pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Right.jpg | pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Left.jpg | pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Front.jpg';
const KRISHI = 'pictures/Farm tyre/KRISHI/MRF KRISHI - Left.jpg';
const MRF_ROWS = [
  `MRF ZWYDE 175/60R13 77T TL,Passenger car tyre,ZWYDE,175/60R13,5360,175,60,13,Radial,77,T,,TL (tubeless),No,Broader 4 Rib Pattern.; Aggressive sipes.,175/60R13 77T TL ZWYDE,https://mrf.example/a,${MRF_PICS},`,
  `MRF ZWYDE 185/65R14 86H TL,Passenger car tyre,ZWYDE,185/65R14,6000,185,65,14,Radial,86,H,,TL (tubeless),No,Broader 4 Rib Pattern.,185/65R14 86H TL ZWYDE,https://mrf.example/a2,${MRF_PICS},`,
  `MRF 8-18 Krishi,Farm tyre,KRISHI, 8-18,,8,,18,Bias,,,6,TT (tube type),No,,8-18 Krishi,https://mrf.example/k1,${KRISHI},`,
  `MRF 8-18 Krishi,Farm tyre,KRISHI,8.00-18,,8,,18,Bias,,,6,TT (tube type),No,,8-18 Krishi,https://mrf.example/k2,${KRISHI},`,
  `MRF 8.3-20 Krishi,Farm tyre,KRISHI,8.3-20,,8.3,,20,Bias,,,4,TT (tube type),No,,8.3-20 Krishi,https://mrf.example/k3,${KRISHI},`,
  `MRF 8.3-20 Krishi,Farm tyre,KRISHI,8.3-20,,8.3,,20,Bias,,,6,TT (tube type),No,,8.3-20 Krishi,https://mrf.example/k4,${KRISHI},`,
  `MRF 9.5-24 Krishi,Farm tyre,KRISHI,9.5-24,,9.5,,24,Bias,,,45634,TT (tube type),undefined,,9.5-24 Krishi,https://mrf.example/k5,${KRISHI},`,
  `MRF 165D14 SAVARI N8 TT,Pick-up tyre,SAVARI,165D14,,,,,Bias,,,,TT (tube type),No,,165D14 SAVARI N8 TT,https://mrf.example/p,pictures/Pick-up tyre/SAVARI/MRF SAVARI - Left.jpg,`,
  `MRF 4.50-12 Bias Poly Pouch,Tube / flap,BIAS POLY POUCH,4.50-12,,4.5,,12,Bias,,,,,,,4.50-12 Bias Poly Pouch,https://mrf.example/t,pictures/Tube - flap/BIAS POLY POUCH/MRF BIAS POLY POUCH - Left.jpg,`,
  `MRF 10.00-20 BR Brass Reinforced Flaps,Tube / flap,BRASS REINFORCED FLAPS,10.00-20 BR,,,,,,,,,,,,10.00-20 BR Brass Reinforced Flaps,https://mrf.example/f,pictures/Tube - flap/BRASS REINFORCED FLAPS/MRF BRASS REINFORCED FLAPS - Left.jpg,`,
  `MRF 100/80-17 52P MASSETER FX TL,Two-wheeler tyre,MASSETER FX,100/80-17,2500,100,80,17,Bias,52,P,,TL (tubeless),No,,100/80-17 52P MASSETER FX TL,https://mrf.example/m,,`,
].join('\n');
const MRF_FIT = `Vehicle type,Make (first word),Vehicle (as on site),Tyre,Pattern,Size
Car / SUV,MARUTI,MARUTI ZEN ESTILO,MRF ZWYDE 175/60R13 77T TL,ZWYDE,175/60R13
Car / SUV,FORCE MOTORS,FORCE MOTORS TRAVELLER (NEW),MRF ZWYDE 175/60R13 77T TL,ZWYDE,175/60R13`;

describe('MRF plan', () => {
  const plan = planMrf({
    tyres: csvRows(`${MRF_HEADER}\n${MRF_ROWS}`),
    fitment: csvRows(MRF_FIT),
  });
  const by = (slug: string) => plan.products.find((p) => p.slug === slug);
  const sizeSpec = (slug: string, sku: string) =>
    (by(slug)?.spec.variantSpecs as Record<string, Record<string, unknown>> | undefined)?.[sku];

  it('one product per pattern, sizes as variants; identical duplicate pages are merged per size, a different ply keeps both', () => {
    expect(plan.products.map((p) => p.name)).toEqual([
      'MRF ZWyde',
      'MRF Krishi',
      'MRF Savari',
      'MRF Bias Poly Pouch',
      'MRF Brass Reinforced Flaps',
      'MRF Masseter FX',
    ]);
    expect(by('mrf-krishi')?.variants.map((v) => v.options.size)).toEqual([
      '8-18',
      '8.3-20 (4 Ply)',
      '8.3-20 (6 Ply)',
      '9.5-24',
    ]);
    expect(by('mrf-zwyde')?.variants.map((v) => v.options.size)).toEqual([
      '175/60R13 77T TL',
      '185/65R14 86H TL',
    ]);
    expect(by('mrf-savari')?.variants[0]?.options.size).toBe('165D14 N8 TT');
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
    expect(plan.rows).toHaveLength(10);
    const notes = plan.checks.map((c) => `${c.name}: ${c.note}`);
    expect(notes.some((n) => n.startsWith('MRF 8-18 Krishi') && n.includes('merged into one'))).toBe(true);
    expect(notes.some((n) => n.startsWith('MRF 8.3-20 Krishi (4 Ply)') && n.includes('different ply'))).toBe(
      true,
    );
    expect(plan.checks.find((c) => c.name.startsWith('MRF 8-18 Krishi'))?.slug).toBe('mrf-krishi');
    expect(notes.some((n) => n.includes('Discontinued pages') && n.includes('22 pages'))).toBe(true);
  });

  it('a pattern sold as different kinds is split by kind: one product each, told apart by name and slug', () => {
    const header = MRF_HEADER;
    const mixed = planMrf({
      tyres: csvRows(`${header}
MRF SAVARI 165/80R14 85T TL,Passenger car tyre,SAVARI,165/80R14,4000,165,80,14,Radial,85,T,,TL (tubeless),No,,x,https://mrf.example/1,pictures/a - Left.jpg,
MRF 165D14 SAVARI N8 TT,Pick-up tyre,SAVARI,165D14,,,,,Bias,,,,TT (tube type),No,,x,https://mrf.example/2,pictures/a - Left.jpg,`),
      fitment: [],
    });
    expect(mixed.products.map((p) => [p.slug, p.name, p.category.slug])).toEqual([
      ['mrf-savari-car-and-suv-tyre', 'MRF Savari (car and SUV tyre)', 'car-suv-tyres'],
      [
        'mrf-savari-light-commercial-vehicle-tyre',
        'MRF Savari (light commercial vehicle tyre)',
        'light-commercial-tyres',
      ],
    ]);
    expect(mixed.products.map((p) => p.variants.length)).toEqual([1, 1]);
  });

  it('a ply rating that is a spreadsheet date is left blank and reported', () => {
    const sku = by('mrf-krishi')?.variants[3]?.sku ?? '';
    expect(sizeSpec('mrf-krishi', sku)).not.toHaveProperty('plyRating');
    expect(sizeSpec('mrf-krishi', sku)?.sourceChecks).toEqual(
      expect.arrayContaining([expect.stringContaining('45634')]),
    );
    expect(plan.checks.some((c) => c.note.includes('45634'))).toBe(true);
    expect(sizeSpec('mrf-krishi', sku)).not.toHaveProperty('tubeIncluded');
  });

  it('only passenger car and two-wheeler sizes have an MRP; the rest are price on request, listed per size', () => {
    expect(by('mrf-zwyde')?.variants.map((v) => v.mrpPaise)).toEqual([536000, 600000]);
    expect(by('mrf-masseter-fx')?.variants[0]?.mrpPaise).toBe(250000);
    expect(by('mrf-krishi')?.variants.map((v) => v.mrpPaise)).toEqual([null, null, null, null]);
    expect(plan.priceOnRequest).toHaveLength(7);
    expect(plan.priceOnRequest[0]).toMatchObject({ slug: 'mrf-krishi' });
    expect(plan.products.every((p) => p.status === 'live' || p.slug.includes('masseter'))).toBe(true);
  });

  it('sub-categories: car, farm, light commercial, tubes and flaps; HSN 4011 / flap 4012 / tube 4013', () => {
    expect(by('mrf-savari')?.category.slug).toBe('light-commercial-tyres');
    expect(by('mrf-krishi')?.category.slug).toBe('farm-tyres');
    expect(by('mrf-bias-poly-pouch')).toMatchObject({ hsn: '4013', productType: 'tube' });
    expect(by('mrf-brass-reinforced-flaps')).toMatchObject({ hsn: '4012', productType: 'flap' });
    expect(by('mrf-krishi')?.hsn).toBe('4011');
  });

  it('spec per size: letter sizes stay out of the size attribute; metric sizes give the width in mm, others in inches', () => {
    const savari = by('mrf-savari')?.variants[0]?.sku ?? '';
    expect(sizeSpec('mrf-savari', savari)).not.toHaveProperty('size');
    const krishi = by('mrf-krishi')?.variants[0]?.sku ?? '';
    expect(sizeSpec('mrf-krishi', krishi)).toMatchObject({ sectionWidthInch: 8, rimInch: 18, plyRating: 6 });
    const zwyde = by('mrf-zwyde')?.variants[0]?.sku ?? '';
    expect(sizeSpec('mrf-zwyde', zwyde)).toMatchObject({ widthMm: 175, tubeless: true, speedSymbol: 'T' });
    expect(by('mrf-zwyde')?.spec).toMatchObject({ pattern: 'ZWyde', sizeCount: 2 });
  });

  it('pictures per pattern in order left, right, side, front; no picture file = draft', () => {
    expect(by('mrf-zwyde')?.photos.map((p) => p.file.replace(/^.* - /, ''))).toEqual([
      'Left.jpg',
      'Right.jpg',
      'Side.jpg',
      'Front.jpg',
    ]);
    expect(by('mrf-masseter-fx')?.status).toBe('draft');
  });

  it('fitment per size: the make is the first words of the vehicle name', () => {
    const zwyde = by('mrf-zwyde')?.variants[0]?.sku ?? '';
    expect(sizeSpec('mrf-zwyde', zwyde)?.fitment).toEqual([
      expect.objectContaining({ make: 'FORCE MOTORS', model: 'TRAVELLER (NEW)' }),
      expect.objectContaining({ make: 'MARUTI', model: 'ZEN ESTILO' }),
    ]);
  });

  it('Hindi: tube and flap names translate their generic words; no English words are left', () => {
    expect(by('mrf-bias-poly-pouch')?.nameHi).toBe('MRF बायस पॉली पाउच');
    expect(by('mrf-brass-reinforced-flaps')?.nameHi).toBe('MRF ब्रास रीइन्फोर्स्ड फ़्लैप');
    expect(planHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
  });
});
