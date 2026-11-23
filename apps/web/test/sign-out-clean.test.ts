/**
 * Bug 2026-11-23 (user): "suppose im in admin section and i sign out … that page's data still shows for a bit after
 * sign out". Sign-out now hides the page and clears the session at once, waits for the Firebase sign-out (capped), then
 * loads the home page fresh so nothing of the signed-out account stays on screen or in memory.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const events: string[] = [];
let firebaseSignOut: () => Promise<void> = () => Promise.resolve();

vi.mock('../src/lib/auth/mode', () => ({ AUTH_MODE: 'firebase' }));
vi.mock('../src/demo/session', () => ({
  signOut: () => {
    events.push('session-cleared');
  },
}));
vi.mock('../src/demo/store', () => ({
  clearCart: () => {
    events.push('cart-cleared');
  },
}));
vi.mock('../src/lib/cart-sync', () => ({ resetCartSync: () => undefined }));
vi.mock('../src/lib/live/live-hub', () => ({ resetLive: () => undefined }));
vi.mock('../src/lib/wishlist-store', () => ({ resetWishlist: () => undefined }));
let forgetPush: () => Promise<void> = () => Promise.resolve();
vi.mock('../src/lib/push/forget-device', () => ({ forgetPushDevice: () => forgetPush() }));
vi.mock('../src/lib/auth/firebase-client', () => ({ signOutReal: () => firebaseSignOut() }));

const attributes = new Map<string, string>();
beforeEach(() => {
  events.length = 0;
  forgetPush = () => Promise.resolve();
  const store = new Map<string, string>([
    ['firebase:authUser:key:[DEFAULT]', '{}'],
    ['mechdost-theme', 'dark'],
  ]);
  vi.stubGlobal('localStorage', {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
      events.push(`ls-removed:${k}`);
    },
  });
  vi.stubGlobal('indexedDB', {
    deleteDatabase: (name: string) => {
      events.push(`idb-deleted:${name}`);
      const req: { onsuccess?: () => void } = {};
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  });
  attributes.clear();
  vi.stubGlobal('document', {
    documentElement: {
      lang: 'hi',
      setAttribute: (k: string, v: string) => {
        attributes.set(k, v);
        events.push(`attr:${k}`);
      },
    },
  });
  vi.stubGlobal('window', {
    location: {
      replace: (to: string) => {
        events.push(`replace:${to}`);
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sign-out leaves nothing of the account on screen', () => {
  it('hides the page and clears the session before waiting, then loads home fresh after Firebase signs out', async () => {
    let release: () => void = () => undefined;
    firebaseSignOut = () =>
      new Promise<void>((resolve) => {
        release = () => {
          events.push('firebase-signed-out');
          resolve();
        };
      });
    const { signOutEverywhere } = await import('../src/lib/auth/sign-out');
    const done = signOutEverywhere();
    expect(events.slice(0, 2)).toEqual(['attr:data-signing-out', 'session-cleared']);
    await new Promise((r) => setTimeout(r, 0));
    expect(events.some((e) => e.startsWith('replace:'))).toBe(false);
    release();
    await done;
    expect(events.slice(-2)).toEqual(['firebase-signed-out', 'replace:/hi']);
  });

  it('a hanging push clean-up never skips the Firebase sign-out (security review 2026-11-23)', async () => {
    vi.useFakeTimers();
    forgetPush = () => new Promise<void>(() => undefined);
    firebaseSignOut = () => {
      events.push('firebase-signed-out');
      return Promise.resolve();
    };
    const { signOutEverywhere } = await import('../src/lib/auth/sign-out');
    const done = signOutEverywhere();
    await vi.advanceTimersByTimeAsync(2500);
    await done;
    expect(events.slice(-2)).toEqual(['firebase-signed-out', 'replace:/hi']);
    expect(events.some((e) => e.startsWith('idb-deleted'))).toBe(false);
  });

  it('a hanging Firebase sign-out deletes the saved Firebase session before the reload (fail closed)', async () => {
    vi.useFakeTimers();
    firebaseSignOut = () => new Promise<void>(() => undefined);
    const { signOutEverywhere } = await import('../src/lib/auth/sign-out');
    const done = signOutEverywhere();
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(events).toContain('ls-removed:firebase:authUser:key:[DEFAULT]');
    expect(events).not.toContain('ls-removed:mechdost-theme');
    expect(events).toContain('idb-deleted:firebaseLocalStorageDb');
    expect(events.at(-1)).toBe('replace:/hi');
    expect(events.indexOf('idb-deleted:firebaseLocalStorageDb')).toBeLessThan(events.indexOf('replace:/hi'));
  });

  it('the page content is hidden while signing out, and the menu hides it before loading the sign-out code', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'app', '[locale]', 'globals.css'), 'utf8');
    expect(css).toMatch(/html\[data-signing-out\] main\s*\{\s*visibility: hidden;/);
    const panel = readFileSync(
      join(__dirname, '..', 'src', 'components', 'auth', 'account-menu-panel.tsx'),
      'utf8',
    );
    const click = panel.slice(panel.indexOf('data-track="header_sign_out"'));
    expect(click.indexOf("setAttribute('data-signing-out'")).toBeGreaterThan(-1);
    expect(click.indexOf("setAttribute('data-signing-out'")).toBeLessThan(
      click.indexOf("import('@/lib/auth/sign-out')"),
    );
    expect(panel).not.toMatch(/router\.push\(prefix/);
  });
});
