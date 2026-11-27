/**
 * Watch for a worker sweep (DC-B11): one run at a time, a heartbeat with the last due count every `heartbeatEvery`
 * runs, and one `sweep_stuck` warning when a run has not finished after `stuckAfterMs`. Without it a sweep that sees
 * nothing due and a sweep that never finishes both look like silence in the log.
 */
export function sweepWatch(
  sweep: string,
  opts: {
    heartbeatEvery: number;
    stuckAfterMs: number;
    log: (message: 'sweep_heartbeat' | 'sweep_stuck', data: Record<string, unknown>) => void;
  },
) {
  let startedAt: number | null = null;
  let warned = false;
  let runs = 0;
  return {
    /** True when a run may start now; false while one is in flight (warns once if it is stuck). */
    begin(now: number): boolean {
      if (startedAt !== null) {
        if (!warned && now - startedAt >= opts.stuckAfterMs) {
          warned = true;
          opts.log('sweep_stuck', { sweep, inFlightMs: now - startedAt });
        }
        return false;
      }
      startedAt = now;
      return true;
    },
    end(now: number, result: { due: number }): void {
      const lastMs = startedAt === null ? 0 : now - startedAt;
      startedAt = null;
      warned = false;
      runs += 1;
      if (runs % opts.heartbeatEvery === 0)
        opts.log('sweep_heartbeat', { sweep, runs, lastDue: result.due, lastMs });
    },
  };
}
