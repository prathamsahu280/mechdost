/**
 * Buyer GSTIN at checkout (design 2026-11-13): one optional `business` object, checked the same way in the
 * browser, the API and the database; state names for the GSTIN state note in both languages.
 */
import { describe, expect, it } from 'vitest';
import { BusinessPurchaseSchema } from '../src/business';
import { GST_STATE_CODES, gstinStateCode, normaliseGstin } from '../src/gst';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';

describe('business purchase', () => {
  it('normalises what people type: spaces, lower case', () => {
    expect(normaliseGstin(' 22abvcs4888h1zl ')).toBe('22ABVCS4888H1ZL');
    expect(normaliseGstin('22 ABVCS 4888 H1ZL')).toBe('22ABVCS4888H1ZL');
  });

  it('accepts a valid GSTIN and name (normalised), refuses a bad checksum, a short name or extra keys', () => {
    expect(BusinessPurchaseSchema.parse({ gstin: '22abvcs4888h1zl', businessName: ' Sahu Motors ' })).toEqual(
      {
        gstin: '22ABVCS4888H1ZL',
        businessName: 'Sahu Motors',
      },
    );
    expect(
      BusinessPurchaseSchema.safeParse({ gstin: '22ABVCS4888H1ZM', businessName: 'Sahu Motors' }).success,
    ).toBe(false);
    expect(BusinessPurchaseSchema.safeParse({ gstin: '22ABVCS4888H1ZL', businessName: 'S' }).success).toBe(
      false,
    );
    expect(
      BusinessPurchaseSchema.safeParse({ gstin: '22ABVCS4888H1ZL', businessName: 'Sahu Motors', pan: 'x' })
        .success,
    ).toBe(false);
  });

  it('every GST state code has a name in English and in Hindi', () => {
    const enStates = (en as { gstStates: Record<string, string> }).gstStates;
    const hiStates = (hi as { gstStates: Record<string, string> }).gstStates;
    expect(GST_STATE_CODES).toContain(gstinStateCode('22ABVCS4888H1ZL'));
    expect(GST_STATE_CODES).toHaveLength(39);
    for (const code of GST_STATE_CODES) {
      expect(enStates[code], code).toMatch(/\p{L}/u);
      expect(hiStates[code], code).toMatch(/[ऀ-ॿ]/);
    }
    expect(enStates['22']).toBe('Chhattisgarh');
    expect(hiStates['27']).toBe('महाराष्ट्र');
  });
});
