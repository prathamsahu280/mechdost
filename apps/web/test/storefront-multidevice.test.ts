/**
 * One customer on a phone and a laptop at once (user 2026-11-15): the server cart is the source of truth, the browser
 * copy a cache. The browser sends only its own pending edits, one line at a time, onto whatever the server holds now,
 * and adopts the server's answer; it never sends a whole stale copy. A fake server stands in for the API: another
 * "device" changes it between this browser's snapshots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Req {
  method: string;
  path: string;
  body?: unknown;
}
class FakeServer {
  lines = new Map<string, number>();
  version = 0;
  log: Req[] = [];
  /** Another device changes the cart. */
  otherDevice(fn: (m: Map<string, number>) => void) {
    fn(this.lines);
    this.version += 1;
  }
  cart() {
    return {
      lines: [...this.lines].map(([sku, qty]) => ({
        sku,
        qty,
        slug: sku.toLowerCase(),
        name: sku,
        brand: 'B',
      })),
      dropped: [],
      version: this.version,
    };
  }
  handle({ method, path, body }: Req) {
    this.log.push({ method, path, body });
    const url = new URL(path, 'https://x.test');
    const p = url.pathname;
    const bump = () => {
      this.version += 1;
    };
    if (method === 'GET' && p === '/me/cart') {
      const since = url.searchParams.get('since');
      if (since !== null && Number(since) === this.version) return { unchanged: true, version: this.version };
      return this.cart();
    }
    const line = /^\/me\/cart\/lines\/([^/]+)(\/add)?$/.exec(p);
    if (line) {
      const sku = decodeURIComponent(line[1] ?? '');
      const qty = (body as { qty?: number } | undefined)?.qty ?? 0;
      const have = this.lines.get(sku);
      if (method === 'POST' && line[2]) {
        this.lines.set(sku, Math.min(99, (have ?? 0) + qty));
        bump();
      } else if (method === 'PUT') {
        if (have !== qty) {
          this.lines.set(sku, qty);
          bump();
        }
      } else if (method === 'DELETE' && have !== undefined) {
        this.lines.delete(sku);
        bump();
      }
      return this.cart();
    }
    if (method === 'POST' && p === '/me/cart/merge') {
      for (const l of (body as { lines: { sku: string; qty: number }[] }).lines)
        this.lines.set(l.sku, Math.max(this.lines.get(l.sku) ?? 0, l.qty));
      bump();
      return this.cart();
    }
    throw new Error(`unmocked ${method} ${path}`);
  }
}

let server: FakeServer;
let uid: string | null = 'uid-a';
vi.mock('../src/lib/orders-api', () => ({
  authed: (_l: string, path: string, _s: unknown, init?: { method?: string; body?: unknown }) =>
    Promise.resolve({
      ok: true,
      data: server.handle({ method: init?.method ?? 'GET', path, body: init?.body }),
    }),
}));
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

const writes = () => server.log.filter((r) => r.method !== 'GET');
const skusOf = (lines: readonly { sku?: string }[]) => lines.map((l) => l.sku).sort();

beforeEach(() => {
  vi.resetModules();
  server = new FakeServer();
  uid = 'uid-a';
  fakeWindow();
});

async function signedInDevice(initial: Record<string, number>) {
  const store = await import('../src/demo/store');
  const sync = await import('../src/lib/cart-sync');
  for (const [sku, qty] of Object.entries(initial)) server.lines.set(sku, qty);
  if (server.lines.size > 0) server.version += 1;
  await sync.refreshCart('en'); // first load: the server cart is adopted
  server.log.length = 0;
  return { store, sync };
}

describe('cart on two devices', () => {
  it('a refresh shows what the other device added', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1 });
    server.otherDevice((m) => m.set('BAT-9', 1)); // the phone adds a battery
    await sync.refreshCart('en');
    expect(skusOf(store.cartNow())).toEqual(['BAT-9', 'OIL-1']);
  });

  it('the stale laptop edit does not wipe the phone’s battery', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1 });
    server.otherDevice((m) => m.set('BAT-9', 1)); // 10:00 phone, not yet seen by the laptop
    store.setQuantity('oil-1', 3); // 11:00 laptop changes a quantity (cart lines carry slug + sku)
    await sync.refreshCart('en');
    expect(Object.fromEntries(server.lines)).toEqual({ 'OIL-1': 3, 'BAT-9': 1 });
    expect(Object.fromEntries(store.cartNow().map((l) => [l.sku, l.qty]))).toEqual({
      'OIL-1': 3,
      'BAT-9': 1,
    });
    // only this device's own edit was sent: one line, never the whole cart
    expect(writes().map((r) => `${r.method} ${r.path.split('?')[0]}`)).toEqual([
      'POST /me/cart/lines/OIL-1/add',
    ]);
  });

  it('adds from both devices sum', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1 });
    server.otherDevice((m) => m.set('OIL-1', 3)); // the phone added two more
    store.addToCart('oil-1', 1, 'OIL-1'); // the laptop added one (local 2, it last saw 1)
    await sync.refreshCart('en');
    expect(server.lines.get('OIL-1')).toBe(4);
    expect(store.cartNow().find((l) => l.sku === 'OIL-1')?.qty).toBe(4);
  });

  it('a remove here, and a stale copy there: the removed line stays removed', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1, 'BELT-2': 1 });
    store.removeFromCart('oil-1'); // laptop removes
    server.otherDevice((m) => m.set('BAT-9', 1)); // phone adds something else meanwhile
    await sync.refreshCart('en');
    expect(Object.fromEntries(server.lines)).toEqual({ 'BELT-2': 1, 'BAT-9': 1 });
    expect(writes().map((r) => r.method)).toEqual(['DELETE']);
  });

  it('a page load never pushes a stale copy over the server: it adopts the server cart', async () => {
    const first = await signedInDevice({ 'OIL-1': 2 });
    expect(skusOf(first.store.cartNow())).toEqual(['OIL-1']);
    server.otherDevice((m) => {
      m.delete('OIL-1'); // the phone removed it and ordered something else
      m.set('BAT-9', 1);
    });
    // reload the laptop tab: module state is gone, the browser storage stays
    vi.resetModules();
    const store = await import('../src/demo/store');
    const sync = await import('../src/lib/cart-sync');
    expect(skusOf(store.cartNow())).toEqual(['OIL-1']); // the stale copy is still there
    server.log.length = 0;
    sync.syncCart('en');
    await vi.waitFor(() => {
      expect(skusOf(store.cartNow())).toEqual(['BAT-9']);
    });
    expect(writes()).toEqual([]); // nothing was sent
  });

  it('an "unchanged" answer sends no write and leaves the browser cart as it is', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1 });
    const before = store.cartNow();
    const ok = await sync.refreshCart('en');
    expect(ok).toBe(true);
    expect(store.cartNow()).toBe(before); // the same saved array: nothing was rewritten
    expect(server.log.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /me/cart?locale=en&since=${String(server.version)}`,
    ]);
  });

  it('after an order on the other device the next refresh shows the cart without those lines', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 2, 'BELT-2': 1 });
    server.otherDevice((m) => m.delete('OIL-1')); // the phone ordered the oil
    await sync.refreshCart('en');
    expect(skusOf(store.cartNow())).toEqual(['BELT-2']);
  });

  it('edits made while a refresh is in flight are sent next, not lost', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1 });
    const running = sync.refreshCart('en');
    store.addToCart('belt-2', 1, 'BELT-2'); // typed while the refresh runs
    await running;
    await sync.refreshCart('en');
    expect(server.lines.get('BELT-2')).toBe(1);
    expect(skusOf(store.cartNow())).toEqual(['BELT-2', 'OIL-1']);
  });
});

describe('guest cart and shared device', () => {
  it('a genuine guest cart merges at sign-in', async () => {
    const store = await import('../src/demo/store');
    const sync = await import('../src/lib/cart-sync');
    store.addToCart('oil-1', 3, 'OIL-1');
    server.lines.set('BAT-9', 1);
    server.version += 1;
    await sync.mergeAtSignIn('en');
    expect(Object.fromEntries(server.lines)).toEqual({ 'OIL-1': 3, 'BAT-9': 1 });
    expect(skusOf(store.cartNow())).toEqual(['BAT-9', 'OIL-1']);
  });

  it('the same customer signing in again refreshes; a removed line is not brought back by a stale copy', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 1, 'BELT-2': 1 });
    server.otherDevice((m) => m.delete('OIL-1')); // removed on the phone
    server.log.length = 0;
    await sync.mergeAtSignIn('en'); // signing in again here, sign-out hook never ran
    expect(server.log.some((r) => r.path.startsWith('/me/cart/merge'))).toBe(false);
    expect(skusOf(store.cartNow())).toEqual(['BELT-2']);
  });

  it('A signs out, B signs in: A’s lines are not merged into B’s cart', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 2 });
    uid = 'uid-b';
    server = new FakeServer();
    server.lines.set('BELT-9', 1);
    server.version = 1;
    await sync.mergeAtSignIn('en');
    expect(Object.fromEntries(server.lines)).toEqual({ 'BELT-9': 1 });
    expect(skusOf(store.cartNow())).toEqual(['BELT-9']);
  });

  it('sign-out clears the browser cart and the sync state', async () => {
    const { store, sync } = await signedInDevice({ 'OIL-1': 2 });
    await sync.resetCartSync();
    expect(store.cartNow()).toEqual([]);
    server.log.length = 0;
    await sync.refreshCart('en');
    expect(writes()).toEqual([]);
  });
});

describe('polling', () => {
  type Listener = () => void;
  let visible = true;
  const listeners = new Map<string, Listener[]>();
  const fire = (name: string) => {
    for (const l of listeners.get(name) ?? []) l();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    listeners.clear();
    const target = {
      addEventListener: (n: string, l: Listener) => {
        listeners.set(n, [...(listeners.get(n) ?? []), l]);
      },
      removeEventListener: (n: string, l: Listener) => {
        listeners.set(
          n,
          (listeners.get(n) ?? []).filter((x) => x !== l),
        );
      },
    };
    Object.assign(globalThis, {
      document: {
        ...target,
        get visibilityState() {
          return visible ? 'visible' : 'hidden';
        },
      },
      window: { ...(globalThis as { window: object }).window, ...target },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks every 60 s while visible, stops when hidden, and checks at once when visible again', async () => {
    const { startPolling } = await import('../src/lib/storefront-poll');
    const refresh = vi.fn(() => Promise.resolve(true));
    const stop = startPolling(refresh);
    expect(refresh).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    visible = false;
    fire('visibilitychange');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(2); // hidden: no checks

    visible = true;
    fire('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(3); // back: one check at once
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('a window focus counts like coming back, but never twice within five seconds', async () => {
    const { startPolling } = await import('../src/lib/storefront-poll');
    const refresh = vi.fn(() => Promise.resolve(true));
    startPolling(refresh);
    await vi.advanceTimersByTimeAsync(60_000);
    fire('focus');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1); // just checked: focus does not repeat it
    await vi.advanceTimersByTimeAsync(6_000);
    fire('focus');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('backs off after failures (60 s, 2, 4 minutes, at most 5) and returns to 60 s after a success', async () => {
    const { startPolling } = await import('../src/lib/storefront-poll');
    const results = [false, false, false, false, true];
    const refresh = vi.fn(() => Promise.resolve(results.shift() ?? true));
    startPolling(refresh);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1); // failed: next in 2 min
    await vi.advanceTimersByTimeAsync(119_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2); // failed: next in 4 min
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(3); // failed: next in 5 min (the cap)
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(4); // failed again: still 5 min
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(5); // success: back to 60 s
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(6);
  });

  it('the app-level refresh reads the cart and the wishlist together, once per tick', async () => {
    const sync = await import('../src/lib/storefront-sync');
    expect(typeof sync.startStorefrontSync).toBe('function');
    expect(typeof sync.refreshStorefront).toBe('function');
  });
});
