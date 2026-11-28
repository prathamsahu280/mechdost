import { describe, expect, it, vi } from 'vitest';
import { PhaseTimeoutError } from '../src/notify/deadline';
import { recyclingPool, runBounded } from '../src/sweep-pool';

// DC-B11 live 2026-11-28: the delivery offer sweep waited for ~4 h on a database connection that had died (no query on
// the server, no waiting lock), so the in-flight guard blocked every later run and no offer ever expired.
describe('runBounded', () => {
  it('rejects a run that never settles after the deadline and recycles the pool once', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn(() => Promise.resolve());
    const run = runBounded(1_000, 'delivery_offers', () => new Promise<never>(() => undefined), onTimeout);
    const caught = run.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await caught).toBeInstanceOf(PhaseTimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('returns the result and does not recycle when the run finishes in time', async () => {
    const onTimeout = vi.fn();
    await expect(runBounded(1_000, 'x', () => Promise.resolve(7), onTimeout)).resolves.toBe(7);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('passes an ordinary failure through without recycling', async () => {
    const onTimeout = vi.fn();
    await expect(runBounded(1_000, 'x', () => Promise.reject(new Error('boom')), onTimeout)).rejects.toThrow(
      'boom',
    );
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('recyclingPool', () => {
  it('opens a fresh pool on recycle and closes the old one', async () => {
    const closed: number[] = [];
    let n = 0;
    const pool = recyclingPool(() => {
      const id = ++n;
      return { db: { id }, close: () => Promise.resolve(void closed.push(id)) };
    });
    expect(pool.db.id).toBe(1);
    await pool.recycle();
    expect(pool.db.id).toBe(2);
    expect(closed).toEqual([1]);
    await pool.close();
    expect(closed).toEqual([1, 2]);
  });

  it('still switches to the new pool when closing the dead one fails', async () => {
    let n = 0;
    const pool = recyclingPool(() => {
      const id = ++n;
      return { db: { id }, close: () => (id === 1 ? Promise.reject(new Error('dead')) : Promise.resolve()) };
    });
    await pool.recycle();
    expect(pool.db.id).toBe(2);
  });
});
