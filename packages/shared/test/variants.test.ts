import { describe, expect, it } from 'vitest';
import { fitsFitment, variantLabel } from '../src/variants';

describe('variantLabel (a size, built from the variant options)', () => {
  it('joins size, load and speed, and tubeless', () => {
    expect(variantLabel({ size: '145/70 R12', loadIndex: '69', speedRating: 'T', tlTt: 'TL' })).toBe(
      '145/70 R12 69T TL',
    );
  });
  it('does not repeat what the size already says', () => {
    expect(variantLabel({ size: '145/70R12 69T TL', loadIndex: '69', speedRating: 'T', tlTt: 'TL' })).toBe(
      '145/70R12 69T TL',
    );
  });
  it('falls back to label, model, then any text value', () => {
    expect(variantLabel({ label: '1 L' })).toBe('1 L');
    expect(variantLabel({ model: 'NS40ZL' })).toBe('NS40ZL');
    expect(variantLabel({ colour: 'Red', ply: 6 })).toBe('Red 6');
  });
  it('is empty when nothing is known', () => {
    expect(variantLabel({})).toBe('');
  });
});

describe('fitsFitment (a saved vehicle against a size fitment list)', () => {
  const fit = [
    { vehicleType: 'car', make: 'Maruti Suzuki', model: 'Alto 800' },
    { vehicleType: 'motorcycle', make: 'Hero', model: 'Splendor Plus' },
  ];
  it('matches make and model ignoring case, spaces and punctuation, within the vehicle type', () => {
    expect(fitsFitment(fit, { type: '4W', make: 'maruti-suzuki', model: 'ALTO800' })).toBe(true);
    expect(fitsFitment(fit, { type: '2W', make: 'Hero', model: 'Splendor Plus' })).toBe(true);
  });
  it('does not match another type or model', () => {
    expect(fitsFitment(fit, { type: '2W', make: 'Maruti Suzuki', model: 'Alto 800' })).toBe(false);
    expect(fitsFitment(fit, { type: '4W', make: 'Maruti Suzuki', model: 'Swift' })).toBe(false);
    expect(fitsFitment([], { type: '4W', make: 'a', model: 'b' })).toBe(false);
  });
});
