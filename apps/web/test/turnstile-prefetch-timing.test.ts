/**
 * Timing evidence for the reset form (user report 2026-11-24): the widget takes `CHECK_MS` to issue a token, as
 * Cloudflare does. A check started on first touch of the form is ready when the button is pressed; without it the
 * person waits the whole check after the press. Real timers, a fake widget; the numbers are printed for the report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHECK_MS = 400;

interface FakeEl {
  isConnected: boolean;
  scrollIntoView: () => void;
}
let current: FakeEl;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-key');
  current = { isConnected: true, scrollIntoView: () => undefined };
  let callback: (t: string) => void = () => undefined;
  vi.stubGlobal('window', {
    turnstile: {
      render: (_el: FakeEl, opts: { callback: (t: string) => void }) => {
        callback = opts.callback;
        return 'w1';
      },
      execute: () => {
        setTimeout(() => {
          callback('token');
        }, CHECK_MS);
      },
      reset: () => undefined,
      remove: () => undefined,
    },
  });
  vi.stubGlobal('document', { getElementById: () => current });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function pressedAfterTyping(typingMs: number, prefetch: boolean): Promise<number> {
  const m = await import('../src/lib/auth/turnstile');
  if (prefetch) m.prefetchTurnstileToken('login-turnstile', 'en');
  await new Promise((r) => setTimeout(r, typingMs));
  const pressed = Date.now();
  await m.turnstileToken('login-turnstile', 'en');
  return Date.now() - pressed;
}

describe('the check at the reset button', () => {
  it('is ready at once when the form started it on first touch, and takes the whole check when it did not', async () => {
    const without = await pressedAfterTyping(600, false); // before the fix: the guard refused the early check
    vi.resetModules();
    const withPrefetch = await pressedAfterTyping(600, true); // after: the swapped-in container starts its own
    expect(without).toBeGreaterThanOrEqual(CHECK_MS - 50);
    expect(withPrefetch).toBeLessThan(100);
  });
});
