import { describe, expect, it } from 'vitest';
import { sweepWatch } from '../src/sweep-watch';

// DC-B11 (live retest 2026-11-27): the delivery offer sweep stayed silent while an offer was 5 minutes overdue.
// The worker could not tell "0 due" from "a run never finished". This watch makes both visible.
describe('sweepWatch', () => {
  it('reports a heartbeat with the last due count every N runs', () => {
    const logs: [string, Record<string, unknown>][] = [];
    const w = sweepWatch('delivery', {
      heartbeatEvery: 3,
      stuckAfterMs: 120_000,
      log: (m, d) => logs.push([m, d]),
    });
    for (let i = 0; i < 3; i++) {
      expect(w.begin(1_000 * i)).toBe(true);
      w.end(1_000 * i + 5, { due: i });
    }
    expect(logs).toEqual([['sweep_heartbeat', { sweep: 'delivery', runs: 3, lastDue: 2, lastMs: 5 }]]);
  });
  it('skips while a run is in flight and warns once when it is stuck', () => {
    const logs: string[] = [];
    const w = sweepWatch('delivery', {
      heartbeatEvery: 100,
      stuckAfterMs: 120_000,
      log: (m) => logs.push(m),
    });
    expect(w.begin(0)).toBe(true);
    expect(w.begin(30_000)).toBe(false);
    expect(w.begin(150_000)).toBe(false);
    expect(w.begin(180_000)).toBe(false);
    expect(logs).toEqual(['sweep_stuck']);
    w.end(200_000, { due: 0 });
    expect(w.begin(230_000)).toBe(true);
  });
});
