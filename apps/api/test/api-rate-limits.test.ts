/**
 * Global /v1 limits (spec 13, decision 2026-11-16, Q195): a verified token counts per account, everyone else per
 * IP (guests), and every request also counts against a per-IP flood guard. The numbers are admin settings read
 * through a short cache.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { apiRateLimit } from '../src/middleware/api-rate-limit';
import { ApiLimitsProvider, DEFAULT_API_LIMITS, type ApiLimits } from '../src/rate-limit/api-limits';
import { MemoryRateLimiter } from '../src/rate-limit/limiter';
import { handleError } from '../src/errors';
import type { AppEnv } from '../src/types';
import { bearer, buildApp, FakeVerifier } from './helpers';

const LIMITS: ApiLimits = { signedInPerMinute: 5, guestPerIpPerMinute: 8, ipFloodPerMinute: 40 };

function harness(limits: ApiLimits = LIMITS) {
  const verifier = new FakeVerifier();
  const limiter = new MemoryRateLimiter(() => 1_000_000);
  const provider = new ApiLimitsProvider(() => Promise.resolve(limits));
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use('*', async (c, next) => {
    c.set('clientIp', c.req.header('x-test-ip') ?? '1.1.1.1');
    await next();
  });
  app.use('*', apiRateLimit({ rateLimiter: limiter, verifier }, provider));
  app.get('/ping', (c) => c.json({ ok: true }));
  const call = (token: string | null, ip = '1.1.1.1') =>
    app.request('/ping', { headers: { 'x-test-ip': ip, ...(token ? bearer(token) : {}) } });
  return { app, verifier, limiter, call };
}

const tok = (n: number | string) => `token-global-limit-${String(n).padStart(6, '0')}`;

describe('global API limit keying', () => {
  it('a verified token counts against its account, not the IP', async () => {
    const h = harness();
    h.verifier.add(tok('a'), { firebaseUid: 'uid-a' });
    for (let i = 0; i < 5; i++) expect((await h.call(tok('a'))).status).toBe(200);
    const limited = await h.call(tok('a'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect(limited.headers.get('ratelimit-limit')).toBe('5');
  });

  it('50 different signed-in users behind one IP are not blocked at the guest limit', async () => {
    const h = harness({ ...LIMITS, ipFloodPerMinute: 500 });
    for (let u = 0; u < 50; u++) h.verifier.add(tok(u), { firebaseUid: `uid-${String(u)}` });
    for (let u = 0; u < 50; u++) expect((await h.call(tok(u))).status).toBe(200);
    // ...while the same IP as guests is cut at the guest limit (8).
    for (let i = 0; i < 8; i++) expect((await h.call(null, '2.2.2.2')).status).toBe(200);
    expect((await h.call(null, '2.2.2.2')).status).toBe(429);
  });

  it('a forged, unknown or expired token is a guest: counted per IP, never per claimed user', async () => {
    const h = harness();
    for (let i = 0; i < 8; i++)
      expect((await h.call('forged-token-' + String(i).padStart(10, '0'))).status).toBe(200);
    expect((await h.call(tok('nope'))).status).toBe(429); // 9th guest request from the same IP
    expect((await h.call(tok('nope'), '3.3.3.3')).status).toBe(200); // another IP is untouched
  });

  it('no token: guests are counted per IP', async () => {
    const h = harness();
    for (let i = 0; i < 8; i++) expect((await h.call(null)).status).toBe(200);
    expect((await h.call(null)).status).toBe(429);
    expect((await h.call(null, '9.9.9.9')).status).toBe(200);
  });

  it('the per-IP flood guard trips above its ceiling even for distinct signed-in users', async () => {
    const h = harness({ signedInPerMinute: 60, guestPerIpPerMinute: 60, ipFloodPerMinute: 10 });
    for (let u = 0; u < 11; u++) h.verifier.add(tok(u), { firebaseUid: `uid-${String(u)}` });
    for (let u = 0; u < 10; u++) expect((await h.call(tok(u))).status).toBe(200);
    expect((await h.call(tok(10))).status).toBe(429);
  });

  it('verifies the token once per request', async () => {
    const h = harness();
    h.verifier.add(tok('once'), { firebaseUid: 'uid-once' });
    await h.call(tok('once'));
    expect(h.verifier.calls).toEqual([{ checkRevoked: false }]);
  });

  it('an unreachable verifier never blocks a request: it counts as a guest', async () => {
    const h = harness();
    vi.spyOn(h.verifier, 'verify').mockRejectedValue(new Error('firebase down'));
    expect((await h.call(tok('x'))).status).toBe(200);
  });
});

describe('ApiLimitsProvider cache', () => {
  it('reads once per TTL, then again; a failure keeps the last good values (defaults when none)', async () => {
    let now = 0;
    let n = 0;
    let fail = false;
    const load = vi.fn(() => {
      if (fail) return Promise.reject(new Error('db down'));
      n++;
      return Promise.resolve({ ...DEFAULT_API_LIMITS, signedInPerMinute: 100 + n });
    });
    const p = new ApiLimitsProvider(load, 30_000, () => now);
    expect((await p.get()).signedInPerMinute).toBe(101);
    await p.get();
    await p.get();
    expect(load).toHaveBeenCalledTimes(1);
    now = 30_001;
    expect((await p.get()).signedInPerMinute).toBe(102);
    expect(load).toHaveBeenCalledTimes(2);
    fail = true;
    now = 70_000;
    expect((await p.get()).signedInPerMinute).toBe(102);
    const cold = new ApiLimitsProvider(
      () => Promise.reject(new Error('down')),
      30_000,
      () => now,
    );
    expect(await cold.get()).toEqual(DEFAULT_API_LIMITS);
  });

  it('concurrent refreshes share one read', async () => {
    const load = vi.fn(() => Promise.resolve(DEFAULT_API_LIMITS));
    const p = new ApiLimitsProvider(load);
    await Promise.all([p.get(), p.get(), p.get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('wired into /v1', () => {
  it('uses the admin setting: a guest limit lowered to 60 applies', async () => {
    const { db } = await buildApp();
    const { settings } = await import('@mechdost/db/schema');
    await db.insert(settings).values({ key: 'api.guest_per_ip_per_minute', cityId: null, value: 60 });
    const fresh = await buildApp(); // new app, new cache: reads the new value
    for (let i = 0; i < 60; i++) expect((await fresh.app.request('/v1/me')).status).toBe(401);
    expect((await fresh.app.request('/v1/me')).status).toBe(429);
  });
});
