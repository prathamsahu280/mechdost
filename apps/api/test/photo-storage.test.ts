/**
 * The Supabase Storage client (design 2026-11-15) against a fake `fetch`: private bucket created when missing, a public
 * bucket refused, the secret key only in headers (never in a URL or an error), object paths encoded, and a missing
 * object read as null. Never calls the real service.
 */
import { describe, expect, it } from 'vitest';
import { supabaseStorage } from '../src/photos/storage';

const KEY = 'sb_secret_abcdefghijklmnopqrstuvwxyz0123';
const cfg = { url: 'https://abcdefgh1234.supabase.co', secretKey: KEY, bucket: 'service-photos' };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fake(responses: Response[]) {
  const calls: Call[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body,
    });
    const next = responses.shift();
    return Promise.resolve(next ?? new Response('{}', { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, storage: supabaseStorage(cfg, impl) };
}

describe('supabaseStorage', () => {
  it('creates a private bucket when it is missing, with a size and type limit', async () => {
    const { calls, storage } = fake([
      new Response('{}', { status: 404 }),
      new Response('{}', { status: 200 }),
    ]);
    await storage.ensureBucket();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(JSON.parse(String(calls[1]?.body))).toMatchObject({
      id: 'service-photos',
      public: false,
      allowed_mime_types: ['image/webp'],
      file_size_limit: 8 * 1024 * 1024,
    });
  });

  it('refuses to run against a public bucket, and treats a creation race (409) as success', async () => {
    const pub = fake([new Response(JSON.stringify({ public: true }), { status: 200 })]);
    await expect(pub.storage.ensureBucket()).rejects.toThrow(/public/);
    const race = fake([new Response('{}', { status: 404 }), new Response('{}', { status: 409 })]);
    await expect(race.storage.ensureBucket()).resolves.toBeUndefined();
  });

  it('sends the secret key only in the apikey header, not in URLs, and not in errors', async () => {
    const { calls, storage } = fake([
      new Response('{}', { status: 200 }),
      new Response('no', { status: 500 }),
    ]);
    await storage.put('job/a/b.webp', Buffer.from('x'));
    expect(calls[0]?.headers.apikey).toBe(KEY);
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.url).toBe(
      'https://abcdefgh1234.supabase.co/storage/v1/object/service-photos/job/a/b.webp',
    );
    expect(calls[0]?.url).not.toContain(KEY);
    const err = await storage.put('job/a/c.webp', Buffer.from('x')).catch((e: unknown) => e);
    expect(String(err)).not.toContain(KEY);
  });

  it('reads a missing object as null and encodes odd path characters', async () => {
    const { calls, storage } = fake([new Response('{}', { status: 404 })]);
    expect(await storage.get('job/a b/../c.webp')).toBeNull();
    expect(calls[0]?.url).toContain('job/a%20b/');
  });
});
