import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnouncer } from '../src/lib/auth/announcer';

const flow = readFileSync(new URL('../src/components/auth/login-flow.tsx', import.meta.url), 'utf8');

describe('login announcer (stale alert, 2026-11-24)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const state = { polite: '', assertive: '' };
    const a = createAnnouncer({
      polite: (v) => {
        state.polite = v;
      },
      assertive: (v) => {
        state.assertive = v;
      },
    });
    return { state, a };
  }

  it('sets the message after a tick, emptying the region first so a repeat is read again', () => {
    const { state, a } = setup();
    state.assertive = 'old';
    a.announce('Enter your mobile number or email.', 'assertive');
    expect(state.assertive).toBe('');
    vi.advanceTimersByTime(100);
    expect(state.assertive).toBe('Enter your mobile number or email.');
  });

  it('clear() empties the assertive region and cancels a message still waiting', () => {
    const { state, a } = setup();
    a.announce('first', 'assertive');
    vi.advanceTimersByTime(100);
    a.clear('assertive');
    expect(state.assertive).toBe('');
    a.announce('second', 'assertive');
    a.clear('assertive');
    vi.advanceTimersByTime(500);
    expect(state.assertive).toBe('');
  });

  it('clearing one kind leaves the other alone', () => {
    const { state, a } = setup();
    a.announce('busy', 'polite');
    vi.advanceTimersByTime(100);
    a.clear('assertive');
    expect(state.polite).toBe('busy');
  });

  it('login flow clears the alert region whenever the form error is gone', () => {
    expect(flow).toMatch(/if \(!error\) \{\s*clear\('assertive'\);\s*return;\s*\}/);
  });

  it('a new submit clears the previous error before it runs', () => {
    expect(flow).toMatch(/busyRef\.current = true;\s*setError\(null\);/);
  });
});
