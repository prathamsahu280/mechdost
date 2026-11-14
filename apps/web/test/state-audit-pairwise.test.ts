import { describe, expect, it } from 'vitest';
import { cross, extendPairs, missingPairs, pairwise, type Param } from '../e2e/state-audit/pairwise.ts';

const P = (name: string, ...values: (string | number)[]): Param => ({ name, values });

describe('pairwise', () => {
  it('covers every value pair of every two parameters', () => {
    const params = [
      P('width', 320, 390, 480, 768, 1024, 1280, 1440, 1920),
      P('theme', 'light', 'dark'),
      P('locale', 'en', 'hi'),
      P('auth', 'out', 'customer'),
      P('world', 'empty', 'cart', 'busy'),
      P('stress', 'none', 'long-text', 'long-price'),
    ];
    const rows = pairwise(params);
    expect(missingPairs(params, rows)).toEqual([]);
    // The two largest parameters bound the size from below (8 × 3 = 24); greedy stays close to it.
    expect(rows.length).toBeGreaterThanOrEqual(24);
    expect(rows.length).toBeLessThanOrEqual(30);
    // Far fewer than the full cross.
    expect(rows.length).toBeLessThan(cross(params).length / 10);
  });

  it('is deterministic: same input, same rows in the same order', () => {
    const params = [P('a', 1, 2, 3), P('b', 'x', 'y'), P('c', 'p', 'q', 'r', 's')];
    expect(pairwise(params)).toEqual(pairwise(params));
  });

  it('never emits a row the constraint forbids and covers every allowed pair', () => {
    const params = [P('route', '/', '/account'), P('auth', 'out', 'customer'), P('theme', 'light', 'dark')];
    const valid = (r: Record<string, unknown>) => !(r.route === '/account' && r.auth === 'out');
    const rows = pairwise(params, { valid });
    expect(rows.every(valid)).toBe(true);
    expect(missingPairs(params, rows, valid)).toEqual([]);
  });

  it('starts with the seed rows', () => {
    const params = [P('a', 1, 2), P('b', 'x', 'y'), P('c', 'p', 'q')];
    const rows = pairwise(params, { seeds: [{ a: 2, b: 'y', c: 'q' }] });
    expect(rows[0]).toEqual({ a: 2, b: 'y', c: 'q' });
    expect(missingPairs(params, rows)).toEqual([]);
  });

  it('handles a single parameter and rejects bad parameters', () => {
    expect(pairwise([P('a', 1, 2, 3)])).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(() => pairwise([P('a')])).toThrow(/no values/);
    expect(() => pairwise([P('a', 1, 1)])).toThrow(/repeats/);
    expect(() => pairwise([P('a', 1), P('a', 2)])).toThrow(/twice/);
  });
});

describe('cross and extendPairs', () => {
  it('cross is the full cartesian product minus forbidden rows', () => {
    const rows = cross([P('a', 1, 2), P('b', 'x', 'y', 'z')], (r) => !(r.a === 2 && r.b === 'z'));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ a: 1, b: 'x' });
  });

  it('keeps the crossed rows and pairs every extra parameter with every crossed value', () => {
    const crossed = [P('width', 320, 1440), P('compare', 'none', 'other'), P('cart', 'none', 'mixed')];
    const extra = [
      P('theme', 'light', 'dark'),
      P('locale', 'en', 'hi'),
      P('stress', 'none', 'long', 'price'),
    ];
    const fixed = cross(crossed);
    const rows = extendPairs(fixed, extra);
    // Every crossed combination is present exactly as crossed, first and in order.
    rows.slice(0, fixed.length).forEach((r, i) => {
      expect({ width: r.width, compare: r.compare, cart: r.cart }).toEqual(fixed[i]);
    });
    expect(missingPairs([...crossed, ...extra], rows)).toEqual([]);
  });
});
