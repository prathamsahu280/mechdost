import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  allocate,
  formatINR,
  invoiceRoundOff,
  roundHalfUpDiv,
  splitExclusiveGst,
  splitInclusiveGst,
  toPaise,
} from '../src/money';

describe('toPaise', () => {
  it('parses rupee strings without float error', () => {
    expect(toPaise('440')).toBe(44000);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise('1,250.05')).toBe(125005);
    expect(toPaise('19.99')).toBe(1999);
  });
  it('rejects more than two decimals, negatives and garbage', () => {
    expect(() => toPaise('1.234')).toThrow();
    expect(() => toPaise('abc')).toThrow();
    expect(() => toPaise('-5')).toThrow();
  });
});

describe('formatINR', () => {
  it('formats with Indian grouping and the rupee sign', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456.00');
    expect(formatINR(44000)).toBe('₹440.00');
  });
});

describe('roundHalfUpDiv', () => {
  it('rounds .5 up for non-negative integers', () => {
    expect(roundHalfUpDiv(5, 2)).toBe(3);
    expect(roundHalfUpDiv(4, 2)).toBe(2);
    expect(roundHalfUpDiv(7, 3)).toBe(2);
  });
});

describe('splitInclusiveGst', () => {
  it('splits an 18% intra-state price so CGST equals SGST and parts sum to gross', () => {
    expect(splitInclusiveGst(118000, 1800, false)).toEqual({ taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 });
  });
  it('uses IGST for inter-state supply', () => {
    expect(splitInclusiveGst(118000, 1800, true)).toEqual({ taxable: 100000, cgst: 0, sgst: 0, igst: 18000 });
  });
  it('property: parts always sum to gross, cgst === sgst, nothing negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.constantFrom(0, 500, 1200, 1800, 2800),
        fc.boolean(),
        (gross, rate, inter) => {
          const r = splitInclusiveGst(gross, rate, inter);
          expect(r.taxable + r.cgst + r.sgst + r.igst).toBe(gross);
          expect(r.cgst).toBe(r.sgst);
          for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(0);
          if (inter) expect(r.cgst).toBe(0);
          else expect(r.igst).toBe(0);
        },
      ),
    );
  });
});

describe('splitExclusiveGst', () => {
  it('adds tax on top of a taxable value', () => {
    expect(splitExclusiveGst(100000, 1800, false)).toEqual({ taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 });
    expect(splitExclusiveGst(100001, 1800, true).igst).toBe(18000);
  });
});

describe('allocate', () => {
  it('splits by ratio and hands remainder paise to the largest weights', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [700, 300])).toEqual([700, 300]);
    expect(allocate(5, [0, 0])).toEqual([3, 2]);
  });
  it('property: sum equals total and no part is negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 30 }),
        (total, weights) => {
          const parts = allocate(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          for (const p of parts) expect(p).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('invoiceRoundOff', () => {
  it('rounds an invoice total to the nearest rupee, half up', () => {
    expect(invoiceRoundOff(12349)).toEqual({ rounded: 12300, roundOff: -49 });
    expect(invoiceRoundOff(12350)).toEqual({ rounded: 12400, roundOff: 50 });
    expect(invoiceRoundOff(12300)).toEqual({ rounded: 12300, roundOff: 0 });
  });
});
