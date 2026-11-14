import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicReviews } from '../src/lib/reviews-api-source';
import { reviewErrorKey, reviewShares, reviewStatusKey } from '../src/lib/review-views';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = {
  summary: { avg: 4.5, count: 2, distribution: [1, 1, 0, 0, 0] },
  reviews: [{ id: 'r1', rating: 5, body: 'Good', author: 'Ravi S.', createdAt: '2026-11-14T10:00:00.000Z' }],
  nextCursor: null,
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchPublicReviews (server, real data mode)', () => {
  it('reads the approved reviews of a product, cached briefly with a per-target tag', async () => {
    fetchMock.mockResolvedValueOnce(json(page));
    const r = await fetchPublicReviews('product', 'castrol-activ');
    expect(r).toEqual({ ok: true, data: page });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/reviews/product/castrol-activ?limit=10');
    expect((init as { next: unknown }).next).toEqual({
      revalidate: 60,
      tags: ['reviews', 'reviews:product:castrol-activ'],
    });
  });

  it('a slug the API would refuse is "none" without a call; 404 is "none"; anything else is an error', async () => {
    expect(await fetchPublicReviews('workshop', '../admin')).toEqual({ ok: false, reason: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'NOT_FOUND' } }, 404));
    expect(await fetchPublicReviews('workshop', 'shankar-auto')).toEqual({ ok: false, reason: 'none' });
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'X' } }, 500));
    expect(await fetchPublicReviews('workshop', 'shankar-auto')).toEqual({ ok: false, reason: 'error' });
    fetchMock.mockResolvedValueOnce(json({ summary: {}, reviews: 'no' }));
    expect(await fetchPublicReviews('workshop', 'shankar-auto')).toEqual({ ok: false, reason: 'error' });
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await fetchPublicReviews('workshop', 'shankar-auto')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('review views', () => {
  it('maps every API refusal to a message key, unknown ones to the generic one', () => {
    expect(reviewErrorKey('REVIEW_EXISTS')).toBe('api_err_exists');
    expect(reviewErrorKey('REVIEW_DAILY_LIMIT')).toBe('api_err_limit');
    expect(reviewErrorKey('REVIEW_NOT_ELIGIBLE')).toBe('api_err_eligible');
    expect(reviewErrorKey('RATE_LIMITED')).toBe('api_err_rate');
    expect(reviewErrorKey('AUTH_REQUIRED')).toBe('api_err_auth');
    expect(reviewErrorKey('VERIFICATION_REQUIRED')).toBe('api_err_verify');
    expect(reviewErrorKey('NETWORK')).toBe('api_err_network');
    expect(reviewErrorKey('HTTP_503')).toBe('api_err_network');
    expect(reviewErrorKey('SOMETHING_NEW')).toBe('api_err_generic');
  });

  it('turns the distribution into whole percentages (5★ first) and an empty summary into zeros', () => {
    expect(reviewShares({ avg: 4.5, count: 4, distribution: [2, 1, 1, 0, 0] })).toEqual([
      { stars: 5, percent: 50 },
      { stars: 4, percent: 25 },
      { stars: 3, percent: 25 },
      { stars: 2, percent: 0 },
      { stars: 1, percent: 0 },
    ]);
    expect(
      reviewShares({ avg: null, count: 0, distribution: [0, 0, 0, 0, 0] }).every((s) => s.percent === 0),
    ).toBe(true);
  });

  it('names the status message of the customer’s own review', () => {
    expect(reviewStatusKey('pending')).toBe('api_status_pending');
    expect(reviewStatusKey('approved')).toBe('api_status_approved');
    expect(reviewStatusKey('hidden')).toBe('api_status_hidden');
  });
});
