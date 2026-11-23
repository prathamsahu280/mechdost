/**
 * Exide plan (user 2026-11-23): exact names, typed specs, full fitment, years from the model text, real Hindi. Runs on a
 * fixture of real rows; the full 211-row check runs when the exidecare folder is on this machine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_CAP,
  csvRows,
  exideHindiLeftovers,
  parseEra,
  parseModelYears,
  planExide,
  type ExideFitment,
  planExideDir,
  yearText,
  type ExidePlan,
} from '../src/exide';

const fix = (name: string) =>
  csvRows(readFileSync(new URL(`./fixtures/exide/${name}`, import.meta.url), 'utf8'));
const plan: ExidePlan = planExide({
  batteries: fix('exide_batteries.csv'),
  fitment: fix('exide_vehicle_fitment.csv'),
});
const by = (model: string) => {
  const p = plan.products.find((x) => x.variant.model === model);
  if (!p) throw new Error(`no ${model}`);
  return p;
};
const DEVANAGARI = /[\u0900-\u097F]/;

describe('exact names and ranges', () => {
  it('names a product "Exide <Range> <MODEL>" with the model verbatim', () => {
    expect(by('ML55D23L').name).toBe('Exide Mileage ML55D23L');
    expect(by('ML55D23L').slug).toBe('exide-mileage-ml55d23l');
    expect(by('ML55D23L').range).toMatchObject({ slug: 'exide-mileage', name: 'Exide Mileage' });
    expect(by('MAGIC12V800').name).toBe('Exide Inverter Magic MAGIC12V800');
    expect(by('LIB12V100').name).toBe('Exide Nexcharge LIB12V100');
    expect(by('InvaTubular IT500 + GQP 12V1125').name).toBe('Exide InvaTubular IT500 + GQP 12V1125');
  });
  it('keeps both rows of a model that two ranges share, with distinct slugs and SKUs', () => {
    const it900 = plan.products.filter((p) => p.variant.model === 'IT900');
    expect(it900).toHaveLength(2);
    expect(new Set(it900.map((p) => p.slug)).size).toBe(2);
    expect(new Set(it900.map((p) => p.variant.sku)).size).toBe(2);
  });
  it('one pack, model as manufacturer part number', () => {
    const p = by('ML55D23L');
    expect(p.variant.sku).toBe('EXIDE-ML55D23L');
    expect(p.variant.netQuantity).toEqual({ qty: 1, unit: 'piece' });
    expect(p.partNumber).toEqual({ kind: 'mfr', value: 'ML55D23L', normalised: 'ML55D23L' });
  });
});

describe('tax, category, vehicle types, price', () => {
  it('HSN 8507 for batteries and 8504 for inverters and combos, 18 %', () => {
    expect(by('ML55D23L')).toMatchObject({ hsn: '8507', gstRateBp: 1800 });
    expect(by('IMTT1800')).toMatchObject({ hsn: '8507' });
    expect(by('GQP12V1450N')).toMatchObject({ hsn: '8504' });
    expect(by('InvaTubular IT500 + GQP 12V1125')).toMatchObject({ hsn: '8504' });
  });
  it('vehicle batteries sit in the batteries sub-categories, home power in its own category', () => {
    expect(by('ML55D23L').category).toMatchObject({ slug: 'car-suv-batteries', parent: 'batteries' });
    expect(by('DRIVE180R').category.slug).toBe('cv-batteries');
    expect(by('XP880').category.slug).toBe('cv-batteries');
    expect(by('KI88T').category.slug).toBe('tractor-batteries');
    expect(by('GP110D31R').category.slug).toBe('genset-batteries');
    for (const m of ['IMTT1800', 'GQP12V1450N', 'LIB12V100', 'InvaTubular IT500 + GQP 12V1125'])
      expect(by(m).category).toMatchObject({
        slug: 'home-power',
        parent: null,
        nameHi: 'इन्वर्टर और होम UPS',
      });
  });
  it('vehicle types only for 2W, 3W and cars', () => {
    expect(by('ML55D23L').vehicleTypes).toEqual(['4W']);
    expect(by('DRIVE180R').vehicleTypes).toEqual([]);
    expect(by('KI88T').vehicleTypes).toEqual([]);
    expect(by('GQP12V1450N').vehicleTypes).toEqual([]);
  });
  it('MRP in paise; no MRP means price on request', () => {
    expect(by('AGMIDIN50').variant.mrpPaise).toBe(1001100);
    expect(by('InvaTubular IT500 + GQP 12V1125').variant.mrpPaise).toBeNull();
    expect(by('AGMIDIN50').variant.weightG).toBe(15400);
  });
});

describe('spec, summary, Hindi', () => {
  it('writes typed specs', () => {
    expect(by('AGMIDIN50').spec).toMatchObject({
      source: 'exidecare',
      capacityAh: 50,
      lengthMm: 207,
      widthMm: 175,
      heightMm: 190,
      weightKg: 15.4,
      terminalLayout: 'left',
      ccaEn: 560,
      batteryType: 'agm',
      warrantyMonths: 48,
      freeReplacementMonths: 24,
      proRataMonths: 24,
    });
    expect(by('GQP12V1450N').spec).toMatchObject({
      inverterRating: '1450VA 12V',
      inverterVa: 1450,
      voltage: 12,
    });
    expect(by('LIB12V100').spec).toMatchObject({ batteryType: 'lithium' });
    expect(by('InvaTubular IT500 + GQP 12V1125').spec).toMatchObject({ capacityAh: 150, inverterVa: 1125 });
  });
  it('drops a zero height and keeps no empty values', () => {
    const spec = by('MAGIC12V800').spec;
    expect(spec).not.toHaveProperty('heightMm');
    expect(Object.values(spec).every((v) => v !== '' && v !== null)).toBe(true);
  });
  it('writes a one-line summary, at most 8 aligned highlights and a Hindi twin', () => {
    const p = by('AGMIDIN50');
    expect(p.specSummary).toBe('50 Ah · 48 months warranty · Left terminal');
    expect(p.specSummaryHi).toBe('क्षमता 50 Ah · वारंटी 48 महीने · टर्मिनल बायाँ');
    expect(p.highlights.length).toBeLessThanOrEqual(8);
    expect(p.highlightsHi).toHaveLength(p.highlights.length);
    expect(p.descriptionHi).toMatch(DEVANAGARI);
    expect(p.nameHi).toBe('Exide Agmi AGMIDIN50'.replace('Agmi', 'AGMi'));
  });
  it('has no English word left in any Hindi text, and no untranslated feature line', () => {
    expect(exideHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
  });
});

describe('fitment', () => {
  it('writes the full list into spec.fitment and a capped text into compatibility', () => {
    const p = by('12XL5L-B');
    const fit = p.spec.fitment as { type: string; make: string; model: string; fuel: string | null }[];
    expect(fit.length).toBe(p.fitmentCount);
    expect(fit.length).toBeGreaterThan(COMPATIBILITY_CAP);
    expect(p.compatibility).toMatch(new RegExp(`and ${String(fit.length - COMPATIBILITY_CAP)} more$`));
    expect(p.compatibilityHi).toMatch(new RegExp(`और ${String(fit.length - COMPATIBILITY_CAP)} अन्य$`));
    expect(fit[0]).toHaveProperty('yearFrom');
    expect(fit[0]).toHaveProperty('yearTo');
  });
  it('shows fuel and start words in both languages', () => {
    const ml = by('ML55D23L');
    expect(ml.compatibility).toMatch(/\((Petrol|Diesel|CNG)/);
    expect(ml.compatibilityHi).toMatch(/पेट्रोल|डीज़ल/);
  });
  it('has no fitment text for a battery nothing in the vehicle list uses', () => {
    expect(by('GQP12V1450N').compatibility).toBeNull();
    expect(by('GQP12V1450N').spec).not.toHaveProperty('fitment');
  });
});

describe('years in the model text', () => {
  it.each([
    ['CRETA -2023 ONWARDS', 'CRETA', 2023, null],
    ['ALCAZAR - HIGH ENGINE-2023 ONW', 'ALCAZAR - HIGH ENGINE', 2023, null],
    ['CRETA - HIGH ENGINE-2023 ONWAR', 'CRETA - HIGH ENGINE', 2023, null],
    ['CARENS - HIGH ENGINE-2023 ONWA', 'CARENS - HIGH ENGINE', 2023, null],
    ['I20-2023 ONWARDS', 'I20', 2023, null],
    ['VENUE -2023 ONWARDS', 'VENUE', 2023, null],
    ['SCORPIO 2022', 'SCORPIO', 2022, 2022],
    ['SWIFT 2019-2022', 'SWIFT', 2019, 2022],
    ['SWIFT 2019 TO 2022', 'SWIFT', 2019, 2022],
  ])('%s', (raw, model, from, to) => {
    expect(parseModelYears(raw)).toEqual({ model, yearFrom: from, yearTo: to });
  });
  it.each(['2030DI-33HP', '2050DI -50HP', 'SWIFT', 'WAGON R'])('leaves %s alone', (raw) => {
    expect(parseModelYears(raw)).toEqual({ model: raw, yearFrom: null, yearTo: null });
  });
  it('words the years', () => {
    expect(yearText({ yearFrom: 2023, yearTo: null }, false)).toBe('2023 onwards');
    expect(yearText({ yearFrom: 2023, yearTo: null }, true)).toBe('2023 से');
    expect(yearText({ yearFrom: 2019, yearTo: 2022 }, true)).toBe('2019 से 2022');
    expect(yearText({ yearFrom: null, yearTo: null }, false)).toBeNull();
  });
  it('shows the year in the compatibility text and keeps it out of the model name', () => {
    const withYear = plan.products.find((p) => (p.compatibility ?? '').includes('2023 onwards'));
    expect(withYear).toBeDefined();
    expect(withYear?.compatibility).toMatch(/Creta \((Petrol|Diesel), 2023 onwards\)/);
    expect(withYear?.compatibilityHi).toContain('2023 से');
    const fit = withYear?.spec.fitment as { model: string; yearFrom: number | null }[];
    expect(fit.some((e) => e.yearFrom === 2023 && !/2023|ONW/i.test(e.model))).toBe(true);
  });
});

describe('model year / era column', () => {
  it.each([
    ['BS II emission norm (sold nationally Apr 2005 - Mar 2010)', 2005, 2010, 'bs2'],
    ['BS III emission norm (sold nationally Apr 2010 - Mar 2017)', 2010, 2017, 'bs3'],
    ['BS IV emission norm (sold nationally Apr 2017 - Mar 2020)', 2017, 2020, 'bs4'],
    ['BS VI emission norm (sold from Apr 2020)', 2020, null, 'bs6'],
    ['2023 onwards', 2023, null, null],
    ['2022 model', 2022, 2022, null],
    ['Newer version (name says NEW)', null, null, 'new'],
    ['Older version (name says OLD)', null, null, 'old'],
    ['Facelift version', null, null, 'facelift'],
    ['Something Exide adds later', null, null, null],
    ['', null, null, null],
  ])('%s', (raw, from, to, era) => {
    expect(parseEra(raw)).toEqual({ yearFrom: from, yearTo: to, era });
  });
  it('writes years and era into spec.fitment and brief words into both texts', () => {
    const all = plan.products.flatMap((p) => (p.spec.fitment ?? []) as ExideFitment[]);
    for (const era of ['bs2', 'bs3', 'bs4', 'bs6', 'new', 'old', 'facelift'])
      expect(all.some((e) => e.era === era)).toBe(true);
    const text = plan.products.map((p) => p.compatibility ?? '').join(' ');
    const textHi = plan.products.map((p) => p.compatibilityHi ?? '').join(' ');
    expect(text).toMatch(/BS III, 2010-2017/);
    expect(text).toMatch(/new model/);
    expect(textHi).toMatch(/नया मॉडल/);
    expect(textHi).toMatch(/BS III, 2010 से 2017/);
  });
});

describe('range photos', () => {
  it('records which pictures are generic', () => {
    expect(by('GQP12V1450N').spec.photoKind).toBe('range');
    expect(by('ML55D23L').spec.photoKind).toBe('model');
    expect(plan.rows.find((r) => r.model === 'GQP12V1450N')?.photoKind).toBe('range');
  });
});

const DIR = 'C:/Users/Admin/Desktop/autoparts/exide_batteries';
describe.skipIf(!existsSync(`${DIR}/exide_batteries.csv`))('all 211 source rows', () => {
  const full = planExideDir(DIR);
  it('plans every row once with unique slugs and SKUs, all live', () => {
    expect(full.products).toHaveLength(211);
    expect(new Set(full.products.map((p) => p.slug)).size).toBe(211);
    expect(new Set(full.products.map((p) => p.variant.sku)).size).toBe(211);
    expect(full.products.every((p) => p.status === 'live')).toBe(true);
    expect(full.products.filter((p) => p.variant.mrpPaise === null)).toHaveLength(3);
    expect(full.orphanFitment).toBe(0);
  });
  it('passes the Hindi check everywhere', () => {
    expect(exideHindiLeftovers(full)).toEqual([]);
    expect(full.untranslated).toEqual([]);
  });
});
