/**
 * The "your password was changed" notice: after a successful reset or change the page tells the API (which checks
 * Firebase itself before sending anything). The call is best effort: it never fails the change, and never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyPasswordChanged } from '@/lib/auth/firebase-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notifyPasswordChanged', () => {
  it('posts the address and language (Hindi stays hi, anything else is en), and survives the page closing', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await notifyPasswordChanged('asha@example.com', 'hi');
    await notifyPasswordChanged('asha@example.com', 'de');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe('/v1/auth/password-changed');
    expect(calls[0]?.[1].method).toBe('POST');
    expect(calls[0]?.[1].keepalive).toBe(true);
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({ email: 'asha@example.com', locale: 'hi' });
    expect((JSON.parse(calls[1]?.[1].body as string) as { locale: string }).locale).toBe('en');
  });

  it('sends nothing without an address, and never throws on a network failure or an error answer', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchMock);
    await expect(notifyPasswordChanged('', 'en')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(notifyPasswordChanged('a@example.com', 'en')).resolves.toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 429 }))),
    );
    await expect(notifyPasswordChanged('a@example.com', 'en')).resolves.toBeUndefined();
  });
});
