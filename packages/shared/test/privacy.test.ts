import { describe, expect, it } from 'vitest';
import { isPseudonymousId, maskPersonalDataKeepIds, scrubFreeText } from '../src/privacy';

describe('pseudonymous ids survive masking (reviews 2026-11-14)', () => {
  it('recognises only ids we issue, exactly: UUIDs with version/variant, codes with our prefixes', () => {
    expect(isPseudonymousId('01a1db2d-e45a-7f47-8659-9433601cf99d')).toBe(true);
    expect(isPseudonymousId('019a8f00-0000-7000-8000-000000000001')).toBe(true);
    for (const code of [
      'MD-RPR-2026-7K3Q9X',
      'SR-RPR-2026-23456K',
      'REQ-RPR-2027-000Z01',
      'QT-RPR-2026-A00000',
    ])
      expect([code, isPseudonymousId(code)]).toEqual([code, true]);
    for (const not of [
      '9876543210',
      'x 01a1db2d-e45a-7f47-8659-9433601cf99d',
      '01A1DB2D-E45A-7F47-8659-9433601CF99D', // we emit lowercase
      '01a1db2d-e45a-0f47-8659-9433601cf99d', // version 0
      '01a1db2d-e45a-7f47-c659-9433601cf99d', // variant c
      '98765432-1098-7654-8210-987654321098', // digits only: a phone hides in it
      'MD-RPR-2026-234567', // all-digit tail: could carry a phone, masked (decision 2026-11-14)
      'MD-RPR-2026-9876543210',
      'MD-RPR-9876-543210',
      'XX-RPR-2026-7K3Q9X', // not a prefix we issue
      'md-rpr-2026-7k3q9x', // codes are upper case
      'MD-RPR-1999-7K3Q9X',
    ])
      expect([not, isPseudonymousId(not)]).toEqual([not, false]);
  });

  it('keeps every embedded id (more than 26 too) and still masks phone numbers', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `MD-RPR-2026-${String(10000 + i)}K`);
    expect(maskPersonalDataKeepIds(`${ids.join(' ')} call 9876543210`)).toBe(`${ids.join(' ')} call #`);
  });

  it('a phone number dressed up as a code is still masked', () => {
    expect(maskPersonalDataKeepIds('MD-RPR-2026-9876543210')).toBe('MD-RPR-#');
    expect(maskPersonalDataKeepIds('ref MD-RPR-9876-543210')).toBe('ref MD-RPR-#');
    expect(maskPersonalDataKeepIds('MD-RPR-2026-234567')).toBe('MD-RPR-#');
  });
});

describe('scrubFreeText', () => {
  it('removes phone numbers and emails but keeps part numbers and sizes', () => {
    expect(scrubFreeText('call 98765 43210 for battery')).toBe('call # for battery');
    expect(scrubFreeText('+91-9876543210')).toBe('#');
    expect(scrubFreeText('ravi.sahu@example.com oil')).toBe('# oil');
    expect(scrubFreeText('XLTZ4A')).toBe('XLTZ4A');
    expect(scrubFreeText('185/65 R15 tyre')).toBe('185/65 R15 tyre');
    expect(scrubFreeText('order 2026 activa')).toBe('order 2026 activa');
    expect(scrubFreeText('बैटरी ९८७६५ ४३२१०')).toBe('बैटरी #');
    expect(scrubFreeText('98.76.54.32.10')).toBe('#');
    expect(scrubFreeText('(0771) 234-5678 shop')).toBe('(# shop');
    expect(scrubFreeText('９８７６５４３２１０')).toBe('#'); // full-width digits
    expect(scrubFreeText('२०२६ मॉडल')).toBe('२०२६ मॉडल');
    expect(scrubFreeText('98765\u200b43210')).toBe('#'); // zero-width space
    expect(scrubFreeText('98765\u200c43210')).toBe('#'); // zero-width non-joiner
    expect(scrubFreeText('98,765,432,10')).toBe('#');
    expect(scrubFreeText('98_76_54_32_10')).toBe('#');
    expect(scrubFreeText('9 8 7 6 5 4 3 2 1 0')).toBe('#');
    expect(scrubFreeText('98765      43210')).toBe('#'); // long gaps
    expect(scrubFreeText('98 -- // .. 765 -- 43210')).toBe('#');
    expect(scrubFreeText(`  ${'x'.repeat(200)}  `)).toHaveLength(80);
  });
});
