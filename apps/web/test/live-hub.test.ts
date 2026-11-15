import type * as HubModule from '@/lib/live/live-hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 10 "Live updates": the hub shares one lazily imported listener per tab, merges and debounces pings, and does
 * nothing in demo builds or without the database URL. The listener module is mocked (no Firebase here).
 */
const connectLive = vi.fn<(o: { locale: string; onKinds: (k: readonly string[]) => void }) => () => void>();
const stopConnection = vi.fn();
let loaded = 0;

vi.mock('@/lib/auth/mode', () => ({ AUTH_MODE: 'firebase' }));
vi.mock('@/lib/live/live-listener', () => {
  loaded += 1;
  return { connectLive };
});

type Hub = typeof HubModule;
const flush = async () => {
  await vi.dynamicImportSettled();
  await Promise.resolve();
};

async function freshHub(url: string | undefined): Promise<Hub> {
  vi.resetModules();
  if (url === undefined) vi.stubEnv('NEXT_PUBLIC_FIREBASE_DATABASE_URL', '');
  else vi.stubEnv('NEXT_PUBLIC_FIREBASE_DATABASE_URL', url);
  return import('@/lib/live/live-hub');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
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
    const hub = await freshHub('https://x.asia-southeast1.firebasedatabase.app');
    await flush();
    expect(loaded).toBe(0);
    expect(hub.liveConfigured()).toBe(true);
    const off = await freshHub(undefined);
    off.startLive('en');
    await flush();
    expect(connectLive).not.toHaveBeenCalled();
    expect(off.liveConfigured()).toBe(false);
  });

  it('one connection for many consumers; it closes when the last one leaves', async () => {
    const hub = await freshHub('https://x.asia-southeast1.firebasedatabase.app');
    const a = hub.startLive('en');
    const b = hub.startLive('en');
    await flush();
    expect(connectLive).toHaveBeenCalledTimes(1);
    a();
    a(); // releasing twice counts once
    expect(stopConnection).not.toHaveBeenCalled();
    b();
    expect(stopConnection).toHaveBeenCalledTimes(1);
  });

  it('a ping reaches only the matching consumers, merged and debounced', async () => {
    const hub = await freshHub('https://x.asia-southeast1.firebasedatabase.app');
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
    const hub = await freshHub('https://x.asia-southeast1.firebasedatabase.app');
    const fn = vi.fn();
    const off = hub.subscribeLive(['order'], fn);
    off();
    hub.emitLive(['order']);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('sign-out resets: the connection closes, pending pings are dropped, a late-loading listener is not started', async () => {
    const hub = await freshHub('https://x.asia-southeast1.firebasedatabase.app');
    const fn = vi.fn();
    hub.subscribeLive(['order'], fn);
    hub.startLive('en');
    hub.resetLive(); // before the chunk arrived
    await flush();
    expect(connectLive).not.toHaveBeenCalled();
    hub.startLive('en');
    await flush();
    expect(connectLive).toHaveBeenCalledTimes(1);
    hub.emitLive(['order']);
    hub.resetLive();
    vi.advanceTimersByTime(1000);
    expect(stopConnection).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a listener that fails to load leaves the pages on polling (no throw)', async () => {
    const hub = await freshHub('https://x.asia-southeast1.firebasedatabase.app');
    connectLive.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => hub.startLive('en')).not.toThrow();
    await flush();
  });
});
