import { describe, expect, it } from 'vitest';
import { CITY_CODES, FILE_FORMATS, isCodeWord, latinOffenders } from './hindi-allowlist';

/**
 * Codes are not English words (batch 2c, 2026-11-16): city codes, file formats and the registration-number label are
 * accepted as code patterns, never as a growing list of words; every generic English word still fails.
 */
describe('Hindi gate: codes', () => {
  it('accepts city codes shown on their own', () => {
    expect(latinOffenders('शहर RPR · कोड BSP')).toEqual([]);
    expect(CITY_CODES).toContain('RPR');
  });

  it('accepts file formats, in any letter case', () => {
    expect(latinOffenders('JPG, PNG या WebP फ़ाइल (5 MB तक)')).toEqual([]);
    expect(latinOffenders('PDF, jpeg, HEIC, gif')).toEqual([]);
    expect(FILE_FORMATS).toContain('WEBP');
  });

  it('accepts the company registration label and its number', () => {
    expect(latinOffenders('CIN: U74999CT2025PTC000000')).toEqual([]);
    expect(latinOffenders('GSTIN 22AAAAA0000A1Z5 · CIN · PIN 492001')).toEqual([]);
  });

  it('accepts a UPI id, with or without a domain dot (the example "name@bank")', () => {
    expect(latinOffenders('जैसे name@bank')).toEqual([]);
    expect(latinOffenders('ravi@okhdfcbank · ra***@okhdfc')).toEqual([]);
    expect(latinOffenders('जैसे name at bank')).toEqual(['name', 'bank']);
  });

  it('accepts identifiers written in snake_case or dotted form (column names, event codes)', () => {
    expect(latinOffenders('कॉलम: requested_price (रुपये में)')).toEqual([]);
    expect(latinOffenders('role.granted · user_role · delivery.free_over_paise.')).toEqual([]);
    // ... but not plain words, abbreviations or a sentence that merely contains a dot
    expect(latinOffenders('e.g. order')).toEqual(['order']);
    expect(latinOffenders('free_ delivery')).toEqual(['free', 'delivery']);
  });

  it('still rejects generic words, also upper-case ones', () => {
    expect(latinOffenders('FREE delivery')).toEqual(['FREE', 'delivery']);
    expect(latinOffenders('Budget used')).toEqual(['Budget', 'used']);
    expect(latinOffenders('JPGS RPRX')).toEqual(['JPGS', 'RPRX']);
  });

  it('knows a code word when it sees one', () => {
    for (const w of ['RPR', 'jpg', 'PNG', 'WebP', 'CIN']) expect(isCodeWord(w), w).toBe(true);
    for (const w of ['Audit', 'FREE', 'name', 'bank', 'order']) expect(isCodeWord(w), w).toBe(false);
  });
});
