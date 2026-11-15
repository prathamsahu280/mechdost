import { describe, expect, it } from 'vitest';
import { financialYear, formatInvoiceNumber, isValidGstInvoiceNumber, splitCreditNote } from '../src/invoice';

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

describe('splitCreditNote', () => {
  const invoice = { taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0 }; // ₹1,180
  it('splits a part credit proportionally with CGST = SGST and adds up to the credit', () => {
    const p = splitCreditNote(invoice, invoice, 59_000);
    expect(p).toEqual({ taxablePaise: 50_000, cgstPaise: 4_500, sgstPaise: 4_500, igstPaise: 0 });
  });
  it('keeps CGST = SGST even when the paise are odd, and the parts add up to the total', () => {
    for (const total of [1, 7, 333, 1_001, 117_999]) {
      const p = splitCreditNote(invoice, invoice, total);
      expect(p).not.toBeNull();
      if (!p) continue;
      expect(p.taxablePaise + p.cgstPaise + p.sgstPaise + p.igstPaise).toBe(total);
      expect(p.cgstPaise).toBe(p.sgstPaise);
    }
  });
  it('the credit that uses up the invoice takes the exact remainder of every component', () => {
    const first = splitCreditNote(invoice, invoice, 333);
    expect(first).not.toBeNull();
    const left = {
      taxablePaise: invoice.taxablePaise - (first?.taxablePaise ?? 0),
      cgstPaise: invoice.cgstPaise - (first?.cgstPaise ?? 0),
      sgstPaise: invoice.sgstPaise - (first?.sgstPaise ?? 0),
      igstPaise: 0,
    };
    const last = splitCreditNote(invoice, left, 118_000 - 333);
    expect(last).toEqual(left);
  });
  it('an inter-state invoice credits IGST only; a credit above what is left is refused', () => {
    const igst = { taxablePaise: 100_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000 };
    expect(splitCreditNote(igst, igst, 59_000)).toEqual({
      taxablePaise: 50_000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 9_000,
    });
    expect(splitCreditNote(invoice, invoice, 118_001)).toBeNull();
    expect(splitCreditNote(invoice, invoice, 0)).toBeNull();
  });
});
