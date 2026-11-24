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
  `CEAT ZOOM X3 110/80-17 57P TL,Motorcycle tyre,ZOOM X3,110/80-17,113577,,8808,110,80,17,57,P,,Bias,Tube Less,,Front,,,,,,,,,https://ceat.example/b,pictures/Motorcycle tyre/ZOOM X3/CEAT ZOOM X3 - Front.jpg,,Price not shown on the page (the site has it only in its hidden data)`,
  `CEAT GRIPP 110/70-12 47P TL,Scooter tyre,GRIPP,110/70-12,107261,1619,,110,70,12,47,P,,Bias,Tube Less,,,,,,,,,,,https://ceat.example/c,,,"No picture on the page; Page heading says GRIPP, but CEAT’s product name for this page is ""110/70-12 Energy Ride EV 47P"""`,
  `CEAT FM SUPER 10.00-20 (SKU 100014),Commercial (truck / bus) tyre,FM SUPER,10.00-20,100014,,,10.0,,20,,,16,Bias,,,,1080,280,16.5,17,Heavy Load -Short Haul Application,"General Goods, Cement",,,https://ceat.example/d,pictures/Commercial (truck - bus) tyre/FM SUPER/CEAT FM SUPER - Front.jpg,,`,
].join('\n');
const CEAT_FIT = `Vehicle type,Make,Model,Variant,Manufacturing years,Front / rear,Option,Tyre,Size,Has product page
Car,MARUTI,800,NA,1983-2014,,Recommended,CEAT MILAZE X3 145/70R12 69T TL,145/70R12,Yes
Car,MARUTI,Omni,ALL,2000 ONWARDS,,Other option,CEAT MILAZE X3 145/70R12 69T TL,145/70R12,Yes
Motorcycle,ROYAL ENFIELD,Classic 350,NA,2020-2025,Front,Recommended,CEAT ZOOM X3 110/80-17 57P TL,110/80-17,Yes
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

  it('names, slugs from the full name, SKU and part number are the maker codes', () => {
    expect(plan.products.map((p) => p.name)).toEqual([
      'CEAT Milaze X3 145/70R12 69T TL',
      'CEAT Zoom X3 110/80-17 57P TL',
      'CEAT Gripp 110/70-12 47P TL',
      'CEAT FM Super 10.00-20 (SKU 100014)',
    ]);
    const car = by('ceat-milaze-x3-145-70r12-69t-tl');
    expect(car?.variant.sku).toBe('CEAT-105037');
    expect(car?.partNumber.normalised).toBe('105037');
    expect(car?.range.slug).toBe('ceat-milaze-x3');
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
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
  });

  it('the price shown on the page is the MRP; the hidden site price is kept privately and never the MRP', () => {
    expect(by('ceat-milaze-x3-145-70r12-69t-tl')?.variant.mrpPaise).toBe(290000);
    const hidden = by('ceat-zoom-x3-110-80-17-57p-tl');
    expect(hidden?.variant.mrpPaise).toBeNull();
    expect(hidden?.spec.ceatPrice).toEqual({ siteData: { paise: 880800, gstIncluded: true } });
    expect(by('ceat-fm-super-10-00-20-sku-100014')?.variant.mrpPaise).toBeNull();
    expect(plan.priceOnRequest.map((p) => [p.slug, p.siteDataPaise])).toEqual([
      ['ceat-zoom-x3-110-80-17-57p-tl', 880800],
      ['ceat-fm-super-10-00-20-sku-100014', null],
    ]);
  });

  it('typed spec: size, load, speed, construction, tube type, position (two-wheelers only), truck extras, HSN and GST', () => {
    const car = by('ceat-milaze-x3-145-70r12-69t-tl');
    expect(car?.spec).toMatchObject({
      source: 'ceat',
      size: '145/70R12',
      widthMm: 145,
      aspectRatioPct: 70,
      rimInch: 12,
      construction: 'radial',
      loadIndex: 69,
      speedSymbol: 'T',
      tubeless: true,
    });
    expect(car?.spec).not.toHaveProperty('position');
    expect(by('ceat-zoom-x3-110-80-17-57p-tl')?.spec).toMatchObject({
      position: 'front',
      construction: 'bias',
    });
    const truck = by('ceat-fm-super-10-00-20-sku-100014');
    expect(truck?.spec).toMatchObject({
      plyRating: 16,
      sectionWidthInch: 10,
      overallDiameterMm: 1080,
      treadDepthMm: 16.5,
      mPlusRating: 17,
    });
    expect(truck?.spec).not.toHaveProperty('widthMm');
    expect(truck?.hsn).toBe('4011');
    expect(truck?.gstRateBp).toBe(1800);
  });

  it('fitment goes to spec.fitment with option and years; lines with no product page are counted, not attached', () => {
    const car = by('ceat-milaze-x3-145-70r12-69t-tl');
    expect(car?.spec.fitment).toEqual([
      expect.objectContaining({ make: 'MARUTI', model: '800', years: '1983-2014', option: 'recommended' }),
      expect.objectContaining({ make: 'MARUTI', model: 'Omni', years: '2000 ONWARDS', option: 'other' }),
    ]);
    expect(car?.compatibility).toBe('Maruti 800, Maruti Omni');
    expect(plan.orphanFitment).toBe(1);
  });

  it('pictures: gallery order front, angle, angle, side; no picture = draft', () => {
    expect(by('ceat-milaze-x3-145-70r12-69t-tl')?.photos.map((p) => p.file)).toEqual([
      FRONT,
      A60,
      A120,
      SIDE,
    ]);
    const scooter = by('ceat-gripp-110-70-12-47p-tl');
    expect(scooter?.status).toBe('draft');
    expect(scooter?.photos).toEqual([]);
    expect(plan.products.filter((p) => p.status === 'draft')).toHaveLength(1);
    expect(plan.noPhoto).toEqual([
      {
        slug: 'ceat-gripp-110-70-12-47p-tl',
        name: 'CEAT Gripp 110/70-12 47P TL',
        reason: 'no_photo_on_site',
      },
    ]);
  });

  it('a picture file missing from the folder is left out and reported', () => {
    const p = ceat(CEAT_ROWS, (f) => f !== A60);
    expect(p.products[0]?.photos.map((x) => x.file)).toEqual([FRONT, A120, SIDE]);
    expect(p.checks.some((c) => c.note.includes('is not in the folder'))).toBe(true);
  });

  it('source oddities are reported with how they were handled; price notes are not oddities', () => {
    expect(plan.checks.map((c) => c.name)).toEqual([
      'CEAT Gripp 110/70-12 47P TL',
      'CEAT Gripp 110/70-12 47P TL',
    ]);
    expect(plan.checks[0]?.note).toContain('Handled:');
    expect(plan.checks.every((c) => c.slug === 'ceat-gripp-110-70-12-47p-tl')).toBe(true);
  });

  it('Hindi: no English words outside brand, model and code names; every feature translated', () => {
    expect(planHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
    const car = by('ceat-milaze-x3-145-70r12-69t-tl');
    expect(car?.highlightsHi.at(-1)).toMatch(/[ऀ-ॿ]/);
    expect(car?.highlights.length).toBe(car?.highlightsHi.length);
    expect(car?.specSummaryHi).toBe('145/70R12 · रेडियल · ट्यूबलेस (TL) · 69T');
  });
});

const MRF_HEADER =
  'Tyre,Product type,Pattern,Size,MRP incl. GST (Rs),Width,Aspect ratio,Rim (inch),Construction,Load index,Speed rating,Ply rating,Tubeless (TL) / tube type (TT),Tube sold with tyre,Features,Tyre name on site,Product page,Picture files,Picture URLs';
const MRF_PICS =
  'pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Side.jpg | pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Right.jpg | pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Left.jpg | pictures/Passenger car tyre/ZWYDE/MRF ZWYDE - Front.jpg';
const KRISHI = 'pictures/Farm tyre/KRISHI/MRF KRISHI - Left.jpg';
const MRF_ROWS = [
  `MRF ZWYDE 175/60R13 77T TL,Passenger car tyre,ZWYDE,175/60R13,5360,175,60,13,Radial,77,T,,TL (tubeless),No,Broader 4 Rib Pattern.; Aggressive sipes.,175/60R13 77T TL ZWYDE,https://mrf.example/a,${MRF_PICS},`,
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

  it('names in title case, one product per size; identical duplicate pages are merged, a different ply keeps both', () => {
    expect(plan.products.map((p) => p.name)).toEqual([
      'MRF ZWyde 175/60R13 77T TL',
      'MRF 8-18 Krishi',
      'MRF 8.3-20 Krishi (4 Ply)',
      'MRF 8.3-20 Krishi (6 Ply)',
      'MRF 9.5-24 Krishi',
      'MRF 165D14 Savari N8 TT',
      'MRF 4.50-12 Bias Poly Pouch',
      'MRF 10.00-20 BR Brass Reinforced Flaps',
      'MRF 100/80-17 52P Masseter FX TL',
    ]);
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
    const notes = plan.checks.map((c) => `${c.name}: ${c.note}`);
    expect(notes.some((n) => n.startsWith('MRF 8-18 Krishi') && n.includes('merged into one'))).toBe(true);
    expect(notes.some((n) => n.startsWith('MRF 8.3-20 Krishi (4 Ply)') && n.includes('different ply'))).toBe(
      true,
    );
    expect(notes.some((n) => n.includes('Discontinued pages') && n.includes('22 pages'))).toBe(true);
  });

  it('a ply rating that is a spreadsheet date is left blank and reported', () => {
    const k = by('mrf-9-5-24-krishi');
    expect(k?.spec).not.toHaveProperty('plyRating');
    expect(k?.spec.sourceChecks).toEqual(expect.arrayContaining([expect.stringContaining('45634')]));
    expect(plan.checks.some((c) => c.note.includes('45634'))).toBe(true);
    expect(k?.spec).not.toHaveProperty('tubeIncluded');
  });

  it('only passenger car and two-wheeler tyres have an MRP; the rest are price on request', () => {
    expect(by('mrf-zwyde-175-60r13-77t-tl')?.variant.mrpPaise).toBe(536000);
    expect(by('mrf-100-80-17-52p-masseter-fx-tl')?.variant.mrpPaise).toBe(250000);
    expect(by('mrf-8-18-krishi')?.variant.mrpPaise).toBeNull();
    expect(plan.priceOnRequest).toHaveLength(7);
    expect(plan.products.every((p) => p.status === 'live' || p.slug.includes('masseter'))).toBe(true);
  });

  it('sub-categories: car, farm, light commercial, tubes and flaps; HSN 4011 / flap 4012 / tube 4013', () => {
    expect(by('mrf-165d14-savari-n8-tt')?.category.slug).toBe('light-commercial-tyres');
    expect(by('mrf-8-18-krishi')?.category.slug).toBe('farm-tyres');
    expect(by('mrf-4-50-12-bias-poly-pouch')).toMatchObject({ hsn: '4013', productType: 'tube' });
    expect(by('mrf-10-00-20-br-brass-reinforced-flaps')).toMatchObject({ hsn: '4012', productType: 'flap' });
    expect(by('mrf-8-18-krishi')?.hsn).toBe('4011');
  });

  it('spec: tyre sizes with letters stay out of the size attribute; metric sizes give the width in mm, others in inches', () => {
    expect(by('mrf-165d14-savari-n8-tt')?.spec).not.toHaveProperty('size');
    expect(by('mrf-8-18-krishi')?.spec).toMatchObject({ sectionWidthInch: 8, rimInch: 18, plyRating: 6 });
    expect(by('mrf-zwyde-175-60r13-77t-tl')?.spec).toMatchObject({
      widthMm: 175,
      tubeless: true,
      speedSymbol: 'T',
    });
  });

  it('pictures per pattern in order left, right, side, front; no picture file = draft', () => {
    expect(by('mrf-zwyde-175-60r13-77t-tl')?.photos.map((p) => p.file.replace(/^.* - /, ''))).toEqual([
      'Left.jpg',
      'Right.jpg',
      'Side.jpg',
      'Front.jpg',
    ]);
    expect(by('mrf-100-80-17-52p-masseter-fx-tl')?.status).toBe('draft');
  });

  it('fitment: the make is the first words of the vehicle name', () => {
    expect(by('mrf-zwyde-175-60r13-77t-tl')?.spec.fitment).toEqual([
      expect.objectContaining({ make: 'FORCE MOTORS', model: 'TRAVELLER (NEW)' }),
      expect.objectContaining({ make: 'MARUTI', model: 'ZEN ESTILO' }),
    ]);
  });

  it('Hindi: tube and flap names translate their generic words; no English words are left', () => {
    expect(by('mrf-4-50-12-bias-poly-pouch')?.nameHi).toBe('MRF 4.50-12 बायस पॉली पाउच');
    expect(by('mrf-10-00-20-br-brass-reinforced-flaps')?.nameHi).toBe(
      'MRF 10.00-20 BR ब्रास रीइन्फोर्स्ड फ़्लैप',
    );
    expect(by('mrf-8-3-20-krishi-4-ply')?.nameHi).toBe('MRF 8.3-20 Krishi (4 प्लाई)');
    expect(planHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
  });
});
