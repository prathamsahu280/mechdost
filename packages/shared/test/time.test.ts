import { describe, expect, it } from 'vitest';
import { istDateString, istYear } from '../src/time';

describe('IST helpers', () => {
  it('computes the IST calendar date across the UTC midnight gap', () => {
    expect(istDateString(new Date('2026-10-31T18:29:00Z'))).toBe('2026-10-31');
    expect(istDateString(new Date('2026-10-31T18:31:00Z'))).toBe('2026-11-01');
    expect(istYear(new Date('2026-12-31T18:31:00Z'))).toBe(2027);
  });
});
