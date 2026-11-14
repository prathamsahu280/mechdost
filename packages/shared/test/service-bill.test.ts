import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_GST_RATES_BP,
  computeServiceBill,
  estimateLineError,
  type EstimateLine,
} from '../src/service-bill';

const line = (over: Partial<EstimateLine> = {}): EstimateLine => ({
  id: 'l1',
  description: 'Brake pads (front)',
  qty: 1,
  unitPaise: 120_000,
  gstRateBp: 1800,
  decision: 'approved',
  ...over,
});

describe('computeServiceBill (spec 06: bill = approved lines + GST + round-off)', () => {
  it('bills only approved lines', () => {
    const bill = computeServiceBill(
      [
        line({ id: 'a' }),
        line({ id: 'b', decision: 'declined', unitPaise: 999_900 }),
        line({ id: 'c', decision: 'pending', unitPaise: 50_000 }),
      ],
      { gstRegistered: true },
    );
    expect(bill.lines.map((l) => l.id)).toEqual(['a']);
    expect(bill.taxablePaise).toBe(120_000);
    expect(bill.cgstPaise).toBe(10_800);
    expect(bill.sgstPaise).toBe(10_800);
    expect(bill.totalPaise).toBe(141_600);
    expect(bill.roundOffPaise).toBe(0);
  });

  it('charges no GST when the workshop is not registered, whatever the line rate', () => {
    const bill = computeServiceBill([line({ gstRateBp: 2800 })], { gstRegistered: false });
    expect(bill.cgstPaise + bill.sgstPaise).toBe(0);
    expect(bill.lines[0]?.gstRateBp).toBe(0);
    expect(bill.totalPaise).toBe(120_000);
  });

  it('rounds the grand total to the rupee and records the round-off', () => {
    // 2 × ₹333.33 at 18% → taxable 66_666, CGST = SGST = 6_000 → 78_666 → ₹787 (+34 paise).
    const bill = computeServiceBill([line({ qty: 2, unitPaise: 33_333 })], { gstRegistered: true });
    expect(bill.taxablePaise).toBe(66_666);
    expect(bill.cgstPaise).toBe(6_000);
    expect(bill.roundOffPaise).toBe(34);
    expect(bill.totalPaise).toBe(78_700);
  });

  it('keeps the totals consistent for many random estimates (property)', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const decisions = ['approved', 'declined', 'pending'] as const;
    for (let run = 0; run < 500; run += 1) {
      const lines = Array.from({ length: 1 + rand(8) }, (_, i) =>
        line({
          id: `l${String(i)}`,
          qty: 1 + rand(9),
          unitPaise: 1 + rand(5_000_000),
          gstRateBp: ESTIMATE_GST_RATES_BP[rand(ESTIMATE_GST_RATES_BP.length)] ?? 0,
          decision: decisions[rand(3)] ?? 'approved',
        }),
      );
      const registered = rand(2) === 0;
      const bill = computeServiceBill(lines, { gstRegistered: registered });
      const approved = lines.filter((l) => l.decision === 'approved');
      expect(bill.lines).toHaveLength(approved.length);
      expect(bill.taxablePaise).toBe(approved.reduce((s, l) => s + l.qty * l.unitPaise, 0));
      expect(bill.cgstPaise).toBe(bill.sgstPaise);
      if (!registered) expect(bill.cgstPaise).toBe(0);
      expect(bill.totalPaise).toBe(bill.taxablePaise + bill.cgstPaise + bill.sgstPaise + bill.roundOffPaise);
      expect(bill.totalPaise % 100).toBe(0);
      expect(Math.abs(bill.roundOffPaise)).toBeLessThanOrEqual(50);
    }
  });
});

describe('estimateLineError', () => {
  it('accepts a sensible line', () => {
    expect(estimateLineError(line())).toBeNull();
  });
  it.each([
    [{ description: 'x' }, 'description'],
    [{ description: 'y'.repeat(121) }, 'description'],
    [{ qty: 0 }, 'qty'],
    [{ qty: 1.5 }, 'qty'],
    [{ qty: 100 }, 'qty'],
    [{ unitPaise: 0 }, 'price'],
    [{ unitPaise: 10.5 }, 'price'],
    [{ unitPaise: 10_000_001 }, 'price'],
    [{ gstRateBp: 1000 }, 'gst'],
  ] as const)('rejects %o (%s)', (over, field) => {
    expect(estimateLineError(line(over))).toBe(field);
  });
});
