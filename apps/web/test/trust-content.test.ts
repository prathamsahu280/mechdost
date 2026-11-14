import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportErrorKey } from '../src/lib/support-view';

/** `publishedTrust` reads the data mode at import time, so each case loads a fresh copy of the module. */
async function load(mode: 'api' | 'demo') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', mode);
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');
  return (await import('../src/lib/trust-content')).publishedTrust;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('publishedTrust (trust lines from the content API, design 2026-11-15)', () => {
  it('keeps only trust keys with text and asks for the page language and city', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: {
              'trust.checkout': 'Only original parts.',
              'hero.lead': 'x',
              'trust.nope': 'y',
              'trust.homeBill': '-',
            },
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const publishedTrust = await load('api');
    expect(await publishedTrust('hi')).toEqual({
      'trust.checkout': 'Only original parts.',
      'trust.homeBill': '-',
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.example.test/v1/content?locale=hi&city=RPR');
  });

  it('is empty in the demo build, and on a failed, slow or malformed answer (the default text shows)', async () => {
    const demoFetch = vi.fn();
    vi.stubGlobal('fetch', demoFetch);
    expect(await (await load('demo'))('en')).toEqual({});
    expect(demoFetch).not.toHaveBeenCalled();

    const publishedTrust = await load('api');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })));
    expect(await publishedTrust('en')).toEqual({});
    vi.stubGlobal('fetch', () => Promise.reject(new Error('timeout')));
    expect(await publishedTrust('en')).toEqual({});
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"content":[1]}')));
    expect(await publishedTrust('en')).toEqual({});
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('"text"')));
    expect(await publishedTrust('en')).toEqual({});
  });
});

describe('support error codes for the labour promise', () => {
  it('maps the API codes to their own messages', () => {
    expect(supportErrorKey('LABOUR_PROMISE_UNAVAILABLE')).toBe('api_err_labour');
    expect(supportErrorKey('SERVICE_CODE_REQUIRED')).toBe('api_err_labour');
    expect(supportErrorKey('LABOUR_REDO_OPEN')).toBe('api_err_labour_open');
  });
});
