import { describe, expect, it } from 'vitest';
import { CROCKFORD, isPublicCode, publicCode, randomCode } from '../src/ids';

describe('randomCode', () => {
  it('uses only Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode(8);
      expect(c).toHaveLength(8);
      for (const ch of c) expect(CROCKFORD).toContain(ch);
    }
  });
  it('is practically collision-free over 50k draws of 6 chars', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) seen.add(randomCode(6));
    expect(seen.size).toBeGreaterThan(49_990);
  }, 30_000); // 50k crypto draws: under 1 s alone, slower on a loaded machine
});

describe('publicCode', () => {
  it('builds MD-RPR-2026-XXXXXX style codes', () => {
    const c = publicCode('MD', 'RPR', new Date('2026-10-31T10:00:00Z'));
    expect(c).toMatch(/^MD-RPR-2026-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(isPublicCode(c, 'MD')).toBe(true);
    expect(isPublicCode('MD-RPR-2026-ILOU00', 'MD')).toBe(false);
  });
  it('uses the IST year at the new-year boundary', () => {
    expect(publicCode('SR', 'RPR', new Date('2026-12-31T19:00:00Z'))).toMatch(/^SR-RPR-2027-/);
  });
  it('rejects bad prefixes and city codes', () => {
    expect(() => publicCode('md', 'RPR')).toThrow();
    expect(() => publicCode('MD', 'raipur')).toThrow();
  });
});
