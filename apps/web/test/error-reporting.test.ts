/**
 * Browser error reports (decision 2026-11-14, spec 16 JS budget): the Sentry SDK is not loaded until an error
 * happens; errors before it loads are queued and sent once it is ready; at most 10 per page; nothing at all
 * without a DSN; cross-origin "Script error." events (no error object) are ignored.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured: unknown[] = [];
const startSentry = vi.fn((dsn: string) => {
  expect(dsn).toMatch(/ingest\.de\.sentry\.io/u);
  return (e: unknown) => captured.push(e);
});
vi.mock('@/lib/sentry-browser', () => ({ startSentry }));

type Listener = (e: unknown) => void;
function fakeWindow() {
  const listeners = new Map<string, Listener>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  });
  return listeners;
}

async function load(dsn: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn ?? '');
  return import('../src/lib/error-reporting');
}

afterEach(() => {
  captured.length = 0;
  startSentry.mockClear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const DSN = 'https://0123456789abcdef0123456789abcdef@o4500000000000000.ingest.de.sentry.io/4500000000000001';

describe('error reporting in the browser', () => {
  it('loads the SDK only on the first error, then sends queued and later errors', async () => {
    const listeners = fakeWindow();
    const m = await load(DSN);
    // Listening starts when the module loads (before hydration), not only from the island's effect.
    expect(listeners.has('error')).toBe(true);
    expect(listeners.has('unhandledrejection')).toBe(true);
    m.startErrorReporting();
    expect(startSentry).not.toHaveBeenCalled();
    listeners.get('error')?.({ message: 'Script error.' }); // cross-origin: ignored
    expect(startSentry).not.toHaveBeenCalled();
    const first = new Error('first');
    listeners.get('error')?.({ error: first });
    await vi.waitFor(() => {
      expect(captured).toEqual([first]);
    });
    expect(startSentry).toHaveBeenCalledTimes(1);
    // Sentry's own handlers take over: ours are removed.
    expect(listeners.has('error')).toBe(false);
    expect(listeners.has('unhandledrejection')).toBe(false);
    m.reportClientError('second');
    expect(captured).toEqual([first, 'second']);
  });

  it('sends at most 10 reports per page', async () => {
    fakeWindow();
    const m = await load(DSN);
    for (let i = 0; i < 15; i += 1) m.reportClientError(i);
    await vi.waitFor(() => {
      expect(captured).toHaveLength(10);
    });
  });

  it('does nothing without a DSN', async () => {
    const listeners = fakeWindow();
    const m = await load(undefined);
    m.startErrorReporting();
    m.reportClientError(new Error('x'));
    await new Promise((r) => setTimeout(r, 10));
    expect(listeners.size).toBe(0);
    expect(startSentry).not.toHaveBeenCalled();
  });
});
