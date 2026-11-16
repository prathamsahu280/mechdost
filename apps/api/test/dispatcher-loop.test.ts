import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@mechdost/db/repo';
import { startDispatcher, type ChannelAdapter, type DispatchResult } from '../src/notify/dispatcher';
import { setLogSink } from '../src/logger';
import { PhaseTimeoutError, withDeadline } from '../src/notify/deadline';

/** Worker incident 2026-11-16: a hung tick must not stop sending forever, and the dispatcher must show a heartbeat. */
const adapter: ChannelAdapter = { channel: 'email', send: () => Promise.resolve({ providerId: null }) };
const db = {} as unknown as Tx;
const empty: DispatchResult = { claimed: 0, sent: 0, failed: 0, retried: 0, skipped: 0 };
let lines: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  lines = [];
  setLogSink((l) => lines.push(JSON.parse(l) as Record<string, unknown>));
});
afterEach(() => {
  vi.useRealTimers();
  setLogSink((l) => process.stdout.write(`${l}\n`));
});

describe('startDispatcher', () => {
  it('replaces a hung run after the tick timeout so sending resumes', async () => {
    let calls = 0;
    const dispatch = vi.fn(() => {
      calls += 1;
      return calls === 1 ? new Promise<DispatchResult>(() => undefined) : Promise.resolve(empty);
    });
    const d = startDispatcher({ db, adapters: [adapter], dispatch, intervalMs: 1000, tickTimeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(dispatch).toHaveBeenCalledTimes(1); // still the hung run: no overlap yet
    await vi.advanceTimersByTimeAsync(2000);
    expect(dispatch.mock.calls.length).toBeGreaterThan(1);
    expect(lines.some((l) => l.message === 'notify_tick_stuck')).toBe(true);
    await d.stop();
  });

  it('logs a notify_tick heartbeat with the counts since the last line', async () => {
    const dispatch = vi
      .fn<() => Promise<DispatchResult>>()
      .mockResolvedValueOnce({ claimed: 2, sent: 2, failed: 0, retried: 0, skipped: 0 })
      .mockResolvedValue(empty);
    const d = startDispatcher({ db, adapters: [adapter], dispatch, intervalMs: 1000, heartbeatMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_500);
    const beat = lines.find((l) => l.message === 'notify_tick');
    expect(beat).toMatchObject({ channels: ['email'], claimed: 2, sent: 2 });
    await d.stop();
  });

  it('the stuck line names the phase that hung and counts from the last progress, not the run start', async () => {
    let calls = 0;
    const dispatch = vi.fn(
      (_d: Tx, _a: readonly ChannelAdapter[], o: { phase?: { current: string; since: number } }) => {
        calls += 1;
        if (calls === 1 && o.phase) {
          o.phase.current = 'loader';
          o.phase.since = Date.now();
          return new Promise<DispatchResult>(() => undefined);
        }
        return Promise.resolve(empty);
      },
    );
    const d = startDispatcher({ db, adapters: [adapter], dispatch, intervalMs: 1000, tickTimeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(7000);
    expect(lines.find((l) => l.message === 'notify_tick_stuck')).toMatchObject({ phase: 'loader' });
    expect(calls).toBeGreaterThan(1);
    await d.stop();
  });
});

describe('withDeadline', () => {
  it('rejects with the phase name when the work hangs, and passes results through otherwise', async () => {
    const hung = withDeadline(1000, 'loader', () => new Promise<string>(() => undefined));
    const assertion = expect(hung).rejects.toBeInstanceOf(PhaseTimeoutError);
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    await expect(withDeadline(1000, 'x', () => Promise.resolve(7))).resolves.toBe(7);
    await expect(withDeadline(1000, 'x', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
