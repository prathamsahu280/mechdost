import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Spec 10 "Live updates": the RTDB listener (SDK and sign-in client mocked). */
type Cb = (snap: { val: () => unknown }) => void;
const children: { path: string; cb: Cb; fail: () => void }[] = [];
const offs: string[] = [];
const goOnline = vi.fn();
const goOffline = vi.fn();
let authCb: ((uid: string | null) => void) | undefined;
let visibility: 'visible' | 'hidden' = 'visible';
const listeners = new Map<string, () => void>();

vi.mock('@firebase/app', () => ({ getApps: () => [{ name: 'app' }] }));
vi.mock('@firebase/database', () => ({
  getDatabase: () => ({ db: true }),
  ref: (_db: unknown, path: string) => ({ path }),
  onChildAdded: (r: { path: string }, cb: Cb, fail: () => void) => children.push({ path: r.path, cb, fail }),
  onChildChanged: (r: { path: string }, cb: Cb, fail: () => void) =>
    children.push({ path: r.path, cb, fail }),
  off: (r: { path: string }) => {
    offs.push(r.path);
  },
  goOnline,
  goOffline,
}));
vi.mock('@/lib/auth/firebase-client', () => ({
  currentUid: () => Promise.resolve('uid-1'),
  watchUid: (_l: string, cb: (uid: string | null) => void) => {
    authCb = cb;
    return () => {
      authCb = undefined;
    };
  },
}));

const ID = '0190a000-0000-7000-8000-000000000001';
const ping = (k: string, v: number) => ({
  val: () => ({ e: `${k}.changed`, k, id: ID, v, at: '2026-11-15T10:00:00Z' }),
});
const settle = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

beforeEach(() => {
  children.length = 0;
  offs.length = 0;
  goOnline.mockReset();
  goOffline.mockReset();
  visibility = 'visible';
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_DATABASE_URL', 'https://x.asia-southeast1.firebasedatabase.app');
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (n: string, fn: () => void) => listeners.set(n, fn),
    removeEventListener: (n: string) => listeners.delete(n),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function connect() {
  const { connectLive } = await import('@/lib/live/live-listener');
  const onKinds = vi.fn();
  const stop = connectLive({ locale: 'en', onKinds });
  await settle();
  authCb?.('uid-1');
  return { onKinds, stop };
}

describe('live listener', () => {
  it('reads only the signed-in user inbox, and a valid ping reports its kind', async () => {
    const { onKinds } = await connect();
    expect(children.every((c) => c.path === 'inbox/uid-1')).toBe(true);
    children[0]?.cb(ping('cart', 3));
    expect(onKinds).toHaveBeenCalledWith(['cart']);
  });

  it('drops duplicates, older versions and malformed pings (version gate, exact keys)', async () => {
    const { onKinds } = await connect();
    children[0]?.cb(ping('cart', 3));
    children[0]?.cb(ping('cart', 3));
    children[0]?.cb(ping('cart', 2));
    children[0]?.cb({ val: () => ({ k: 'cart', v: 9, note: 'extra' }) });
    children[0]?.cb({ val: () => null });
    expect(onKinds).toHaveBeenCalledTimes(1);
    children[0]?.cb(ping('cart', 4));
    expect(onKinds).toHaveBeenCalledTimes(2);
  });

  it('closes when the tab is hidden, reopens and asks for a catch-up when it is visible again', async () => {
    const { onKinds } = await connect();
    visibility = 'hidden';
    listeners.get('visibilitychange')?.();
    expect(goOffline).toHaveBeenCalled();
    expect(offs).toContain('inbox/uid-1');
    const before = children.length;
    visibility = 'visible';
    listeners.get('visibilitychange')?.();
    expect(goOnline).toHaveBeenCalled();
    expect(children.length).toBeGreaterThan(before);
    const kinds = onKinds.mock.calls.at(-1)?.[0] as string[];
    expect(kinds).toEqual(expect.arrayContaining(['cart', 'wishlist', 'order']));
  });

  it('does not subscribe while the tab starts hidden', async () => {
    visibility = 'hidden';
    await connect();
    expect(children).toHaveLength(0);
    expect(goOffline).toHaveBeenCalled();
  });

  it('a different account re-points the subscription and forgets the version gate', async () => {
    const { onKinds } = await connect();
    children[0]?.cb(ping('cart', 5));
    authCb?.('uid-2');
    expect(offs).toContain('inbox/uid-1');
    const last = children.at(-1);
    expect(last?.path).toBe('inbox/uid-2');
    last?.cb(ping('cart', 1));
    expect(onKinds).toHaveBeenCalledTimes(2);
    authCb?.(null);
    expect(offs).toContain('inbox/uid-2');
  });

  it('a permission or network failure ends the subscription quietly', async () => {
    await connect();
    children[0]?.fail();
    expect(offs).toContain('inbox/uid-1');
  });

  it('stop closes everything and later pings are not attached', async () => {
    const { stop } = await connect();
    stop();
    expect(goOffline).toHaveBeenCalled();
    expect(listeners.has('visibilitychange')).toBe(false);
    expect(authCb).toBeUndefined();
  });
});
