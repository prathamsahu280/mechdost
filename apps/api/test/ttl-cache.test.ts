import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/ttl-cache';

describe('TtlCache', () => {
  it('serves a value until it expires, then misses', () => {
    let now = 1_000;
    const cache = new TtlCache<number>(100, 10, () => now);
    expect(cache.set('a', 1)).toBe(1);
    now += 99;
    expect(cache.get('a')).toBe(1);
    now += 1;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry beyond the size cap', () => {
    const cache = new TtlCache<number>(1_000, 2, () => 0);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect([cache.get('b'), cache.get('c')]).toEqual([2, 3]);
  });
});
