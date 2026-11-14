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

  it('loads a missing key once for concurrent callers (single flight) and never caches a failure', async () => {
    const cache = new TtlCache<number>(1_000, 10, () => 0);
    let calls = 0;
    let release: (v: number) => void = () => undefined;
    const loader = () => {
      calls += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };
    const first = cache.getOrLoad('k', loader);
    const second = cache.getOrLoad('k', loader);
    release(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(calls).toBe(1);
    expect(await cache.getOrLoad('k', loader)).toBe(7);
    expect(calls).toBe(1);

    const failing = () => Promise.reject(new Error('db down'));
    await expect(cache.getOrLoad('bad', failing)).rejects.toThrow('db down');
    expect(await cache.getOrLoad('bad', () => Promise.resolve(3))).toBe(3);
  });
});
