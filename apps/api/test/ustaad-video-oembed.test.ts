/**
 * YouTube oEmbed fetcher (spec 23 § 10b): only the fixed oEmbed URL built from a validated id is requested, no
 * redirects, a timeout and a byte cap; the JSON is validated and only title + author survive, as plain text. It never
 * throws: any failure is null and the post goes up with the id only.
 */
import { describe, expect, it } from 'vitest';
import { fetchYouTubeOEmbed, OEMBED_MAX_BYTES } from '../src/ustaad/video-oembed';

const ID = 'dQw4w9WgXcQ';
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('fetchYouTubeOEmbed', () => {
  it('asks only the fixed oEmbed URL, with no redirects, and keeps title and author as plain text', async () => {
    const seen: { url: string; redirect: RequestInit['redirect'] }[] = [];
    const meta = await fetchYouTubeOEmbed(ID, {
      fetch: (url, init) => {
        seen.push({ url, redirect: init?.redirect });
        return Promise.resolve(
          json({
            title: ' Clutch &amp; plate\u0000 change ',
            author_name: 'Raipur Garage',
            html: '<iframe src="https://evil.example"></iframe>',
            thumbnail_url: 'https://evil.example/x.jpg',
          }),
        );
      },
    });
    expect(seen).toEqual([
      {
        url: `https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${ID}`,
        redirect: 'error',
      },
    ]);
    expect(meta).toEqual({ title: 'Clutch &amp; plate change', author: 'Raipur Garage' });
  });

  it('refuses an invalid id without any request', async () => {
    let calls = 0;
    const meta = await fetchYouTubeOEmbed('../../x', {
      fetch: () => {
        calls += 1;
        return Promise.resolve(json({}));
      },
    });
    expect(meta).toBeNull();
    expect(calls).toBe(0);
  });

  it.each([
    ['404 (private or removed video)', () => Promise.resolve(new Response('Not Found', { status: 404 }))],
    ['not JSON', () => Promise.resolve(new Response('<html>', { headers: { 'content-type': 'text/html' } }))],
    ['wrong shape', () => Promise.resolve(json({ title: 42 }))],
    ['network error', () => Promise.reject(new Error('ECONNRESET'))],
    [
      'oversized body',
      () => Promise.resolve(json({ title: 'x'.repeat(OEMBED_MAX_BYTES + 10), author_name: 'a' })),
    ],
  ])('%s → null', async (_name, fetch) => {
    expect(await fetchYouTubeOEmbed(ID, { fetch })).toBeNull();
  });

  it('times out → null', async () => {
    const meta = await fetchYouTubeOEmbed(ID, {
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    });
    expect(meta).toBeNull();
  });

  it('clips long fields', async () => {
    const meta = await fetchYouTubeOEmbed(ID, {
      fetch: () => Promise.resolve(json({ title: 't'.repeat(500), author_name: 'a'.repeat(500) })),
    });
    expect(meta?.title).toHaveLength(200);
    expect(meta?.author).toHaveLength(100);
  });
});
