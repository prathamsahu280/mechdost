import { describe, expect, it } from 'vitest';
import { isPseudonymousId, maskPersonalDataKeepIds, scrubFreeText } from '../src/privacy';

describe('pseudonymous ids survive masking (review 2026-11-14)', () => {
  it('recognises UUIDs and public codes only as whole values', () => {
    expect(isPseudonymousId('01a1db2d-e45a-7f47-8659-9433601cf99d')).toBe(true);
    expect(isPseudonymousId('MD-RPR-2026-234567')).toBe(true);
    expect(isPseudonymousId('9876543210')).toBe(false);
    expect(isPseudonymousId('x 01a1db2d-e45a-7f47-8659-9433601cf99d')).toBe(false);
  });

  it('keeps every embedded id (more than 26 too) and still masks phone numbers', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `MD-RPR-2026-${String(100000 + i)}`);
    expect(maskPersonalDataKeepIds(`${ids.join(' ')} call 9876543210`)).toBe(`${ids.join(' ')} call #`);
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
