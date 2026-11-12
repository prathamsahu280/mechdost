/**
 * Address search for the seller's location picker (plan 2026-11-13 Task 6): Nominatim from our server, only when
 * the seller presses Search (the public Nominatim policy forbids search-as-you-type), limited to India, cached,
 * rate limited per client. Upstream is a fake fetch.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/geo/search/route';

const req = (q: string) => new NextRequest(`http://localhost/api/geo/search?q=${encodeURIComponent(q)}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/geo/search', () => {
  it('refuses a query that is too short or too long', async () => {
    expect((await GET(req('ab'))).status).toBe(400);
    expect((await GET(req('x'.repeat(121)))).status).toBe(400);
  });

  it('maps Nominatim results to a label and coordinates, in India only', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { display_name: 'Pandri, Raipur, Chhattisgarh, 492004, India', lat: '21.2514', lon: '81.6467' },
          ]),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req('Pandri Raipur'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ label: 'Pandri, Raipur, Chhattisgarh, 492004, India', lat: 21.2514, lng: 81.6467 }],
    });
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain('countrycodes=in');
    expect(url).toContain('q=Pandri+Raipur');
  });

  it('an upstream failure is a 502 and is not cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('busy', { status: 503 }))),
    );
    expect((await GET(req('Telibandha Raipur'))).status).toBe(502);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ display_name: 'Telibandha', lat: '21.24', lon: '81.67' }])),
        ),
      ),
    );
    expect((await GET(req('Telibandha Raipur'))).status).toBe(200);
  });

  it('the 11th search in a minute from one client is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('[]'))),
    );
    let last = 200;
    for (let i = 0; i < 11; i++) last = (await GET(req('Pandri Raipur'))).status;
    expect(last).toBe(429);
  });
});
