/**
 * Security review 2026-11-13: the seller invite link `/partners/invite/<token>` is a bearer credential. Every
 * tracked event (clicks, page views) and the on-device demo log must carry the route shape, never the token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const forwarded: unknown[] = [];
vi.mock('@/lib/event-transport', () => ({
  forward: (e: unknown) => forwarded.push(e),
}));

function fakeWindow(pathname: string) {
  const store = new Map<string, string>();
  const dispatched: unknown[] = [];
  vi.stubGlobal(
    'CustomEvent',
    class<T> {
      constructor(
        public type: string,
        public init: { detail: T },
      ) {}
    },
  );
  vi.stubGlobal('window', {
    location: { pathname },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    dispatchEvent: (e: unknown) => dispatched.push(e),
  });
  return { store, dispatched };
}

afterEach(() => {
  vi.unstubAllGlobals();
  forwarded.length = 0;
});

describe('track() never records an invite token', () => {
  it('redacts the path in props, in the forwarded event and in the demo log', async () => {
    const { store } = fakeWindow('/hi/partners/invite/secret-token-123');
    const { track, DEMO_EVENTS_KEY } = await import('@/lib/analytics');
    track('click', { id: 'partner_products_opened', path: '/hi/partners/invite/secret-token-123' });
    const json = JSON.stringify({ forwarded, log: store.get(DEMO_EVENTS_KEY) });
    expect(json).not.toContain('secret-token-123');
    expect(json).toContain('/hi/partners/invite/:token');
  });

  it('leaves ordinary paths alone', async () => {
    fakeWindow('/shop');
    const { track } = await import('@/lib/analytics');
    track('page_view', { path: '/shop', locale: 'en' });
    expect(JSON.stringify(forwarded)).toContain('"path":"/shop"');
  });
});
