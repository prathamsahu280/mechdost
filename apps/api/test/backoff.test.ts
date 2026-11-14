import { describe, expect, it } from 'vitest';
import { FailureBackoff } from '../src/backoff';

/** Worker sweeps back off items that keep failing (quote expiry, review 2026-11-14) instead of retrying each tick. */
describe('FailureBackoff', () => {
  it('skips a failing item for a doubling delay, capped, and forgets it after a success', () => {
    const b = new FailureBackoff({ baseMs: 60_000, maxMs: 3_600_000 });
    const t0 = 1_000_000;
    expect(b.skipped(t0)).toEqual(new Set());
    expect(b.fail('q1', t0)).toBe(60_000);
    expect(b.skipped(t0 + 59_999)).toEqual(new Set(['q1']));
    expect(b.skipped(t0 + 60_000)).toEqual(new Set());
    expect(b.fail('q1', t0 + 60_000)).toBe(120_000);
    expect(b.fail('q1', t0)).toBe(240_000);
    for (let i = 0; i < 10; i++) b.fail('q1', t0);
    expect(b.fail('q1', t0)).toBe(3_600_000);
    b.succeed('q1');
    expect(b.skipped(t0)).toEqual(new Set());
    expect(b.fail('q1', t0)).toBe(60_000);
  });

  it('keeps a bounded number of entries', () => {
    const b = new FailureBackoff({ baseMs: 1, maxMs: 10, maxEntries: 2 });
    b.fail('a', 0);
    b.fail('b', 0);
    b.fail('c', 0);
    expect(b.size).toBe(2);
  });
});
