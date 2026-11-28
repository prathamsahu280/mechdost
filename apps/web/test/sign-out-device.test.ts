/**
 * Device list wiring (decision 2026-11-28): the normal sign-out reads the ID token BEFORE the Firebase sign-out and
 * tells the API this device is ending (`endCurrentDevice`, best effort). It never delays the sign-out beyond a short
 * cap, and a failing or hanging token read does not stop it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
let tokenRead: () => Promise<string | null> = () => Promise.resolve('id-token-1');

vi.mock('../src/lib/auth/mode', () => ({ AUTH_MODE: 'firebase' }));
vi.mock('../src/demo/session', () => ({ signOut: () => undefined }));
vi.mock('../src/demo/store', () => ({ clearCart: () => undefined }));
vi.mock('../src/lib/cart-sync', () => ({ resetCartSync: () => undefined }));
vi.mock('../src/lib/live/live-hub', () => ({ resetLive: () => undefined }));
vi.mock('../src/lib/wishlist-store', () => ({ resetWishlist: () => undefined }));
vi.mock('../src/lib/push/forget-device', () => ({ forgetPushDevice: () => Promise.resolve() }));
vi.mock('../src/lib/auth/firebase-client', () => ({
  currentIdToken: () => tokenRead(),
  signOutReal: () => {
    order.push('firebase-signout');
    return Promise.resolve();
  },
}));
vi.mock('../src/lib/auth/end-current-device', () => ({
  endCurrentDevice: (token: string | null) => {
    order.push(`end-device:${String(token)}`);
  },
}));

beforeEach(() => {
  order.length = 0;
  tokenRead = () => Promise.resolve('id-token-1');
  vi.resetModules();
  vi.stubGlobal('document', { documentElement: { setAttribute: () => undefined, lang: 'en' } });
  vi.stubGlobal('localStorage', { length: 0, key: () => null, removeItem: () => undefined });
  vi.stubGlobal('window', {
    localStorage: { removeItem: () => undefined },
    sessionStorage: { removeItem: () => undefined },
    location: { replace: (url: string) => order.push(`replace:${url}`) },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('signOutEverywhere → endCurrentDevice', () => {
  it('reads the token and tells the API before the Firebase sign-out', async () => {
    const { signOutEverywhere } = await import('../src/lib/auth/sign-out');
    await signOutEverywhere();
    expect(order.indexOf('end-device:id-token-1')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('end-device:id-token-1')).toBeLessThan(order.indexOf('firebase-signout'));
    expect(order.at(-1)).toBe('replace:/');
  });

  it('a failing token read does not stop the sign-out', async () => {
    tokenRead = () => Promise.reject(new Error('offline'));
    const { signOutEverywhere } = await import('../src/lib/auth/sign-out');
    await signOutEverywhere();
    expect(order).toContain('firebase-signout');
    expect(order.some((e) => e.startsWith('end-device:null'))).toBe(true);
  });

  it('a hanging token read is capped: the sign-out still happens', async () => {
    vi.useFakeTimers();
    tokenRead = () => new Promise<string | null>(() => undefined);
    const { signOutEverywhere } = await import('../src/lib/auth/sign-out');
    const done = signOutEverywhere();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(order).toContain('firebase-signout');
    expect(order.some((e) => e.startsWith('end-device:null'))).toBe(true);
  });
});
