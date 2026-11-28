import { PhaseTimeoutError, withDeadline } from './notify/deadline';

/**
 * Worker sweeps that must keep running (DC-B11). Live 2026-11-28 the delivery offer sweep waited ~4 h on a database
 * connection that had died: no query on the server, no waiting lock, and postgres.js has no client-side query
 * timeout, so the run never settled and its in-flight guard blocked every later run (no offer expired).
 *
 * `runBounded` gives a run a deadline; on timeout it calls `onTimeout` (recycle the pool) and rejects with
 * `PhaseTimeoutError`. The late result of the abandoned run is ignored, so the work must be safe to repeat (the
 * offer sweep is: one conditional transaction per offer).
 */
export async function runBounded<T>(
  ms: number,
  phase: string,
  work: () => Promise<T>,
  onTimeout: () => Promise<void> | void,
): Promise<T> {
  try {
    return await withDeadline(ms, phase, work);
  } catch (err) {
    if (err instanceof PhaseTimeoutError) await onTimeout();
    throw err;
  }
}

export interface PoolHandle<D> {
  db: D;
  close: () => Promise<void>;
}

/**
 * A pool that can be swapped for a fresh one: a hung connection cannot be cancelled from the client, so the sweep
 * drops the whole (small) pool and opens a new one. Closing the old pool may fail or hang; it never blocks the swap.
 */
export function recyclingPool<D>(open: () => PoolHandle<D>) {
  let current = open();
  return {
    get db(): D {
      return current.db;
    },
    async recycle(): Promise<void> {
      const old = current;
      current = open();
      await old.close().catch(() => undefined);
    },
    close: (): Promise<void> => current.close(),
  };
}
