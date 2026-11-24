import { describe, expect, it } from 'vitest';
import { createPhotoByteCache } from '../src/photos/byte-cache';

const buf = (n: number) => Buffer.alloc(n, 1);

describe('photo byte cache', () => {
  it('returns what was stored and counts hits and misses', () => {
    const c = createPhotoByteCache(1000);
    expect(c.get('a', 640)).toBeNull();
    c.set('a', 640, buf(100));
    expect(c.get('a', 640)?.length).toBe(100);
    expect(c.get('a', 320)).toBeNull();
    expect(c.stats()).toMatchObject({ entries: 1, bytes: 100, hits: 1, misses: 2 });
  });

  it('never holds more than its byte budget and drops the least recently used first', () => {
    const c = createPhotoByteCache(1000);
    for (const id of ['a', 'b', 'c', 'd']) c.set(id, 1, buf(240));
    expect(c.stats().bytes).toBeLessThanOrEqual(1000);
    c.get('a', 1); // a is now the most recent
    c.set('e', 1, buf(240)); // 5 x 240 > 1000: the least recent (b) goes
    expect(c.get('a', 1)).not.toBeNull();
    expect(c.get('b', 1)).toBeNull();
    for (let i = 0; i < 50; i += 1) c.set(`x${String(i)}`, 1, buf(200));
    expect(c.stats().bytes).toBeLessThanOrEqual(1000);
  });

  it('skips a single picture over a quarter of the budget, and does nothing when off', () => {
    const c = createPhotoByteCache(1000);
    c.set('big', 1, buf(251));
    expect(c.get('big', 1)).toBeNull();
    const off = createPhotoByteCache(0);
    off.set('a', 1, buf(10));
    expect(off.get('a', 1)).toBeNull();
  });

  it('evicts every width of one photo and replaces an entry without double counting', () => {
    const c = createPhotoByteCache(10_000);
    c.set('a', 320, buf(10));
    c.set('a', 640, buf(20));
    c.set('ab', 640, buf(30));
    c.set('a', 640, buf(25));
    expect(c.stats().bytes).toBe(65);
    c.evict('a');
    expect(c.get('a', 320)).toBeNull();
    expect(c.get('a', 640)).toBeNull();
    expect(c.get('ab', 640)).not.toBeNull();
    expect(c.stats().bytes).toBe(30);
  });
});
