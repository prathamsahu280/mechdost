import type * as HubModule from '@/lib/live/live-hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 10 "Live updates": the hub shares one lazily imported listener per tab, merges and debounces pings, and does
 * nothing in demo builds or without the database URL. The listener is fetched only when the browser is idle and the
 * tab is visible, and closes after a short grace once the last consumer leaves. The listener module is mocked.
 */
const connectLive = vi.fn<(o: { locale: string; onKinds: (k: readonly string[]) => void }) => () => void>();
const stopConnection = vi.fn();
let loaded = 0;
let visibility: 'visible' | 'hidden' = 'visible';
const docListeners = new Map<string, () => void>();

vi.mock('@/lib/auth/mode', () => ({ AUTH_MODE: 'firebase' }));
vi.mock('@/lib/live/live-listener', () => {
  loaded += 1;
  return { connectLive };
});

type Hub = typeof HubModule;
const URL_OK = 'https://x.asia-southeast1.firebasedatabase.app';
/** Past the idle fallback (1 s) but before the close grace (2 s). */
const flush = async () => {
  await vi.advanceTimersByTimeAsync(1500);
  await vi.dynamicImportSettled();
  await Promise.resolve();
};

async function freshHub(url: string | undefined): Promise<Hub> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_DATABASE_URL', url ?? '');
  return import('@/lib/live/live-hub');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  visibility = 'visible';
  docListeners.clear();
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (n: string, fn: () => void) => docListeners.set(n, fn),
    removeEventListener: (n: string) => docListeners.delete(n),
  });
  loaded = 0;
  connectLive.mockReset();
  stopConnection.mockReset();
  connectLive.mockReturnValue(stopConnection);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('live hub', () => {
  it('does not import the listener until someone asks, and not at all without the database URL', async () => {
    const hub = await freshHub(URL_OK);
    await flush();
    expect(loaded).toBe(0);
    expect(hub.liveConfigured()).toBe(true);
    const off = await freshHub(undefined);
    off.startLive('en');
    await flush();
    expect(connectLive).not.toHaveBeenCalled();
    expect(off.liveConfigured()).toBe(false);
  });

  it('keeps the listener out of the first task: it is fetched only after the browser is idle', async () => {
    const hub = await freshHub(URL_OK);
    hub.startLive('en');
    await vi.dynamicImportSettled();
    expect(connectLive).not.toHaveBeenCalled();
    await flush();
    expect(connectLive).toHaveBeenCalledTimes(1);
  });

  it('waits for the tab to be visible before fetching the listener', async () => {
    visibility = 'hidden';
    const hub = await freshHub(URL_OK);
    hub.startLive('en');
    await flush();
    expect(connectLive).not.toHaveBeenCalled();
    visibility = 'visible';
    docListeners.get('visibilitychange')?.();
    await flush();
    expect(connectLive).toHaveBeenCalledTimes(1);
  });

  it('one connection for many consumers; it closes a moment after the last one leaves', async () => {
    const hub = await freshHub(URL_OK);
    const a = hub.startLive('en');
    const b = hub.startLive('en');
    await flush();
    expect(connectLive).toHaveBeenCalledTimes(1);
    a();
    a(); // releasing twice counts once
    b();
    expect(stopConnection).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(hub.LIVE_CLOSE_GRACE_MS + 1);
    expect(stopConnection).toHaveBeenCalledTimes(1);
  });

  it('a consumer that re-subscribes at once (effect re-run) keeps the same connection', async () => {
    const hub = await freshHub(URL_OK);
    const release = hub.startLive('en');
    await flush();
    release();
    hub.startLive('en');
    await vi.advanceTimersByTimeAsync(hub.LIVE_CLOSE_GRACE_MS + 1);
    expect(stopConnection).not.toHaveBeenCalled();
    expect(connectLive).toHaveBeenCalledTimes(1);
  });

  it('a ping reaches only the matching consumers, merged and debounced', async () => {
    const hub = await freshHub(URL_OK);
    const cart = vi.fn();
    const bell = vi.fn();
    hub.subscribeLive(['cart', 'wishlist'], cart);
    hub.subscribeLive(['order'], bell);
    hub.emitLive(['cart']);
    hub.emitLive(['wishlist']);
    hub.emitLive(['cart']);
    expect(cart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(hub.LIVE_DEBOUNCE_MS + 1);
    expect(cart).toHaveBeenCalledTimes(1);
    expect([...(cart.mock.calls[0]?.[0] as Set<string>)].sort()).toEqual(['cart', 'wishlist']);
    expect(bell).not.toHaveBeenCalled();
  });

  it('an unsubscribed consumer hears nothing', async () => {
    const hub = await freshHub(URL_OK);
    const fn = vi.fn();
    const off = hub.subscribeLive(['order'], fn);
    off();
    hub.emitLive(['order']);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('sign-out resets at once: the connection closes, pending pings are dropped, a late listener is not started', async () => {
    const hub = await freshHub(URL_OK);
    const fn = vi.fn();
    hub.subscribeLive(['order'], fn);
    hub.startLive('en');
    hub.resetLive(); // before the listener was fetched
    await flush();
    expect(connectLive).not.toHaveBeenCalled();
    hub.startLive('en');
    await flush();
    expect(connectLive).toHaveBeenCalledTimes(1);
    hub.emitLive(['order']);
    hub.resetLive();
    expect(stopConnection).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a listener that fails to load leaves the pages on polling (no throw)', async () => {
    const hub = await freshHub(URL_OK);
    connectLive.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => hub.startLive('en')).not.toThrow();
    await flush();
  });
});
