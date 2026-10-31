import { describe, expect, it } from 'vitest';
import { financialYear, formatInvoiceNumber, isValidGstInvoiceNumber } from '../src/invoice';

describe('financialYear (IST, April boundary)', () => {
  it('maps dates to the Indian FY code', () => {
    expect(financialYear(new Date('2026-04-01T00:00:00+05:30'))).toBe('2627');
    expect(financialYear(new Date('2026-03-31T23:59:00+05:30'))).toBe('2526');
    // 31 Mar 2026 20:00 UTC is already 1 Apr 01:30 IST
    expect(financialYear(new Date('2026-03-31T20:00:00Z'))).toBe('2627');
  });
});

describe('formatInvoiceNumber', () => {
  it('produces a Rule 46 compliant consecutive serial', () => {
    const n = formatInvoiceNumber('MDR', '2627', 123);
    expect(n).toBe('MDR/2627/000123');
    expect(n.length).toBeLessThanOrEqual(16);
    expect(isValidGstInvoiceNumber(n)).toBe(true);
  });
  it('refuses numbers that would exceed 16 characters or use bad characters', () => {
    expect(() => formatInvoiceNumber('MDRPRSRV', '2627', 1)).toThrow();
    expect(() => formatInvoiceNumber('MD_R', '2627', 1)).toThrow();
    expect(() => formatInvoiceNumber('MDR', '2627', 0)).toThrow();
    expect(isValidGstInvoiceNumber('mdr/2627/1')).toBe(false);
  });
});
