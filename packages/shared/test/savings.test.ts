/**
 * "Your savings" money maths (personalisation phase 4, design 2026-11-25; decision 2026-11-26). Honest basis: the
 * maker's printed MRP snapshot minus the price paid per line, plus the coupon, the redeemed Coins and the waived
 * delivery fee, each its own component in integer paise; lines without an MRP are excluded and counted; refunds
 * reverse the savings in proportion, telescoping so repeated partial refunds never reverse more than was saved.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  lineMrpSaving,
  savingsBreakdown,
  savingsPeriodBounds,
  savingsReversal,
  type SavingsBreakdown,
} from '../src/savings';

const line = (itemId: string, qty: number, unitPaise: number, mrpPaise: number | null) => ({
  itemId,
  qty,
  unitPaise,
  mrpPaise,
});

describe('lineMrpSaving', () => {
  it('is (MRP - price) x qty', () => {
    expect(lineMrpSaving(line('a', 2, 4_500_00, 5_000_00))).toBe(1_000_00);
  });
  it('is null (excluded) without a printed MRP or with an MRP of 0', () => {
    expect(lineMrpSaving(line('a', 1, 100, null))).toBeNull();
    expect(lineMrpSaving(line('a', 1, 100, 0))).toBeNull();
  });
  it('never goes below zero when the price is above the MRP', () => {
    expect(lineMrpSaving(line('a', 3, 6_000, 5_000))).toBe(0);
  });
});

describe('savingsBreakdown', () => {
  it('keeps every component apart and counts excluded lines', () => {
    const b = savingsBreakdown({
      lines: [line('a', 1, 9_000, 10_000), line('b', 2, 500, null), line('c', 1, 2_000, 2_500)],
      couponPaise: 300,
      coinsPaise: 200,
      deliveryWaivedPaise: 4_000,
    });
    expect(b).toEqual({
      mrpPaise: 1_500,
      couponPaise: 300,
      coinsPaise: 200,
      deliveryPaise: 4_000,
      totalPaise: 6_000,
      countedLines: 2,
      excludedLines: 1,
      lines: [
        { itemId: 'a', mrpSavingPaise: 1_000 },
        { itemId: 'c', mrpSavingPaise: 500 },
      ],
    });
  });

  it('refuses non-integer or negative money', () => {
    expect(() =>
      savingsBreakdown({ lines: [], couponPaise: 1.5, coinsPaise: 0, deliveryWaivedPaise: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      savingsBreakdown({ lines: [], couponPaise: 0, coinsPaise: -1, deliveryWaivedPaise: 0 }),
    ).toThrow(RangeError);
  });
});

const breakdownArb = fc
  .record({
    lines: fc.array(
      fc.record({
        qty: fc.integer({ min: 1, max: 99 }),
        unitPaise: fc.integer({ min: 0, max: 50_000_00 }),
        mrpPaise: fc.option(fc.integer({ min: 0, max: 60_000_00 }), { nil: null }),
      }),
      { minLength: 0, maxLength: 6 },
    ),
    couponPaise: fc.integer({ min: 0, max: 5_000_00 }),
    coinsPaise: fc.integer({ min: 0, max: 5_000_00 }),
    deliveryWaivedPaise: fc.integer({ min: 0, max: 200_00 }),
  })
  .map((r) => ({
    ...r,
    lines: r.lines.map((l, i) => ({ ...l, itemId: `i${String(i)}` })),
  }));

function sumReversals(original: SavingsBreakdown, refunds: readonly number[], totalPaise: number) {
  let prior = 0;
  const acc = { mrpPaise: 0, couponPaise: 0, coinsPaise: 0, deliveryPaise: 0, totalPaise: 0 };
  const perLine = new Map<string, number>();
  for (const r of refunds) {
    const rev = savingsReversal(original, {
      priorRefundedPaise: prior,
      refundPaise: r,
      orderTotalPaise: totalPaise,
    });
    prior += r;
    acc.mrpPaise += rev.mrpPaise;
    acc.couponPaise += rev.couponPaise;
    acc.coinsPaise += rev.coinsPaise;
    acc.deliveryPaise += rev.deliveryPaise;
    acc.totalPaise += rev.totalPaise;
    for (const l of rev.lines) perLine.set(l.itemId, (perLine.get(l.itemId) ?? 0) + l.mrpSavingPaise);
  }
  return { acc, perLine };
}

describe('savingsReversal (refunds)', () => {
  it('reverses everything on a full refund', () => {
    const b = savingsBreakdown({
      lines: [line('a', 1, 9_000, 10_000)],
      couponPaise: 300,
      coinsPaise: 200,
      deliveryWaivedPaise: 0,
    });
    const rev = savingsReversal(b, { priorRefundedPaise: 0, refundPaise: 8_500, orderTotalPaise: 8_500 });
    expect(rev).toMatchObject({ mrpPaise: -1_000, couponPaise: -300, coinsPaise: -200, totalPaise: -1_500 });
    expect(rev.lines).toEqual([{ itemId: 'a', mrpSavingPaise: -1_000 }]);
  });

  it('reverses half on a half refund (floored, telescoping)', () => {
    const b = savingsBreakdown({
      lines: [line('a', 1, 9_000, 10_001)],
      couponPaise: 0,
      coinsPaise: 0,
      deliveryWaivedPaise: 0,
    });
    const first = savingsReversal(b, { priorRefundedPaise: 0, refundPaise: 4_500, orderTotalPaise: 9_000 });
    const second = savingsReversal(b, {
      priorRefundedPaise: 4_500,
      refundPaise: 4_500,
      orderTotalPaise: 9_000,
    });
    expect(first.mrpPaise).toBe(-500);
    expect(second.mrpPaise).toBe(-501);
  });

  it('caps at the order total: refunding more than was paid reverses no more than was saved', () => {
    const b = savingsBreakdown({
      lines: [line('a', 1, 1, 2)],
      couponPaise: 0,
      coinsPaise: 0,
      deliveryWaivedPaise: 0,
    });
    const rev = savingsReversal(b, { priorRefundedPaise: 0, refundPaise: 999, orderTotalPaise: 1 });
    expect(rev.mrpPaise).toBe(-1);
    expect(
      savingsReversal(b, { priorRefundedPaise: 999, refundPaise: 5, orderTotalPaise: 1 }).totalPaise,
    ).toBe(0);
  });

  it('an order paid nothing (total 0) reverses in full on any refund', () => {
    const b = savingsBreakdown({ lines: [], couponPaise: 100, coinsPaise: 0, deliveryWaivedPaise: 0 });
    expect(
      savingsReversal(b, { priorRefundedPaise: 0, refundPaise: 1, orderTotalPaise: 0 }).couponPaise,
    ).toBe(-100);
  });

  it('property: any sequence of partial refunds never reverses more than was saved, per component and per line', () => {
    fc.assert(
      fc.property(
        breakdownArb,
        fc.integer({ min: 0, max: 100_000_00 }),
        fc.array(fc.integer({ min: 1, max: 20_000_00 }), { minLength: 1, maxLength: 8 }),
        (input, totalPaise, refunds) => {
          const b = savingsBreakdown(input);
          const { acc, perLine } = sumReversals(b, refunds, totalPaise);
          for (const k of ['mrpPaise', 'couponPaise', 'coinsPaise', 'deliveryPaise', 'totalPaise'] as const) {
            expect(Number.isInteger(acc[k])).toBe(true);
            expect(acc[k]).toBeLessThanOrEqual(0);
            expect(b[k] + acc[k]).toBeGreaterThanOrEqual(0);
          }
          for (const l of b.lines)
            expect(l.mrpSavingPaise + (perLine.get(l.itemId) ?? 0)).toBeGreaterThanOrEqual(0);
          expect(acc.mrpPaise).toBe([...perLine.values()].reduce((a, v) => a + v, 0));
          expect(acc.totalPaise).toBe(acc.mrpPaise + acc.couponPaise + acc.coinsPaise + acc.deliveryPaise);
        },
      ),
    );
  });

  it('property: refunds adding up to the order total reverse exactly everything, in any split', () => {
    fc.assert(
      fc.property(
        breakdownArb,
        fc.integer({ min: 1, max: 100_000_00 }),
        fc.array(fc.integer({ min: 1, max: 1_000 }), { minLength: 1, maxLength: 6 }),
        (input, totalPaise, weights) => {
          const b = savingsBreakdown(input);
          const w = weights.reduce((a, v) => a + v, 0);
          const parts = weights.map((v) => Math.floor((totalPaise * v) / w));
          parts[parts.length - 1] = (parts.at(-1) ?? 0) + totalPaise - parts.reduce((a, v) => a + v, 0);
          const { acc } = sumReversals(
            b,
            parts.filter((p) => p > 0),
            totalPaise,
          );
          expect(b.totalPaise + acc.totalPaise).toBe(0);
          expect(b.mrpPaise + acc.mrpPaise).toBe(0);
        },
      ),
    );
  });

  it('refuses a negative or fractional refund', () => {
    const b = savingsBreakdown({ lines: [], couponPaise: 0, coinsPaise: 0, deliveryWaivedPaise: 0 });
    expect(() => savingsReversal(b, { priorRefundedPaise: 0, refundPaise: -1, orderTotalPaise: 1 })).toThrow(
      RangeError,
    );
    expect(() => savingsReversal(b, { priorRefundedPaise: 0.5, refundPaise: 1, orderTotalPaise: 1 })).toThrow(
      RangeError,
    );
  });
});

describe('savingsPeriodBounds (IST)', () => {
  it('month: from the IST first of the month to the IST first of the next', () => {
    // 2026-11-30 20:00 UTC is already 1 Dec 01:30 IST.
    const b = savingsPeriodBounds('month', new Date('2026-11-30T20:00:00Z'));
    expect(b.from.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(b.to.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(b.label).toBe('2026-12');
  });
  it('year: from IST 1 January to the next IST 1 January', () => {
    const b = savingsPeriodBounds('year', new Date('2026-06-15T00:00:00Z'));
    expect(b.from.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    expect(b.to.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(b.label).toBe('2026');
  });
});
