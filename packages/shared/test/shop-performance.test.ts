/** Shop performance (item 6): the metrics and the anonymous city median (five other shops, per metric). */
import { describe, expect, it } from 'vitest';
import {
  addCounts,
  benchmarkOf,
  emptyCounts,
  median,
  metricsOf,
  SHOP_BENCHMARK_MIN,
  type ShopCounts,
} from '../src/shop-performance';

const counts = (over: Partial<ShopCounts>): ShopCounts => ({ ...emptyCounts(), ...over });

describe('metricsOf', () => {
  it('computes rates in basis points and the median time to accept', () => {
    const m = metricsOf(
      counts({
        accepted: 7,
        declined: 2,
        expired: 1,
        givenUp: 1,
        acceptSeconds: [60, 600, 120, 300],
        due: 6,
        onTime: 5,
        ratingSum: 22,
        ratingCount: 5,
      }),
    );
    expect(m).toEqual({
      offers: 10,
      acceptanceBp: 7000,
      medianAcceptSeconds: 210,
      giveUps: 1,
      giveUpBp: 1429,
      onTimeBp: 8333,
      ratingX100: 440,
      ratingCount: 5,
    });
  });

  it('has nothing to say without data (null, not zero)', () => {
    expect(metricsOf(emptyCounts())).toEqual({
      offers: 0,
      acceptanceBp: null,
      medianAcceptSeconds: null,
      giveUps: 0,
      giveUpBp: null,
      onTimeBp: null,
      ratingX100: null,
      ratingCount: 0,
    });
  });

  it('adds counts of shops (an owner with two shops)', () => {
    const sum = addCounts(
      counts({ accepted: 1, acceptSeconds: [5] }),
      counts({ declined: 2, acceptSeconds: [9] }),
    );
    expect(sum).toMatchObject({ accepted: 1, declined: 2, acceptSeconds: [5, 9] });
  });
});

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});

describe('benchmarkOf', () => {
  const shopWith = (acceptanceBp: number | null, rating: number | null) =>
    metricsOf(
      counts({
        accepted: acceptanceBp === null || acceptanceBp === 0 ? 0 : 1,
        declined: acceptanceBp === 0 ? 1 : 0,
        ratingSum: rating ?? 0,
        ratingCount: rating === null ? 0 : 1,
      }),
    );

  it('needs five other shops with a value, per metric', () => {
    expect(SHOP_BENCHMARK_MIN).toBe(5);
    const four = [shopWith(10_000, 5), shopWith(0, 4), shopWith(10_000, 3), shopWith(10_000, 4)];
    expect(benchmarkOf(four)).toMatchObject({ acceptanceBp: null, ratingX100: null });
    const five = [...four, shopWith(10_000, 4)];
    expect(benchmarkOf(five)).toMatchObject({ acceptanceBp: 10_000, ratingX100: 400 });
  });

  it('counts a metric only from shops that have it: five shops but four reviewed hides the rating', () => {
    const shops = [
      shopWith(10_000, 5),
      shopWith(10_000, 4),
      shopWith(10_000, 3),
      shopWith(10_000, 4),
      shopWith(10_000, null),
    ];
    const b = benchmarkOf(shops);
    expect(b.acceptanceBp).toBe(10_000);
    expect(b.ratingX100).toBeNull();
  });
});
