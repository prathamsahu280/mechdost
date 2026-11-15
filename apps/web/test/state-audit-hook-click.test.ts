import { describe, expect, it } from 'vitest';
import { BOUNDED_MS, clickIfPresent } from '../e2e/state-audit/api-mode/hook-click.ts';

function fake(count: number, clickResult: 'ok' | 'timeout') {
  const calls: { timeout?: number }[] = [];
  return {
    calls,
    count: () => Promise.resolve(count),
    click: (o?: { timeout?: number }) => {
      calls.push(o ?? {});
      return clickResult === 'ok' ? Promise.resolve() : Promise.reject(new Error('Timeout'));
    },
    first() {
      return this;
    },
  };
}

describe('batch 3c-4: hook clicks are bounded (the 90 s timeouts of ADM-POLICIES / SHOPS / STAFF)', () => {
  it('a missing target is a note, never a wait (policies=none has no history, staff=error has no form)', async () => {
    const notes: string[] = [];
    const l = fake(0, 'ok');
    expect(await clickIfPresent(l, notes, 'no history entry')).toBe(false);
    expect(notes).toEqual(['no history entry']);
    expect(l.calls).toEqual([]);
  });

  it('a present target is clicked with a short timeout, not the 90 s test timeout', async () => {
    const notes: string[] = [];
    const l = fake(1, 'ok');
    expect(await clickIfPresent(l, notes, 'x')).toBe(true);
    expect(l.calls).toEqual([{ timeout: BOUNDED_MS }]);
    expect(BOUNDED_MS).toBeLessThanOrEqual(5_000);
    expect(notes).toEqual([]);
  });

  it('a click that cannot happen is a note, not a thrown timeout', async () => {
    const notes: string[] = [];
    expect(await clickIfPresent(fake(1, 'timeout'), notes, 'covered')).toBe(false);
    expect(notes).toEqual(['covered']);
  });
});
