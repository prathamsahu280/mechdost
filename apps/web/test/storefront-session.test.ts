/**
 * Shared-device safety of the saved cart and the wishlist (security review 2026-11-15, two MEDIUM findings): what one
 * customer's browser holds must never reach the next customer who signs in on the same device. Sign-out clears the
 * browser cart and every bit of sync state; a cart adopted for one account is never merged into another; the wishlist
 * cache is tied to the account and a response that arrives after sign-out or for another account is discarded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wishlist } from '@mechdost/shared/wishlist-api';

interface Call {
  path: string;
  init?: { method?: string; body?: unknown };
}
const calls: Call[] = [];
let respond: (
  call: Call,
) => Promise<{ ok: true; data: unknown } | { ok: false; status: number; code: string }>;
vi.mock('../src/lib/orders-api', () => ({
  authed: (_locale: string, path: string, _schema: unknown, init?: Call['init']) => {
    const call = init === undefined ? { path } : { path, init };
    calls.push(call);
    return respond(call);
  },
}));
let uid: string | null = 'uid-a';
vi.mock('../src/lib/auth/firebase-client', () => ({
  currentUid: () => Promise.resolve(uid),
  currentIdToken: () => Promise.resolve(uid ? `token-${uid}` : null),
}));

function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return data;
}

const line = (sku: string, qty = 1) => ({ sku, qty });
const serverCart = (...lines: { sku: string; qty: number }[]) => ({
  lines: lines.map((l) => ({ ...l, slug: l.sku.toLowerCase(), name: l.sku, brand: 'B' })),
  dropped: [],
});

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  uid = 'uid-a';
  fakeWindow();
});

describe('cart sync on a shared device', () => {
  async function load() {
    const store = await import('../src/demo/store');
    const sync = await import('../src/lib/cart-sync');
    return { store, sync };
  }

  it('sign-out clears the browser cart and forgets who it belonged to', async () => {
    const { store, sync } = await load();
    store.addToCart('oil', 1, 'OIL-1');
    respond = () => Promise.resolve({ ok: true, data: serverCart(line('OIL-1', 2)) });
    await sync.mergeAtSignIn('en');
    expect(store.cartNow().map((l) => l.sku)).toEqual(['OIL-1']);
    await sync.resetCartSync();
    expect(store.cartNow()).toEqual([]);
    // fresh state: the next signed-in visit reads the server cart first, not a stale "known" copy
    calls.length = 0;
    respond = () => Promise.resolve({ ok: true, data: serverCart() });
    sync.syncCart('en');
    await vi.waitFor(() => {
      expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.path}`)).toEqual(['GET /me/cart?locale=en']);
    });
  });

  it('A signs out, B signs in: A’s lines are not merged into B’s cart', async () => {
    const { store, sync } = await load();
    store.addToCart('oil', 1, 'OIL-1');
    respond = () => Promise.resolve({ ok: true, data: serverCart(line('OIL-1', 2)) });
    await sync.mergeAtSignIn('en'); // adopted for uid-a
    // Even if the sign-out hook never ran (closed tab, crash), the cart is A's and must not travel to B.
    uid = 'uid-b';
    calls.length = 0;
    respond = () => Promise.resolve({ ok: true, data: serverCart(line('BELT-9')) });
    await sync.mergeAtSignIn('en');
    const merge = calls.find((c) => c.path.startsWith('/me/cart/merge'));
    expect(merge?.init?.body).toEqual({ lines: [] });
    expect(store.cartNow().map((l) => l.sku)).toEqual(['BELT-9']);
  });

  it('with the sign-out hook A’s cart is gone before B signs in', async () => {
    const { store, sync } = await load();
    store.addToCart('oil', 1, 'OIL-1');
    respond = () => Promise.resolve({ ok: true, data: serverCart(line('OIL-1')) });
    await sync.mergeAtSignIn('en');
    await sync.resetCartSync();
    uid = 'uid-b';
    calls.length = 0;
    respond = () => Promise.resolve({ ok: true, data: serverCart() });
    await sync.mergeAtSignIn('en');
    expect(calls.find((c) => c.path.startsWith('/me/cart/merge'))?.init?.body).toEqual({ lines: [] });
  });

  it('a genuine guest cart still merges at sign-in', async () => {
    const { store, sync } = await load();
    store.addToCart('oil', 3, 'OIL-1');
    respond = () => Promise.resolve({ ok: true, data: serverCart(line('OIL-1', 3), line('BELT-9')) });
    await sync.mergeAtSignIn('en');
    expect(calls.find((c) => c.path.startsWith('/me/cart/merge'))?.init?.body).toEqual({
      lines: [line('OIL-1', 3)],
    });
    expect(store.cartNow().map((l) => l.sku)).toEqual(['OIL-1', 'BELT-9']);
  });

  it('the same customer signing in again keeps merging their own cart', async () => {
    const { store, sync } = await load();
    store.addToCart('oil', 1, 'OIL-1');
    respond = () => Promise.resolve({ ok: true, data: serverCart(line('OIL-1')) });
    await sync.mergeAtSignIn('en');
    calls.length = 0;
    await sync.mergeAtSignIn('en');
    expect(calls.find((c) => c.path.startsWith('/me/cart/merge'))?.init?.body).toEqual({
      lines: [line('OIL-1')],
    });
  });

  it('an answer that arrives after sign-out is not adopted', async () => {
    const { store, sync } = await load();
    store.addToCart('oil', 1, 'OIL-1');
    let release: () => void = () => undefined;
    respond = () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, data: serverCart(line('OIL-1'), line('SECRET-A')) });
        };
      });
    const pending = sync.mergeAtSignIn('en');
    await vi.waitFor(() => {
      expect(calls.length).toBe(1);
    });
    await sync.resetCartSync();
    release();
    await pending;
    expect(store.cartNow()).toEqual([]);
  });

  it('sign-out clears the cart and runs the resets in the sign-out path (real mode)', async () => {
    const src = (await import('node:fs')).readFileSync(
      new URL('../src/lib/auth/sign-out.ts', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/resetCartSync/);
    expect(src).toMatch(/resetWishlist/);
    expect(src).toMatch(/clearCart/);
  });
});

describe('wishlist cache on a shared device', () => {
  const list = (...slugs: string[]): Wishlist => ({
    max: 100,
    items: slugs.map((slug) => ({
      slug,
      name: slug,
      brand: 'B',
      photo: null,
      addedAt: '2026-11-15T09:00:00.000Z',
    })),
  });
  const state = async () => (await import('../src/lib/wishlist-store')).__stateForTest();

  it('a different account resets what the hearts know', async () => {
    const store = await import('../src/lib/wishlist-store');
    respond = () => Promise.resolve({ ok: true, data: list('a-only') });
    await store.ensureWishlist('en');
    expect([...(await state()).slugs]).toEqual(['a-only']);
    uid = 'uid-b';
    respond = () => Promise.resolve({ ok: true, data: list('b-only') });
    await store.ensureWishlist('en');
    expect([...(await state()).slugs]).toEqual(['b-only']);
  });

  it('sign-out empties the cache', async () => {
    const store = await import('../src/lib/wishlist-store');
    respond = () => Promise.resolve({ ok: true, data: list('a-only') });
    await store.ensureWishlist('en');
    store.resetWishlist();
    expect(await state()).toMatchObject({ ready: false });
    expect([...(await state()).slugs]).toEqual([]);
  });

  it('an answer that arrives after sign-out is ignored', async () => {
    const store = await import('../src/lib/wishlist-store');
    let release: () => void = () => undefined;
    respond = () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, data: list('a-only') });
        };
      });
    const pending = store.ensureWishlist('en');
    await vi.waitFor(() => {
      expect(calls.length).toBe(1);
    });
    store.resetWishlist();
    release();
    await pending;
    expect([...(await state()).slugs]).toEqual([]);
    expect(await state()).toMatchObject({ ready: false });
  });

  it('a failed change that comes back after sign-out does not bring the old list back', async () => {
    const store = await import('../src/lib/wishlist-store');
    respond = () => Promise.resolve({ ok: true, data: list('a-only') });
    await store.ensureWishlist('en');
    let release: () => void = () => undefined;
    respond = () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: false, status: 500, code: 'HTTP_500' });
        };
      });
    const change = store.setWishlisted('en', 'a-only', false);
    await vi.waitFor(() => {
      expect(calls.length).toBe(2);
    });
    store.resetWishlist();
    release();
    await change;
    expect([...(await state()).slugs]).toEqual([]);
  });
});
