/**
 * Tata Green plan (user 2026-11-24): names as Tata Green writes them in title case, MRP next to Tata Green's offer
 * price, categories shared with Exide and Amaron, fitment with eras, warranty split, one or two photos, no placeholder
 * pictures, real Hindi. Runs on a fixture of 18 real rows (placeholder picture, missing picture, two pictures, the
 * TG/Jeevan rows the site names differently from their listing); the full 107-row check runs when the source folder is
 * on this machine (built lazily: a skipped describe body still runs while collecting).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  csvRows,
  planTataGreen,
  planTataGreenDir,
  rangeTitle,
  tataGreenHindiLeftovers,
  type TataGreenPlan,
} from '../src/tatagreen';

const fix = (name: string) =>
  csvRows(readFileSync(new URL(`./fixtures/tatagreen/${name}`, import.meta.url), 'utf8'));
const PLACEHOLDERS = [
  'pictures/Car - SUV - MUV battery/PREMIO/Tata Green PREMIO 55B24L (T1).jpg',
  'pictures/Home UPS inverter/SwitchOn/Tata Green SwitchOn TGUPS2500.jpg',
];
const input = {
  batteries: fix('tatagreen_batteries.csv'),
  fitment: fix('tatagreen_vehicle_fitment.csv'),
  placeholderPictures: PLACEHOLDERS,
};
const plan: TataGreenPlan = planTataGreen(input);
const by = (name: string) => {
  const p = plan.products.find((x) => x.name === name);
  if (!p) throw new Error(`no ${name}`);
  return p;
};
const DEVANAGARI = /[\u0900-\u097F]/;

describe('names, ranges, ids', () => {
  it('names a product as Tata Green does, in title case, codes verbatim, slug from the full name', () => {
    expect(by('Tata Green Premio 40B20L PR2436').slug).toBe('tata-green-premio-40b20l-pr2436');
    expect(by('Tata Green Premio 34B19L-M (MSIL Co-Branded)').slug).toBe(
      'tata-green-premio-34b19l-m-msil-co-branded',
    );
    expect(by('Tata Green Premio 34B19L-M (MSIL Co-Branded)').nameHi).toBe(
      'Tata Green Premio 34B19L-M (MSIL को-ब्रांडेड)',
    );
    expect(by('Tata Green SwitchOn TGUPS 48V 3.5KVA').slug).toBe('tata-green-switchon-tgups-48v-3-5kva');
    expect(by('Tata Green Sawaar-e Lithium ERLI10000 (IoT)').slug).toBe(
      'tata-green-sawaar-e-lithium-erli10000-iot',
    );
    expect(by('Tata Green Switch On INTT180048').nameHi).toBe('Tata Green स्विच ऑन INTT180048');
    // The stray "?" of the site's name is dropped.
    expect(by('Tata Green Roadstar 130F51 Commercial Vehicle Battery').slug).toBe(
      'tata-green-roadstar-130f51-commercial-vehicle-battery',
    );
  });
  it('groups the source ranges the way the names read, all under brand Tata Green', () => {
    expect(by('Tata Green TG350L').range).toMatchObject({ slug: 'tata-green-tg', name: 'Tata Green TG' });
    expect(by('Tata Green SLV600R').range.name).toBe('Tata Green SLV');
    expect(by('Tata Green Velocity Plus YTZ4').range).toMatchObject({
      slug: 'tata-green-velocity-plus',
      nameHi: 'Tata Green Velocity प्लस',
    });
    expect(rangeTitle('105E41R GENSTAR').en).toBe('Tata Green Genstar');
    expect(() => rangeTitle('Unknown range')).toThrow();
  });
  it('SKU from the name; the model, and the bare code, are manufacturer part numbers', () => {
    const p = by('Tata Green Premio 34B19L-M (MSIL Co-Branded)');
    expect(p.variant).toMatchObject({ sku: 'TATAGREEN-PREMIO-34B19L-M-MSIL-CO-BRANDED' });
    expect(p.partNumbers.map((n) => n.normalised)).toEqual(['34B19LMMSILCOBRANDED', '34B19LM']);
    // The big Home UPS rows have a Model column without the code: it is taken from the name.
    expect(by('Tata Green SwitchOn TGUPS 48V 3.5KVA').variant.model).toBe('TGUPS 48V 3.5KVA');
  });
  it('has unique slugs and SKUs', () => {
    expect(new Set(plan.products.map((p) => p.slug)).size).toBe(plan.products.length);
    expect(new Set(plan.products.map((p) => p.variant.sku)).size).toBe(plan.products.length);
    expect(plan.slugCollisions + plan.skuCollisions).toBe(0);
  });
});

describe('categories, tax, vehicle types', () => {
  it('maps to the categories Exide and Amaron use, and the existing e-rickshaw one', () => {
    const slug = (n: string) => by(n).category.slug;
    expect(slug('Tata Green Premio 40B20L PR2436')).toBe('car-suv-batteries');
    expect(slug('Tata Green Velocity Plus YTZ4')).toBe('two-wheeler-batteries');
    expect(slug('Tata Green 105E41R Genstar')).toBe('genset-batteries');
    expect(slug('Tata Green Sawaar-e Lithium ERLI10000 (IoT)')).toBe('e-rickshaw-batteries');
    expect(slug('Tata Green Switch On INTT180048')).toBe('home-power');
    expect(slug('Tata Green SwitchOn TGUPS1700')).toBe('home-power');
  });
  it('creates one new sub-category, industrial batteries, for the sealed TGI range', () => {
    expect(by('Tata Green TGI 7.2Ah 12V Industrial').category).toEqual({
      slug: 'industrial-batteries',
      parent: 'batteries',
      name: 'Industrial batteries',
      nameHi: 'औद्योगिक बैटरी',
    });
  });
  it('follows the name the site gives a vehicle battery over its listing page', () => {
    // Listed under commercial vehicle, named "Car Battery" / "Tractor Battery" / listed as tractor, named commercial.
    expect(by('Tata Green TG350L').category.slug).toBe('car-suv-batteries');
    expect(by('Tata Green Jeevan 75D31RT').category.slug).toBe('tractor-batteries');
    expect(by('Tata Green SLV600R').category.slug).toBe('cv-batteries');
    expect(by('Tata Green TG800R').category.slug).toBe('cv-batteries');
    expect(by('Tata Green Roadstar 130F51 Commercial Vehicle Battery').category.slug).toBe('cv-batteries');
    expect(plan.reclassified.map((r) => r.slug)).toEqual(
      expect.arrayContaining(['tata-green-tg350l', 'tata-green-jeevan-75d31rt', 'tata-green-slv600r']),
    );
    expect(by('Tata Green TG350L').spec.categoryRule).toMatch(/Car Battery/);
    expect(by('Tata Green Premio 40B20L PR2436').spec).not.toHaveProperty('categoryRule');
  });
  it('HSN 8507 for batteries and 8504 for Home UPS inverters, GST 18 %', () => {
    expect(by('Tata Green Premio 40B20L PR2436')).toMatchObject({ hsn: '8507', gstRateBp: 1800 });
    expect(by('Tata Green SwitchOn TGUPS1700')).toMatchObject({ hsn: '8504', gstRateBp: 1800 });
  });
  it('vehicle types only for 2W and cars', () => {
    expect(by('Tata Green Premio 40B20L PR2436').vehicleTypes).toEqual(['4W']);
    expect(by('Tata Green Velocity Plus YTZ4').vehicleTypes).toEqual(['2W']);
    expect(by('Tata Green Jeevan 75D31RT').vehicleTypes).toEqual([]);
  });
});

describe('price: MRP for the shop, Tata Green\u2019s offer price in the spec', () => {
  it('MRP is the crossed-out price, in paise; the offer price and discount sit in spec.tataGreenPrice', () => {
    const p = by('Tata Green Premio 40B20L PR2436');
    expect(p.variant.mrpPaise).toBe(482200);
    expect(p.spec.tataGreenPrice).toEqual({
      offerPaise: 409900,
      discountBp: 1500,
      gstIncluded: true,
      gstRateBp: 1800,
    });
    expect(plan.rows.every((r) => r.mrpRupees !== '')).toBe(true);
  });
});

describe('spec, summary, Hindi', () => {
  it('writes typed specs and no empty values', () => {
    const p = by('Tata Green Velocity Plus YTZ4');
    expect(p.spec).toMatchObject({
      source: 'tatagreen',
      model: 'YTZ4',
      voltageV: 12,
      capacityAh: 3,
      lengthMm: 113,
      widthMm: 70,
      heightMm: 85,
      warrantyTotalMonths: 54,
      warrantyFreeMonths: 24,
      warrantyProRataMonths: 30,
    });
    for (const q of plan.products)
      expect(Object.values(q.spec).every((v) => v !== '' && v !== undefined)).toBe(true);
  });
  it('does not trust the filled-in 12 V of UPS units and the lithium e-rickshaw battery', () => {
    expect(by('Tata Green SwitchOn TGUPS 48V 3.5KVA').spec).toMatchObject({ voltageV: 48, ratingVa: 3500 });
    expect(by('Tata Green SwitchOn TGUPS1700').spec).not.toHaveProperty('voltageV');
    expect(by('Tata Green Sawaar-e Lithium ERLI10000 (IoT)').spec).not.toHaveProperty('voltageV');
    expect(by('Tata Green Sawaar-e Lithium ERLI10000 (IoT)').warranty).toBeNull();
  });
  it('splits the warranty (free replacement + pro-rata) and words it in Hindi like Exide and Amaron', () => {
    const p = by('Tata Green Premio 40B20L PR2436');
    expect(p.highlights[0]).toBe(
      'Total warranty: 60 months (24 months free replacement + 36 months pro-rata)',
    );
    expect(p.highlightsHi[0]).toBe('कुल वारंटी: 60 महीने (24 महीने फ़्री रिप्लेसमेंट + 36 महीने आनुपातिक)');
    expect(p.warranty).toBe('60 months');
    // "24 Months Free Replacement" alone: pro-rata 0; "36 Months Warranty" alone: no split.
    expect(by('Tata Green TGI 7.2Ah 12V Industrial').spec).toMatchObject({
      warrantyFreeMonths: 12,
      warrantyProRataMonths: 0,
    });
  });
  it('a one-line summary, aligned highlights and a Hindi twin', () => {
    const p = by('Tata Green Velocity Plus YTZ4');
    expect(p.specSummary).toBe('3 Ah · 54 months warranty · 113 × 70 × 85 mm');
    expect(p.specSummaryHi).toBe('क्षमता 3 Ah · वारंटी 54 महीने · 113 × 70 × 85 मिमी');
    expect(p.highlights.length).toBeLessThanOrEqual(8);
    expect(p.highlightsHi).toHaveLength(p.highlights.length);
    expect(p.descriptionHi).toMatch(DEVANAGARI);
  });
  it('has no Latin words left in any Hindi text, and no feature line to translate', () => {
    expect(tataGreenHindiLeftovers(plan)).toEqual([]);
    expect(plan.untranslated).toEqual([]);
  });
});

describe('fitment', () => {
  it('keeps the vehicles of the finder, with eras, and leaves out the product-itself rows', () => {
    const p = by('Tata Green Velocity Plus YTZ4');
    const fit = p.spec.fitment as { type: string; make: string; model: string; era: string | null }[];
    expect(fit.length).toBe(p.fitmentCount);
    expect(fit.every((f) => f.type === 'two_wheeler')).toBe(true);
    expect(fit.find((f) => f.model === 'CD DELUX(NEW)')?.era).toBe('new');
    expect(p.compatibility).toMatch(/^Hero Motocorp CD Delux/);
    expect(p.compatibilityHi).toContain('(नया मॉडल)');
    // Industrial and UPS "fitment" rows describe the product itself, not vehicles.
    expect(by('Tata Green TGI 7.2Ah 12V Industrial').spec).not.toHaveProperty('fitment');
    expect(plan.orphanFitment).toBe(0);
  });
  it('a battery the finder lists for cars, commercial vehicles and tractors keeps all three', () => {
    const types = new Set((by('Tata Green TG800R').spec.fitment as { type: string }[]).map((f) => f.type));
    expect(types).toEqual(new Set(['car_suv_muv', 'lcv_hcv', 'tractor']));
  });
});

describe('pictures', () => {
  it('plans one photo, or the two files a row lists, in order, with source URLs', () => {
    const one = by('Tata Green Premio 40B20L PR2436');
    expect(one.photos).toHaveLength(1);
    expect(one.photo?.file).toBe(
      'pictures/Car - SUV - MUV battery/PREMIO/Tata Green PREMIO 40B20L PR2436.jpg',
    );
    expect(one.photo?.sourceUrl).toMatch(/^https:\/\/www\.tatagreenbattery\.com\//);
    expect(one.spec.photoKind).toBe('range');
    const two = by('Tata Green SwitchOn TGUPS1700');
    expect(two.photos).toHaveLength(2);
    expect(two.photos[1]?.altHi).toBe('Tata Green SwitchOn TGUPS1700 (फ़ोटो 2)');
  });
  it('never imports the site\u2019s grey placeholder, and plans a product without a picture as a draft', () => {
    expect(by('Tata Green Premio 55B24L (T1)')).toMatchObject({ photos: [], photo: null, status: 'draft' });
    expect(by('Tata Green SwitchOn TGUPS2500').status).toBe('draft');
    expect(by('Tata Green Premio DIN44L').status).toBe('draft');
    expect(plan.noPhoto.map((n) => [n.slug, n.reason])).toEqual(
      expect.arrayContaining([
        ['tata-green-premio-55b24l-t1', 'placeholder'],
        ['tata-green-switchon-tgups2500', 'placeholder'],
        ['tata-green-premio-din44l', 'no_file'],
      ]),
    );
    expect(by('Tata Green Premio 40B20L PR2436').status).toBe('live');
  });
  it('leaves out a file that does not exist in the folder', () => {
    const none = planTataGreen({ ...input, pictureExists: () => false });
    expect(none.products.every((p) => p.photos.length === 0 && p.status === 'draft')).toBe(true);
  });
});

const SOURCE = process.env.TATAGREEN_DIR ?? 'C:/Users/Admin/Desktop/autoparts/tatagreen_batteries';
describe.skipIf(!existsSync(`${SOURCE}/tatagreen_batteries.csv`))('the whole source folder', () => {
  const full = existsSync(`${SOURCE}/tatagreen_batteries.csv`) ? planTataGreenDir(SOURCE) : null;
  it('plans all 107 rows with no Hindi leftovers, no collisions, every MRP', () => {
    if (!full) return;
    expect(full.products).toHaveLength(107);
    expect(tataGreenHindiLeftovers(full)).toEqual([]);
    expect(full.slugCollisions + full.skuCollisions + full.orphanFitment).toBe(0);
    expect(full.rows.every((r) => r.mrpRupees !== '')).toBe(true);
  });
  it('finds the three placeholder pictures by content and the missing one', () => {
    if (!full) return;
    expect(full.noPhoto.filter((n) => n.reason === 'placeholder')).toHaveLength(3);
    expect(full.noPhoto.filter((n) => n.reason === 'no_file').map((n) => n.slug)).toEqual([
      'tata-green-premio-din44l',
    ]);
    expect(full.products.filter((p) => p.status === 'draft')).toHaveLength(4);
  });
});
