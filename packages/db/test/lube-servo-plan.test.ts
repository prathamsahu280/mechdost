/**
 * IOCL Servo plan (user 2026-11-25): only automotive products (automotive oils and greases) that have a picture; every
 * other product is left out and listed with its reason, not even as a draft. IndiaMART seller prices are asking prices,
 * not MRPs, so no MRP; pack sizes only from listings with confidence High; seller photos are flagged; brand `servo`.
 */
import { describe, expect, it } from 'vitest';
import { planHindiLeftovers, type CsvRow } from '../src/battery-import';
import { planServo } from '../src/lube-import';

const row = (r: Record<string, string>): CsvRow => r;
const pic = (
  name: string,
  note = 'IndiaMART photo, posted by the seller Acme Lubes, Raipur. The label shows Servo bottle.',
) => ({
  'Picture file': `pictures/IndiaMART/${name}.jpg`,
  'Picture note': note,
  'Picture URL': `https://img.test/${name}.jpg`,
  'Picture listing': `https://indiamart.test/${name}`,
});
const products = [
  row({
    Product: 'SERVO PREMIUM CF-4 15W-40',
    Brand: 'IndianOil SERVO',
    Range: 'Automotive lubricating oils',
    Category: 'Diesel Engine Oils',
    'Grade (SAE / viscosity)': '15W-40',
    'Specifications met': '* API CF4 / SG * MB 228.1',
    'Manufacturer approvals': 'Approved by: * VOLVO, Sweden',
    'Seller price (IndiaMART)': '5 sellers:\n₹ 140/Litre · 210 L · Acme',
    'Data sheet URL': 'https://iocl.test/premium.pdf',
    'Product page': 'https://iocl.test/auto',
    ...pic('SERVO PREMIUM CF-4 15W-40'),
  }),
  row({
    Product: 'SERVO 4T',
    Range: 'Automotive lubricating oils',
    Category: '4 - Stroke Engine Oils',
    'Grade (SAE / viscosity)': '20W-40',
    'Specifications met': 'o JASO T903 : API SG / JASO MA 2',
    ...pic('SERVO 4T'),
  }),
  row({
    Product: 'SERVO 4T ZOOM',
    Range: 'Automotive lubricating oils',
    Category: '4 - Stroke Engine Oils',
    'Grade (SAE / viscosity)': '20W-40',
    ...pic(
      'SERVO 4T ZOOM',
      'IndiaMART photo, posted by the seller Kodandaram Lubes, Rayagada. The label shows Servo 4T Zoom SAE 10W-30 bottle.',
    ),
  }),
  row({
    Product: 'SERVO SUPER MG 5W-30/10W-30/10W-40/20W-40/20W-50',
    Range: 'Automotive lubricating oils',
    Category: 'Passenger Car Motor Oils',
    'Grade (SAE / viscosity)': '5W-30, 10W-30, 10W-40, 20W-40, 20W-50',
    ...pic(
      'SERVO SUPER MG 5W-30-10W-30-10W-40-20W-40-20W-50',
      'IndiaMART photo, posted by the seller Prerana, Nagpur. The label shows Servo Super 20W-40 MG can.',
    ),
  }),
  row({
    Product: 'SERVO GEAR SUPER 85W-140',
    Range: 'Automotive lubricating oils',
    Category: 'Gear Oils',
    ...pic('SERVO GEAR SUPER 85W-140'),
  }),
  row({
    Product: 'SERVO Grease MP',
    Range: 'Automotive greases',
    Category: 'Automotive Greases',
    ...pic(
      'SERVO Grease MP',
      'IndiaMART photo, posted by the seller Annapurna, Koraput. The label shows Servo Grease MP barrel.',
    ),
  }),
  row({
    Product: 'SERVO 2T SUPREME',
    Range: 'Automotive lubricating oils',
    Category: '2 - Stroke Engine Oils',
    ...pic('SERVO 2T SUPREME'),
  }),
  row({ Product: 'SERVO BOAT 4T', Range: 'Automotive lubricating oils', Category: 'Boat Engine Oil' }),
  row({ Product: 'SERVO PRIDE', Range: 'Automotive lubricating oils', Category: 'Diesel Engine Oils' }),
  row({
    Product: 'Circulating and Hydraulic Oils (Anti-wear Type)',
    Range: 'Industrial lubricating oils',
    Category: 'Industrial Lubricating Oils',
    ...pic('Circulating and Hydraulic Oils (Anti-wear Type)'),
  }),
  row({ Product: 'SERVOGEM 3', Range: 'Railroad greases', Category: 'Railroad Greases' }),
];
const plan = planServo({ products });
const by = (slug: string) => {
  const p = plan.products.find((x) => x.slug === slug);
  if (!p) throw new Error(`no product ${slug}`);
  return p;
};

describe('Servo plan', () => {
  it('imports only automotive products with a picture and lists every other one with its reason', () => {
    expect(plan.products.map((p) => p.name)).toEqual([
      'Servo Premium CF-4 15W-40',
      'Servo 4T',
      'Servo 4T Zoom',
      'Servo Super MG 20W-40',
      'Servo Gear Super 85W-140',
      'Servo Grease MP',
      'Servo 2T Supreme',
    ]);
    expect(plan.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['SERVO SUPER MG 5W-30/10W-30/10W-40/20W-40/20W-50 (5W-30)', 'grade_without_photo'],
      ['SERVO SUPER MG 5W-30/10W-30/10W-40/20W-40/20W-50 (10W-30)', 'grade_without_photo'],
      ['SERVO SUPER MG 5W-30/10W-30/10W-40/20W-40/20W-50 (10W-40)', 'grade_without_photo'],
      ['SERVO SUPER MG 5W-30/10W-30/10W-40/20W-40/20W-50 (20W-50)', 'grade_without_photo'],
      ['SERVO BOAT 4T', 'marine'],
      ['SERVO PRIDE', 'no_picture'],
      ['Circulating and Hydraulic Oils (Anti-wear Type)', 'industrial'],
      ['SERVOGEM 3', 'industrial'],
    ]);
    expect(plan.drafts).toEqual([]);
  });

  it('uses the brand servo with the maker in the spec, and the Castrol attribute shape', () => {
    const p = by('servo-premium-cf-4-15w-40');
    expect(p.category.slug).toBe('heavy-duty-oils');
    expect(p.spec).toMatchObject({
      source: 'servo',
      maker: 'IndianOil (IOCL)',
      saeGrade: '15W40',
      apiClass: 'CF4',
      grade: '15W-40',
    });
    expect(by('servo-4t').category.slug).toBe('motorcycle-oil');
    expect(by('servo-super-mg-20w-40').category.slug).toBe('car-engine-oil');
    expect(by('servo-gear-super-85w-140').category.slug).toBe('gear-oils');
    expect(by('servo-grease-mp').category.slug).toBe('greases');
    expect(p.hsn).toBe('2710');
    expect(by('servo-grease-mp').hsn).toBe('3403');
  });

  it('sets no MRP on any pack: seller asking prices are not MRPs', () => {
    for (const p of plan.products) for (const v of p.variants) expect(v.mrpPaise).toBeNull();
  });

  it('takes pack sizes only from listings with confidence High, else one Standard pack', () => {
    expect(by('servo-premium-cf-4-15w-40').variants.map((v) => v.model)).toEqual([
      '2.5 L',
      '20 L',
      '26 L',
      '210 L',
    ]);
    expect(by('servo-super-mg-20w-40').variants.map((v) => v.model)).toEqual(['20 L', '210 L']);
    expect(by('servo-4t').variants.map((v) => v.model)).toEqual(['Standard pack']);
    expect(by('servo-2t-supreme').variants.map((v) => v.model)).toEqual(['Standard pack']);
    expect(by('servo-grease-mp').variants.map((v) => [v.model, v.netQuantity])).toEqual([
      ['20 kg', { qty: 20000, unit: 'g' }],
      ['182 kg', { qty: 182000, unit: 'g' }],
    ]);
  });

  it('keeps the data sheet, picture, seller listing and approvals private-keyed in the spec', () => {
    const p = by('servo-premium-cf-4-15w-40');
    expect(p.spec.sourceDocs).toMatchObject({
      dataSheetUrl: 'https://iocl.test/premium.pdf',
      pictureListing: 'https://indiamart.test/SERVO PREMIUM CF-4 15W-40',
    });
    expect(p.spec.manufacturerApprovals).toBe('Approved by: * VOLVO, Sweden');
  });

  it('flags seller photos and a label that shows another grade than the row', () => {
    const notes = plan.checks.filter((c) => c.note.startsWith('Photo:'));
    expect(
      notes
        .filter((c) => c.slug === 'servo-4t-zoom')
        .map((c) => c.note)
        .join(' '),
    ).toMatch(/10W-30/);
    expect(notes.some((c) => c.slug === 'servo-premium-cf-4-15w-40' && c.note.includes('Acme Lubes'))).toBe(
      true,
    );
    expect(by('servo-4t-zoom').spec.photoFlags).toBeDefined();
    expect(by('servo-grease-mp').spec.photoFlags).toEqual([
      'the photo shows a drum or barrel, not a retail pack',
    ]);
  });

  it('plans the Hindi without English leftovers in the names and facts', () => {
    expect(planHindiLeftovers(plan).filter((l) => l.field === 'name_hi')).toEqual([]);
  });
});
