/**
 * Report 2026-11-25 (staff sign-in): "We couldn't finish the security check" appeared while Cloudflare's widget was
 * still "Verifying…" (the 20 s give-up fired on a slow but working widget). A working widget is now waited for up to
 * a hard cap, a calm "still checking" signal goes out after 8 s, and only a real widget error fails at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEl {
  isConnected: boolean;
  scrollIntoView: () => void;
}
interface Rendered {
  callback: (token: string) => void;
  error: () => void;
  expired: () => void;
}

let rendered: Rendered[];
let executes: number;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-key');
  rendered = [];
  executes = 0;
  const el: FakeEl = { isConnected: true, scrollIntoView: () => undefined };
  vi.stubGlobal('window', {
    turnstile: {
      render: (
        _el: FakeEl,
        opts: Rendered & { 'error-callback': () => void; 'expired-callback': () => void },
      ) => {
        rendered.push({
          callback: opts.callback,
          error: opts['error-callback'],
          expired: opts['expired-callback'],
        });
        return `w${String(rendered.length)}`;
      },
      execute: () => {
        executes += 1;
      },
      reset: () => undefined,
      remove: () => undefined,
    },
  });
  vi.stubGlobal('document', { getElementById: () => el });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('a slow but working Cloudflare check', () => {
  it('is still waited for at 20 s, says "still checking" after 8 s, and gives the token when it comes', async () => {
    const m = await import('../src/lib/auth/turnstile');
    const slow: boolean[] = [];
    let token: string | null = null;
    let failed: unknown = null;
    void m
      .turnstileToken('login-turnstile', 'en', undefined, (on) => slow.push(on))
      .then((t) => (token = t))
      .catch((e: unknown) => (failed = e));
    await vi.advanceTimersByTimeAsync(7_900);
    expect(slow).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(slow).toEqual([true]);
    await vi.advanceTimersByTimeAsync(30_000); // 38 s: the old code had given up at 20 s
    expect(failed).toBeNull();
    expect(token).toBeNull();
    rendered[0]?.callback('late-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(token).toBe('late-token');
    expect(slow.at(-1)).toBe(false);
  });

  it('fails only at the hard cap (60 s), without a retry of its own', async () => {
    const m = await import('../src/lib/auth/turnstile');
    let failed: Error | null = null;
    void m.turnstileToken('login-turnstile', 'en').catch((e: unknown) => (failed = e as Error));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((failed as Error | null)?.message).toBe('turnstile timed out');
    expect(executes).toBe(1);
  });

  it('a real widget error fails at once and is retried once with a clean widget', async () => {
    const m = await import('../src/lib/auth/turnstile');
    let token: string | null = null;
    void m.turnstileToken('login-turnstile', 'en').then((t) => (token = t));
    await vi.advanceTimersByTimeAsync(100);
    rendered[0]?.error();
    await vi.advanceTimersByTimeAsync(0);
    expect(executes).toBe(2); // the silent retry
    rendered[0]?.callback('second-try');
    await vi.advanceTimersByTimeAsync(0);
    expect(token).toBe('second-try');
  });

  it('"still checking" counts from the press, not from the check started while typing', async () => {
    const m = await import('../src/lib/auth/turnstile');
    const slow: boolean[] = [];
    m.prefetchTurnstileToken('login-turnstile', 'en');
    await vi.advanceTimersByTimeAsync(20_000); // typing for 20 s: the form says nothing
    expect(slow).toEqual([]);
    void m.turnstileToken('login-turnstile', 'en', undefined, (on) => slow.push(on)).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(slow).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(slow).toEqual([true]);
  });

  it('an expired token before it was used fails the check at once', async () => {
    const m = await import('../src/lib/auth/turnstile');
    let failed: unknown = null;
    void m.turnstileToken('login-turnstile', 'en').catch((e: unknown) => (failed = e));
    await vi.advanceTimersByTimeAsync(100);
    rendered[0]?.expired();
    await vi.advanceTimersByTimeAsync(0);
    rendered[0]?.expired();
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).not.toBeNull();
  });
});
