/**
 * The reset and verification emails are requested from our API, never from the Firebase client SDK (decision
 * 2026-11-24: Firebase would link to its own page). The reset request carries the Cloudflare token and maps the
 * API's answers to the reasons the sign-in screen shows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendResetEmail } from '@/lib/auth/firebase-client';

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendResetEmail', () => {
  it('posts the address, language and Cloudflare token to the API (Hindi stays hi, anything else is en)', async () => {
    const fetchMock = vi.fn(() => reply(200, { status: 'accepted' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendResetEmail('asha@example.com', 'hi', 'cf-token')).toEqual({ ok: true });
    expect(await sendResetEmail('asha@example.com', 'de', 'cf-token')).toEqual({ ok: true });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe('/v1/auth/password-reset-email');
    expect(calls[0]?.[1].method).toBe('POST');
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({
      email: 'asha@example.com',
      locale: 'hi',
      turnstileToken: 'cf-token',
    });
    expect((JSON.parse(calls[1]?.[1].body as string) as { locale: string }).locale).toBe('en');
  });

  it.each([
    [400, { error: { code: 'TURNSTILE_FAILED' } }, 'turnstile'],
    [429, { error: { code: 'RATE_LIMITED' } }, 'rate'],
    [503, { error: { code: 'AUTH_UNAVAILABLE' } }, 'unavailable'],
    [400, { error: { code: 'VALIDATION_FAILED' } }, 'unavailable'],
  ] as const)('maps %i %j to "%s"', async (status, body, reason) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply(status, body)),
    );
    expect(await sendResetEmail('a@example.com', 'en', 't')).toEqual({ ok: false, reason });
  });

  it('reports a network failure as such', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    expect(await sendResetEmail('a@example.com', 'en', 't')).toEqual({ ok: false, reason: 'network' });
  });
});
