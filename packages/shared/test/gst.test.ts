import { describe, expect, it } from 'vitest';
import { gstinCheckChar, gstinStateCode, isGstEnrolmentNumber, isGstin } from '../src/gst';

describe('GSTIN (research/compare-gstin-onboarding.md §2)', () => {
  it('accepts real GSTINs: pattern, state code and the mod-36 check character', () => {
    expect(isGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isGstin('22ABVCS4888H1ZL')).toBe(true); // MechDost's own (decisions)
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(gstinStateCode('22ABVCS4888H1ZL')).toBe('22');
  });

  it('refuses a wrong check character, an unknown state code, lower case and bad shapes', () => {
    expect(isGstin('27AAPFU0939F1ZW')).toBe(false);
    expect(isGstin('00AAPFU0939F1ZV')).toBe(false);
    expect(isGstin('39AAPFU0939F1ZV')).toBe(false);
    expect(isGstin('27aapfu0939f1zv')).toBe(false);
    expect(isGstin('27AAPFU0939F1V')).toBe(false);
    expect(isGstin('')).toBe(false);
  });

  it('enrolment numbers (Notification 34/2023-CT) are 12 characters starting with the state code', () => {
    expect(isGstEnrolmentNumber('221234567890')).toBe(true);
    expect(isGstEnrolmentNumber('22AB12CD34EF')).toBe(true);
    expect(isGstEnrolmentNumber('22123456789')).toBe(false);
    expect(isGstEnrolmentNumber('22-123456789')).toBe(false);
    expect(isGstEnrolmentNumber('22ABVCS4888H1ZL')).toBe(false);
  });
});
