/**
 * Amaron plan (user 2026-11-23): exact names, MRP next to Amaron's own price terms, typed specs, up to three photos in
 * order, fitment with years and eras, combos attached and not planned as products, real Hindi. Runs on a fixture of real
 * rows (40 batteries incl. the 11 the finder does not list); the full 144-row check runs when the source folder is on
 * this machine (built lazily: a skipped describe body still runs while collecting).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  amaronHindiLeftovers,
  csvRows,
  planAmaron,
  planAmaronDir,
  rangeTitle,
  type AmaronPlan,
} from '../src/amaron';
import { COMPATIBILITY_CAP, parseEra, yearText } from '../src/battery-import';

const fix = (name: string) =>
  csvRows(readFileSync(new URL(`./fixtures/amaron/${name}`, import.meta.url), 'utf8'));
const input = {
  batteries: fix('amaron_batteries.csv'),
  fitment: fix('amaron_vehicle_fitment.csv'),
  combos: fix('amaron_home_ups_combos.csv'),
};
const plan: AmaronPlan = planAmaron(input);
const by = (name: string) => {
  const p = plan.products.find((x) => x.name === name);
  if (!p) throw new Error(`no ${name}`);
  return p;
};
const DEVANAGARI = /[\u0900-\u097F]/;

describe('exact names, ranges, ids', () => {
  it('names a product as Amaron does, in title case, codes verbatim', () => {
    expect(by('Amaron Pro 55B24LS').slug).toBe('amaron-pro-55b24ls');
    expect(by('Amaron Current Short Tubular AM130ST36').slug).toBe('amaron-current-short-tubular-am130st36');
    expect(by('Amaron Home UPS HB750A').nameHi).toBe('Amaron होम UPS HB750A');
    expect(by('Amaron Pro Bike Rider APBTZ4A').nameHi).toBe('Amaron Pro बाइक राइडर APBTZ4A');
    expect(by('Amaron High-Capacity Inverters HBP3500A Sine Wave Inverters').nameHi).toBe(
      'Amaron हाई-कैपेसिटी इन्वर्टर HBP3500A साइन वेव इन्वर्टर',
    );
  });
  it('puts the product under its range of brand Amaron', () => {
    expect(by('Amaron Pro 55B24LS').range).toMatchObject({ slug: 'amaron-pro', name: 'Amaron Pro' });
    expect(rangeTitle('Sine wave Home UPS')).toEqual({
      en: 'Amaron Sine Wave Home UPS',
      hi: 'Amaron साइन वेव होम UPS',
    });
    expect(rangeTitle('Amaron Current Tall Tubular').hi).toBe('Amaron Current टॉल ट्यूबुलर');
  });
  it('SKU from the item code; the model and the item code are manufacturer part numbers', () => {
    const p = by('Amaron Pro 55B24LS');
    expect(p.variant).toMatchObject({ sku: 'AMARON-AAM-PR-0055B24LS', model: '55B24LS' });
    expect(p.variant.netQuantity).toEqual({ qty: 1, unit: 'piece' });
    expect(p.partNumbers).toEqual([
      { kind: 'mfr', value: '55B24LS', normalised: '55B24LS' },
      { kind: 'mfr', value: 'AAM-PR-0055B24LS', normalised: 'AAMPR0055B24LS' },
    ]);
    // A Home UPS row has no Model column: the model is the code in its name.
    expect(by('Amaron Home UPS HB750A').variant.model).toBe('HB750A');
  });
  it('has unique slugs and SKUs', () => {
    expect(new Set(plan.products.map((p) => p.slug)).size).toBe(plan.products.length);
    expect(new Set(plan.products.map((p) => p.variant.sku)).size).toBe(plan.products.length);
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
  });
});

describe('categories, tax, vehicle types', () => {
  it('maps each product type to the categories the Exide import made, and a new earth-moving one', () => {
    expect(by('Amaron Pro 55B24LS').category).toMatchObject({
      slug: 'car-suv-batteries',
      parent: 'batteries',
    });
    expect(by('Amaron Hiway HC620D31R').category.slug).toBe('cv-batteries');
    expect(by('Amaron Black BL800LMF').category.slug).toBe('tractor-batteries');
    expect(by('Amaron Black BL300RMF').category.slug).toBe('three-wheeler-batteries');
    expect(by('Amaron Pro Bike Rider APBTZ4A').category.slug).toBe('two-wheeler-batteries');
    expect(by('Amaron Black BL1000LMF').category).toEqual({
      slug: 'earth-moving-batteries',
      parent: 'batteries',
      name: 'Earth-moving & construction equipment batteries',
      nameHi: 'अर्थ-मूविंग और कंस्ट्रक्शन मशीन बैटरी',
    });
    for (const n of ['Amaron Current Short Tubular AM130ST36', 'Amaron Home UPS HB750A'])
      expect(by(n).category).toMatchObject({ slug: 'home-power', parent: null });
  });
  it('sorts the 11 batteries the finder does not list by the most common type of their range and size', () => {
    expect(plan.notInFinder).toHaveLength(11);
    const cat = (slug: string) => plan.notInFinder.find((n) => n.slug === slug)?.category;
    expect(cat('amaron-flo-36b20l')).toBe('car-suv-batteries');
    expect(cat('amaron-pro-50b20r')).toBe('car-suv-batteries');
    expect(cat('amaron-hiway-nt700h29r')).toBe('cv-batteries');
    expect(cat('amaron-hiway-nt800d04r')).toBe('cv-batteries');
    // No listed battery of the range: car, SUV and MUV.
    expect(cat('amaron-fresh-fr300rmf')).toBe('car-suv-batteries');
    // The report keeps the source type; the product has the type it was sorted into.
    expect(plan.rows.find((r) => r.slug === 'amaron-hiway-nt700h29r')?.productType).toBe(
      'Battery not in the vehicle finder',
    );
    expect(by('Amaron Hiway NT700H29R').spec).toMatchObject({
      productType: 'truck_bus_battery',
      inVehicleFinder: false,
    });
  });
  it('HSN 8507 for batteries and 8504 for Home UPS inverters, GST from the CSV (18 %)', () => {
    expect(by('Amaron Pro 55B24LS')).toMatchObject({ hsn: '8507', gstRateBp: 1800 });
    expect(by('Amaron Current Short Tubular AM130ST36')).toMatchObject({ hsn: '8507' });
    expect(by('Amaron Home UPS HB750A')).toMatchObject({ hsn: '8504', gstRateBp: 1800 });
  });
  it('vehicle types only for 2W, 3W and cars', () => {
    expect(by('Amaron Pro 55B24LS').vehicleTypes).toEqual(['4W']);
    expect(by('Amaron Pro Bike Rider APBTZ4A').vehicleTypes).toEqual(['2W']);
    expect(by('Amaron Black BL300RMF').vehicleTypes).toEqual(['3W']);
    expect(by('Amaron Hiway HC620D31R').vehicleTypes).toEqual([]);
    expect(by('Amaron Home UPS HB750A').vehicleTypes).toEqual([]);
  });
});

describe('price: MRP for the shop, Amaron\u2019s own terms in the spec', () => {
  it('MRP is the crossed-out list price, in paise', () => {
    expect(by('Amaron Black BL400LMF').variant.mrpPaise).toBe(483700);
    expect(by('Amaron Current Short Tubular AM130ST36').variant.mrpPaise).toBe(1197200);
  });
  it('keeps the selling price, discount, validity, old-battery rebate and price before GST in the spec', () => {
    expect(by('Amaron Black BL400LMF').spec.amaronPrice).toEqual({
      sellingPaise: 454900,
      discountPaise: 28800,
      discountValid: 'Till 30th Nov',
      oldBatteryRebatePaise: 76000,
      priceBeforeGstPaise: 409915,
      gstRateBp: 1800,
    });
  });
  it('takes the validity of a Home UPS from its combos when the finder does not list it', () => {
    expect(by('Amaron Home UPS HB750A').spec.amaronPrice).toMatchObject({ discountValid: 'Till 30th Nov' });
    expect(by('Amaron Flo 36B20L').spec.amaronPrice).toMatchObject({ discountValid: null });
  });
});

describe('spec, summary, Hindi', () => {
  it('writes typed specs and no empty values', () => {
    const p = by('Amaron Pro 55B24LS');
    expect(p.spec).toMatchObject({
      source: 'amaron',
      itemCode: 'AAM-PR-0055B24LS',
      model: '55B24LS',
      voltageV: 12,
      capacityAh: 45,
      ccaA: 418,
      lengthMm: 238,
      widthMm: 129,
      heightMm: 227,
      terminalLayout: 'left',
      warrantyTotalMonths: 72,
      warrantyFreeMonths: 36,
      warrantyProRataMonths: 36,
    });
    expect(p.spec.productPage).toMatch(/^https:\/\/www\.amaron\.com\//);
    expect(Object.values(p.spec).every((v) => v !== '' && v !== undefined)).toBe(true);
    expect(by('Amaron Current Short Tubular AM130ST36').spec).toMatchObject({
      technology: 'Tubular - Flooded',
      formFactor: 'short_tubular',
      backupMinutes: 95,
    });
  });
  it('splits the warranty (free replacement + pro-rata) and words it in Hindi like Exide', () => {
    expect(by('Amaron Black BL400LMF').spec).toMatchObject({
      warrantyTotalMonths: 24,
      warrantyFreeMonths: 24,
      warrantyProRataMonths: 0,
    });
    expect(by('Amaron Black BL400LMF').highlights[0]).toBe(
      'Total warranty: 24 months (24 months free replacement)',
    );
    expect(by('Amaron Black BL400LMF').highlightsHi[0]).toBe(
      'कुल वारंटी: 24 महीने (24 महीने फ़्री रिप्लेसमेंट)',
    );
    expect(by('Amaron Pro 55B24LS').highlightsHi[0]).toBe(
      'कुल वारंटी: 72 महीने (36 महीने फ़्री रिप्लेसमेंट + 36 महीने आनुपातिक)',
    );
    expect(by('Amaron Pro 55B24LS').warranty).toBe('72 months');
  });
  it('leaves out a warranty the source does not give (the finder-less rows)', () => {
    const p = by('Amaron Flo 36B20L');
    expect(p.warranty).toBeNull();
    expect(p.spec).not.toHaveProperty('warrantyTotalMonths');
    expect(p.highlights.join(' ')).not.toMatch(/warranty/i);
  });
  it('writes a one-line summary, at most 8 aligned highlights with the old-battery rebate, and a Hindi twin', () => {
    const p = by('Amaron Pro 55B24LS');
    expect(p.specSummary).toBe('45 Ah · 72 months warranty · Left terminal');
    expect(p.specSummaryHi).toBe('क्षमता 45 Ah · वारंटी 72 महीने · टर्मिनल बायाँ');
    expect(p.highlights.length).toBeLessThanOrEqual(8);
    expect(p.highlightsHi).toHaveLength(p.highlights.length);
    expect(p.highlights).toContain('Old battery exchange rebate up to ₹965 at installation');
    expect(p.highlightsHi).toContain('पुरानी बैटरी देने पर इंस्टॉलेशन के समय ₹965 तक की छूट');
    expect(p.descriptionHi).toMatch(DEVANAGARI);
    expect(by('Amaron Home UPS HB750A').specSummary).toBe('12 V · 36 months warranty · 275 × 260 × 120 mm');
  });
  it('has no English word left in any Hindi text, and no untranslated feature line', () => {
    expect(amaronHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
  });
  it('translates the tubular battery and Home UPS feature lines (the source lines carry broken trade-mark bytes)', () => {
    expect(by('Amaron Current Short Tubular AM130ST36').descriptionHi).toContain('हाई-कोअर्स');
    expect(by('Amaron Home UPS HB750A').descriptionHi).toContain('प्योर साइन वेव आउटपुट');
  });
});

describe('photos', () => {
  it('imports all three photos in the order front, side, top, the front as the main photo', () => {
    const p = by('Amaron Black BL400LMF');
    expect(p.photos.map((x) => /- (\w+)\.jpg$/.exec(x.file)?.[1])).toEqual(['Front', 'Side', 'Top']);
    expect(p.photo).toEqual(p.photos[0]);
    expect(p.photos[0]?.sourceUrl).toMatch(/^https:\/\/amaron-prod-images\.s3\./);
    expect(p.photos[0]?.alt).toBe('Amaron Black BL400LMF (front view)');
    expect(p.photos[1]?.altHi).toBe('Amaron Black BL400LMF (बग़ल से)');
    expect(p.spec).toMatchObject({
      photoKind: 'model',
      photoKinds: { front: 'own', side: 'own', top: 'own' },
    });
  });
  it('keeps one photo where the source repeats one shared "View" picture, recorded as shared', () => {
    const p = by('Amaron Black BL40LMF');
    expect(p.photos).toHaveLength(1);
    expect(p.photos[0]?.file).toMatch(/- View\.jpg$/);
    expect(p.spec).toMatchObject({ photoKind: 'range', photoKinds: { view: 'shared' } });
    expect(plan.rows.find((r) => r.model === 'BL0040LMF')?.photoKind).toBe('range');
  });
  it('records which of the three photos are shared with other products', () => {
    const kinds = plan.products.map((p) => JSON.stringify(p.spec.photoKinds));
    expect(kinds.some((k) => k.includes('"own"') && k.includes('"shared"'))).toBe(true);
  });
  it('leaves a missing file out and plans a product with no picture at all as a draft', () => {
    const noSide = planAmaron({ ...input, pictureExists: (f) => !f.includes(' - Side.') });
    const p = noSide.products.find((x) => x.name === 'Amaron Black BL400LMF');
    expect(p?.photos.map((x) => /- (\w+)\.jpg$/.exec(x.file)?.[1])).toEqual(['Front', 'Top']);
    expect(p?.status).toBe('live');
    const none = planAmaron({ ...input, pictureExists: () => false });
    expect(
      none.products.every((x) => x.status === 'draft' && x.photos.length === 0 && x.photo === null),
    ).toBe(true);
  });
});

describe('fitment', () => {
  it('writes the full list into spec.fitment and a capped text into compatibility', () => {
    const p = by('Amaron Black BL800LMF');
    const fit = p.spec.fitment as { type: string; make: string; model: string; fuel: string | null }[];
    expect(fit.length).toBe(p.fitmentCount);
    expect(fit.length).toBeGreaterThan(COMPATIBILITY_CAP);
    // The text lists each distinct label once (the list holds the same vehicle for several years or fuels).
    const more = Number(/and (\d+) more$/.exec(p.compatibility ?? '')?.[1]);
    expect(more).toBeGreaterThan(0);
    expect(more).toBeLessThanOrEqual(fit.length - COMPATIBILITY_CAP);
    expect(p.compatibilityHi).toMatch(new RegExp(`और ${String(more)} अन्य$`));
    expect(fit[0]).toHaveProperty('yearFrom');
    expect(fit[0]).toHaveProperty('era');
  });
  it('knows the vehicle types of Amaron\u2019s finder', () => {
    const types = new Set(
      plan.products.flatMap((p) => ((p.spec.fitment ?? []) as { type: string }[]).map((e) => e.type)),
    );
    for (const t of ['car_suv_muv', 'lcv_hcv', 'tractor', 'earth_moving', 'two_wheeler', 'three_wheeler'])
      expect(types.has(t)).toBe(true);
  });
  it('turns the (ES) / (KS) end of a two-wheeler model into its start type', () => {
    const fit = by('Amaron Pro Bike Rider APBTZ4A').spec.fitment as { model: string; fuel: string | null }[];
    expect(fit.some((e) => e.fuel === 'kick_start')).toBe(true);
    expect(fit.some((e) => e.fuel === 'electric_start')).toBe(true);
    expect(fit.every((e) => !/\((ES|KS)\)/.test(e.model))).toBe(true);
    expect(by('Amaron Pro Bike Rider APBTZ4A').compatibilityHi).toMatch(/किक स्टार्ट|सेल्फ़ स्टार्ट/);
  });
  it('has no fitment text for a battery the finder does not list', () => {
    expect(by('Amaron Fresh FR300RMF').compatibility).toBeNull();
    expect(by('Amaron Fresh FR300RMF').spec).not.toHaveProperty('fitment');
    expect(by('Amaron Home UPS HB750A').fitmentCount).toBe(0);
  });
  it('joins the fitment on the item code and ignores a row of an unknown battery', () => {
    const extra = planAmaron({
      ...input,
      fitment: [
        ...input.fitment,
        { ...(input.fitment[0] ?? {}), 'Item code': 'AAM-XX-NOPE', Battery: 'Amaron NOPE' },
      ],
    });
    expect(extra.orphanFitment).toBe(1);
  });
});

describe('model year / era column', () => {
  it.each([
    ['From 2007', 2007, null, null],
    ['Up to 2006', null, 2006, null],
    ['2011 to 2017', 2011, 2017, null],
    ['2019 model', 2019, 2019, null],
    ['BS VI emission norm (sold from Apr 2020)', 2020, null, 'bs6'],
    ['BS IV emission norm (sold nationally Apr 2017 - Mar 2020)', 2017, 2020, 'bs4'],
    ['Newer version (name says New)', null, null, 'new'],
    ['Older version (name says Old)', null, null, 'old'],
    ['From 2018; Facelift version', 2018, null, 'facelift'],
    ['2019 model; Newer version (name says New)', 2019, 2019, 'new'],
    ['From 2024; BS VI emission norm (sold from Apr 2020)', 2024, null, 'bs6'],
    ['Up to 2022; BS VI emission norm (sold from Apr 2020)', null, 2022, 'bs6'],
    ['Newer version (name says New); Older version (name says Old)', null, null, null],
    ['Something Amaron adds later', null, null, null],
    ['', null, null, null],
  ])('%s', (raw, from, to, era) => {
    expect(parseEra(raw)).toEqual({ yearFrom: from, yearTo: to, era });
  });
  it('words "up to"', () => {
    expect(yearText({ yearFrom: null, yearTo: 2014 }, false)).toBe('up to 2014');
    expect(yearText({ yearFrom: null, yearTo: 2014 }, true)).toBe('2014 तक');
    expect(yearText({ yearFrom: 2007, yearTo: null }, true)).toBe('2007 से');
  });
  it('writes years into spec.fitment and the texts, and drops the year already held by the column from the model', () => {
    const p = by('Amaron Pro 55B24LS');
    const fit = p.spec.fitment as {
      make: string;
      model: string;
      yearFrom: number | null;
      yearTo: number | null;
    }[];
    const accord = fit.find((e) => e.model === 'Accord');
    expect(accord).toMatchObject({ make: 'HONDA', yearFrom: 2007, yearTo: null });
    expect(fit.some((e) => e.model === 'Elantra' && e.yearTo === 2016 && e.yearFrom === null)).toBe(true);
    expect(fit.every((e) => !/\((from|upto) \d{4}\)/i.test(e.model))).toBe(true);
    expect(p.compatibility).toContain('Honda Accord (Petrol, 2007 onwards)');
    expect(p.compatibility).toContain('Hyundai Elantra (Diesel, up to 2016)');
    expect(p.compatibilityHi).toContain('Honda Accord (पेट्रोल, 2007 से)');
    expect(p.compatibilityHi).toContain('Hyundai Elantra (डीज़ल, 2016 तक)');
  });
  it('writes a BS era without repeating it in the model', () => {
    const all = plan.products.flatMap(
      (p) => (p.spec.fitment ?? []) as { model: string; era: string | null; yearFrom: number | null }[],
    );
    expect(all.some((e) => e.era === 'bs6' && e.yearFrom === 2020)).toBe(true);
    expect(all.every((e) => !(e.era === 'bs6' && /\(BS ?6\)$/i.test(e.model)))).toBe(true);
  });
});

describe('combos are not products', () => {
  it('attaches each combo to the Home UPS and the inverter battery that make it', () => {
    expect(plan.combos).toEqual({ total: 6, attached: 6, unmatched: 0 });
    expect(plan.products.some((p) => /combo/i.test(p.name))).toBe(false);
    const ups = by('Amaron Home UPS HB750A').spec.combos as { withItemCode: string }[];
    expect(ups).toContainEqual({
      withItemCode: 'AAM-CR-AM130ST36',
      withName: 'Amaron Current Short Tubular AM130ST36',
      comboMrpPaise: 1971000,
      comboSellingPaise: 1708600,
      backupMinutes: 95,
      comboDiscountPaise: 262400,
      discountValid: 'Till 30th Nov',
      oldBatteryRebatePaise: 300000,
    });
    const bat = by('Amaron Current Short Tubular AM130ST36').spec.combos as {
      withItemCode: string;
      withName: string;
    }[];
    expect(bat.find((c) => c.withItemCode === 'AAM-HU-HB0000750')?.withName).toBe('Amaron Home UPS HB750A');
  });
  it('adds one highlight in both languages where a product is in combos', () => {
    expect(by('Amaron Home UPS HB750A').highlights).toContain(
      'Also sold in 2 combos with Amaron inverter batteries',
    );
    expect(by('Amaron Home UPS HB750A').highlightsHi).toContain(
      'Amaron इन्वर्टर बैटरी के साथ 2 कॉम्बो में भी उपलब्ध',
    );
    expect(
      by('Amaron Current Short Tubular AM130ST36').highlights.some((h) =>
        h.includes('combos with Amaron Home UPS'),
      ),
    ).toBe(true);
    expect(by('Amaron Pro 55B24LS').spec).not.toHaveProperty('combos');
  });
  it('counts a combo whose item code is unknown as unmatched, not as a product', () => {
    const odd = planAmaron({
      ...input,
      combos: [...input.combos, { ...(input.combos[0] ?? {}), 'Battery item code': 'AAM-XX-NOPE' }],
    });
    expect(odd.combos).toEqual({ total: 7, attached: 6, unmatched: 1 });
    expect(odd.products).toHaveLength(plan.products.length);
  });
});

const DIR = 'C:/Users/Admin/Desktop/autoparts/amaron_batteries';
// Runs only where the source files exist (the importer's own PC); CI has the fixtures above. The plan is built lazily:
// a describe body runs while collecting even when skipped, so reading the folder there would fail CI.
describe.skipIf(!existsSync(`${DIR}/amaron_batteries.csv`))('all 144 source rows', () => {
  let cached: ReturnType<typeof planAmaronDir> | undefined;
  const fullPlan = () => (cached ??= planAmaronDir(DIR));
  it('plans every row once with unique slugs and SKUs, all live; two rows listed at 0 are price on request', () => {
    const full = fullPlan();
    expect(full.products).toHaveLength(144);
    expect(new Set(full.products.map((p) => p.slug)).size).toBe(144);
    expect(new Set(full.products.map((p) => p.variant.sku)).size).toBe(144);
    expect(full.slugCollisions + full.skuCollisions).toBe(0);
    expect(full.products.every((p) => p.status === 'live')).toBe(true);
    const onRequest = full.products.filter((p) => p.variant.mrpPaise === null);
    expect(onRequest.map((p) => p.name)).toEqual([
      'Amaron Current Tall Tubular AR150TT54',
      'Amaron Current Tall Tubular AR230TT54',
    ]);
    expect(onRequest.every((p) => !('amaronPrice' in p.spec))).toBe(true);
    expect(full.rows.filter((r) => r.mrpRupees === '')).toHaveLength(2);
    expect(full.orphanFitment).toBe(0);
  });
  it('counts per category', () => {
    const count = new Map<string, number>();
    for (const p of fullPlan().products) count.set(p.category.slug, (count.get(p.category.slug) ?? 0) + 1);
    expect(Object.fromEntries(count)).toEqual({
      'car-suv-batteries': 56,
      'cv-batteries': 21,
      'tractor-batteries': 14,
      'earth-moving-batteries': 5,
      'two-wheeler-batteries': 10,
      'three-wheeler-batteries': 10,
      'home-power': 28,
    });
  });
  it('turns every two-wheeler (ES) / (KS) into a start type, even before a "(BS6)"', () => {
    const bikes = fullPlan().products.flatMap((p) =>
      ((p.spec.fitment ?? []) as { type: string; model: string; fuel: string | null }[]).filter(
        (e) => e.type === 'two_wheeler',
      ),
    );
    expect(bikes.length).toBeGreaterThan(400);
    expect(bikes.filter((e) => /\((ES|KS)\)/.test(e.model))).toEqual([]);
    expect(bikes.some((e) => e.model.startsWith('Meteor 350') && e.fuel === 'electric_start')).toBe(true);
  });
  it('attaches all 195 combos and sorts the 11 unlisted batteries', () => {
    const full = fullPlan();
    expect(full.combos).toEqual({ total: 195, attached: 195, unmatched: 0 });
    expect(
      full.products.reduce((n, p) => n + ((p.spec.combos as unknown[] | undefined)?.length ?? 0), 0),
    ).toBe(390);
    expect(full.notInFinder).toHaveLength(11);
  });
  it('passes the Hindi check everywhere and has the 3 photos in order wherever the source has them', () => {
    const full = fullPlan();
    expect(amaronHindiLeftovers(full)).toEqual([]);
    expect(full.untranslated).toEqual([]);
    const triple = full.products.filter((p) => p.photos.length === 3);
    expect(triple.length).toBeGreaterThanOrEqual(120);
    for (const p of triple) {
      const order = p.photos.map((x) => /- (\w+)\.jpg$/.exec(x.file)?.[1]);
      expect(order[0]).toBe('Front');
      expect(order[2]).toBe('Top');
    }
  });
});
