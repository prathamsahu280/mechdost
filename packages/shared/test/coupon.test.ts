import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateLargestRemainder,
  applyCoupon,
  istLocalToDate,
  type CouponGroup,
  type CouponRule,
} from '../src/coupon';

const rule = (over: Partial<CouponRule> = {}): CouponRule => ({
  kind: 'percent',
  value: 10,
  minSubtotalPaise: 0,
  maxDiscountPaise: null,
  funder: 'mechdost',
  shopId: null,
  ...over,
});
const g = (shopId: string, lineTotals: number[], shippingPaise = 0): CouponGroup => ({
  shopId,
  lineTotals,
  shippingPaise,
});

describe('allocating a discount over lines (largest remainder)', () => {
  it('splits exactly, remainder to the biggest fraction then the earlier line', () => {
    expect(allocateLargestRemainder(100, [10_000, 10_000, 10_000])).toEqual([34, 33, 33]);
    expect(allocateLargestRemainder(0, [5, 5])).toEqual([0, 0]);
    expect(allocateLargestRemainder(7, [1, 6])).toEqual([1, 6]);
  });

  it('refuses more than the lines hold', () => {
    expect(() => allocateLargestRemainder(11, [5, 5])).toThrow(RangeError);
  });

  it('property: sums to the total, never above a line, never negative', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 20 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (weights, frac) => {
          const sum = weights.reduce((a, b) => a + b, 0);
          const total = Math.floor(sum * frac);
          const out = allocateLargestRemainder(total, weights);
          expect(out.reduce((a, b) => a + b, 0)).toBe(total);
          out.forEach((v, i) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(weights[i] ?? 0);
          });
        },
      ),
    );
  });
});

describe('coupon maths', () => {
  it('percent with a cap, on every product line (MechDost-funded)', () => {
    const r = applyCoupon(rule({ value: 10, maxDiscountPaise: 5_000 }), [
      g('a', [30_000, 20_000]),
      g('b', [100_000]),
    ]);
    if (!('discountPaise' in r)) throw new Error('expected a discount');
    expect(r.discountPaise).toBe(5_000); // 10% of 150,000 = 15,000, capped
    expect(r.productDiscountPaise).toBe(5_000);
    expect(r.perGroup.reduce((a, x) => a + x.discountPaise, 0)).toBe(5_000);
  });

  it('flat never exceeds the eligible products', () => {
    const r = applyCoupon(rule({ kind: 'flat', value: 99_999_999 }), [g('a', [1_234])]);
    expect(r).toMatchObject({ discountPaise: 1_234 });
  });

  it('shop-funded applies to that shop only; none in cart is not_for_cart', () => {
    const rs = rule({ funder: 'shop', shopId: 'b', value: 50 });
    const r = applyCoupon(rs, [g('a', [10_000]), g('b', [20_000, 20_000])]);
    expect(r).toMatchObject({ discountPaise: 20_000 });
    if (!('perGroup' in r)) throw new Error('x');
    expect(r.perGroup[0]?.discountPaise).toBe(0);
    expect(applyCoupon(rs, [g('a', [10_000])])).toEqual({ reason: 'not_for_cart' });
  });

  it('minimum order is measured on the eligible products', () => {
    const rs = rule({ funder: 'shop', shopId: 'b', minSubtotalPaise: 30_000 });
    expect(applyCoupon(rs, [g('a', [90_000]), g('b', [20_000])])).toEqual({ reason: 'min_order' });
  });

  it('free delivery takes the delivery charge, nothing off the products', () => {
    const r = applyCoupon(rule({ kind: 'free_shipping', value: 0 }), [
      g('a', [10_000], 4_900),
      g('b', [5_000], 3_000),
    ]);
    expect(r).toMatchObject({ discountPaise: 7_900, productDiscountPaise: 0, shippingDiscountPaise: 7_900 });
    expect(applyCoupon(rule({ kind: 'free_shipping', value: 0 }), [g('a', [10_000], 0)])).toEqual({
      reason: 'not_for_cart',
    });
  });

  it('property: line shares add to the group share, group shares to the total, nothing above a line', () => {
    const groupArb = fc.record({
      shopId: fc.constantFrom('a', 'b', 'c'),
      lineTotals: fc.array(fc.integer({ min: 1, max: 3_000_000 }), { minLength: 1, maxLength: 6 }),
      shippingPaise: fc.integer({ min: 0, max: 20_000 }),
    });
    fc.assert(
      fc.property(
        fc.array(groupArb, { minLength: 1, maxLength: 4 }),
        fc.constantFrom('percent' as const, 'flat' as const, 'free_shipping' as const),
        fc.integer({ min: 1, max: 100 }),
        fc.option(fc.integer({ min: 1, max: 500_000 }), { nil: null }),
        (groups, kind, value, cap) => {
          const r = applyCoupon(
            rule({ kind, value: kind === 'percent' ? value : value * 100, maxDiscountPaise: cap }),
            groups,
          );
          if (!('discountPaise' in r)) return;
          expect(r.discountPaise).toBe(r.productDiscountPaise + r.shippingDiscountPaise);
          expect(r.perGroup.reduce((a, x) => a + x.discountPaise, 0)).toBe(r.discountPaise);
          r.perGroup.forEach((pg, i) => {
            const grp = groups[i];
            expect(pg.lines.reduce((a, b) => a + b, 0)).toBe(pg.productPaise);
            expect(pg.discountPaise).toBe(pg.productPaise + pg.shippingPaise);
            pg.lines.forEach((v, j) => {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(grp?.lineTotals[j] ?? 0);
            });
            expect(pg.shippingPaise).toBeLessThanOrEqual(grp?.shippingPaise ?? 0);
          });
          if (kind === 'percent' && cap !== null) expect(r.discountPaise).toBeLessThanOrEqual(cap);
        },
      ),
    );
  });
});

describe('IST input', () => {
  it('reads a wall-clock IST value as the right instant', () => {
    expect(istLocalToDate('2026-11-20T10:30').toISOString()).toBe('2026-11-20T05:00:00.000Z');
    expect(() => istLocalToDate('20 Nov')).toThrow();
  });
});
