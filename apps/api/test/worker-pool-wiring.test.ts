import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Live 2026-11-28 15:46 IST: a stuck `assignments` sweep made `boundedShared` swap the SHARED pool. The live relay
 * (and other long-lived parts built once with `db` at start-up) kept the old, ended pool and logged
 * `live_relay_failed: CONNECTION_ENDED` every second (1,189 times in 20 min) until the worker was restarted.
 * Rule: the shared pool is never replaced; only the bounded sweeps' own pool is recycled.
 */
const worker = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');

describe('worker pool wiring', () => {
  it('never reassigns the shared pool that long-lived parts hold', () => {
    expect(worker).toMatch(/const \{ db, sql \} = createDb\(/);
    expect(worker).not.toMatch(/\(\{ db, sql \} =/);
  });

  it('bounded sweeps run on their own recyclable pool and receive it as an argument', () => {
    expect(worker).toMatch(/const sweepPool = recyclingPool\(/);
    const calls = worker.match(/boundedShared\('[a-z_]+', \(([a-z]+)\) =>/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(9);
    expect(worker).not.toMatch(/boundedShared\('[a-z_]+', \(\) =>/);
  });
});
