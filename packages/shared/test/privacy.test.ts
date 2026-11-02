import { describe, expect, it } from 'vitest';
import { scrubFreeText } from '../src/privacy';

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
    expect(scrubFreeText(`  ${'x'.repeat(200)}  `)).toHaveLength(80);
  });
});
