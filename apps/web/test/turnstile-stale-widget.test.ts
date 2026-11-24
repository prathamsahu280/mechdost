/**
 * Bug 2026-11-24 (user): "Forgot password" → "Email me a reset link" stuck on "Sending…", then "We couldn't finish the
 * security check". Console: "[Cloudflare Turnstile] Cannot find Widget …". Cause: typing in the sign-in form starts the
 * check early (prefetch) in that form's container; opening the reset form replaces the container, the early check
 * never answers, and the reset submit waited on it. A prefetched check is only reused for the same, still-mounted
 * container; otherwise a fresh check runs in the container on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEl {
  isConnected: boolean;
  scrollIntoView: () => void;
}
interface Rendered {
  el: FakeEl;
  callback: (token: string) => void;
}

let current: FakeEl;
let rendered: Rendered[];

const el = (): FakeEl => ({ isConnected: true, scrollIntoView: () => undefined });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-key');
  rendered = [];
  current = el();
  const api = {
    render: (target: FakeEl, opts: { callback: (t: string) => void }) => {
      rendered.push({ el: target, callback: opts.callback });
      return `w${String(rendered.length)}`;
    },
    execute: () => undefined,
    reset: () => undefined,
    remove: () => undefined,
  };
  vi.stubGlobal('window', { turnstile: api });
  vi.stubGlobal('document', { getElementById: () => current });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Turnstile across forms', () => {
  it('a check started in a form that has since been replaced is not waited on', async () => {
    vi.useFakeTimers();
    const m = await import('../src/lib/auth/turnstile');
    m.prefetchTurnstileToken('login-turnstile', 'en');
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered).toHaveLength(1);

    // "Forgot password?" swaps the form: the old container leaves the page, a new one with the same id appears.
    current.isConnected = false;
    current = el();

    let token: string | null = null;
    void m.turnstileToken('login-turnstile', 'en').then((t) => (token = t));
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered).toHaveLength(2);
    expect(rendered[1]?.el).toBe(current);

    rendered[1]?.callback('fresh-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(token).toBe('fresh-token');
  });

  it('a check started in the same form is reused (no second widget)', async () => {
    vi.useFakeTimers();
    const m = await import('../src/lib/auth/turnstile');
    m.prefetchTurnstileToken('login-turnstile', 'en');
    await vi.advanceTimersByTimeAsync(0);
    let token: string | null = null;
    void m.turnstileToken('login-turnstile', 'en').then((t) => (token = t));
    rendered[0]?.callback('early-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(token).toBe('early-token');
    expect(rendered).toHaveLength(1);
  });
});
