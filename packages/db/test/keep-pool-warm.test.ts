import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepPoolWarm } from '../src/client';

afterEach(() => {
  vi.useRealTimers();
});

describe('keepPoolWarm', () => {
  it('opens the connections at once, pings again every interval, and stops on request', () => {
    vi.useFakeTimers();
    const ping = vi.fn(() => Promise.resolve());
    const stop = keepPoolWarm(ping, { connections: 2, everyMs: 15_000 });
    expect(ping).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(15_000);
    expect(ping).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(ping).toHaveBeenCalledTimes(4);
  });

  it('survives a failing ping (database briefly away) and keeps the schedule', async () => {
    vi.useFakeTimers();
    const ping = vi.fn(() => Promise.reject(new Error('down')));
    const stop = keepPoolWarm(ping, { connections: 1, everyMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(ping).toHaveBeenCalledTimes(4);
    stop();
  });
});
