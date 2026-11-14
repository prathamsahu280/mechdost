import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { MemoryRateLimiter } from '../src/rate-limit/limiter';
import { ALLOWED_ORIGIN, bearer, buildApp, type ErrorJson } from './helpers';

describe('probes', () => {
  it('reports liveness and readiness', async () => {
    const { app } = await buildApp();
    expect(await (await app.request('/health')).json()).toEqual({ status: 'ok' });
    const ready = await app.request('/ready');
    expect(ready.status).toBe(200);
  });
});

describe('security baseline', () => {
  it('sets hardened headers and a request id on every response', async () => {
    const { app } = await buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns unknown routes as the standard JSON error with the request id', async () => {
    const { app } = await buildApp();
    const res = await app.request('/nope', { headers: { 'X-Request-Id': 'trace-abc' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'trace-abc' },
    });
  });

  it('allows CORS only for configured origins', async () => {
    const { app } = await buildApp();
    const preflight = (origin: string) =>
      app.request('/v1/me', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH' },
      });
    expect((await preflight(ALLOWED_ORIGIN)).headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses compressed request bodies (Brotli RCE class, zip bombs)', async () => {
    const { app } = await buildApp();
    const res = await app.request('/v1/me', {
      method: 'PATCH',
      headers: { 'Content-Encoding': 'br', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(415);
    expect(((await res.json()) as ErrorJson).error.code).toBe('UNSUPPORTED_ENCODING');
  });

  it('refuses bodies over 1 MB', async () => {
    const { app, verifier } = await buildApp();
    const token = verifier.add('token-big-body-000000001', { firebaseUid: 'big', phone: '+919811111111' });
    const res = await app.request('/v1/me', {
      method: 'PATCH',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, name: 'x'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorJson).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rate limits per IP with Retry-After and RateLimit headers', async () => {
    let now = 1_000_000;
    const { app } = await buildApp({ rateLimiter: new MemoryRateLimiter(() => now) });
    const hit = () => app.request('/v1/me');
    for (let i = 0; i < 600; i++) await hit();
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect(limited.headers.get('ratelimit-remaining')).toBe('0');
    expect(((await limited.json()) as ErrorJson).error.code).toBe('RATE_LIMITED');
    now += 61_000;
    expect((await hit()).status).toBe(401); // window passed: back to normal handling
  });

  it('publishes the OpenAPI document outside production', async () => {
    const { app } = await buildApp();
    const doc = (await (await app.request('/openapi.json')).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/health', '/ready', '/v1/me']));
    const off = await buildApp({ env: { API_DOCS: 'off' } });
    expect((await off.app.request('/openapi.json')).status).toBe(404);
  });
});

describe('configuration', () => {
  const base = { DATABASE_POOL_URL: 'postgres://x' };

  const prod = {
    ...base,
    NODE_ENV: 'production',
    FIREBASE_PROJECT_ID: 'mechdost-prod',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 't',
    FIREBASE_API_KEY: 'test-web-api-key-0000',
    TURNSTILE_SECRET_KEY: '0x-test-secret-0000',
    CORS_ORIGINS: 'https://mechdost.com',
    TRUSTED_PROXY_HOPS: '1',
    WEB_BASE_URL: 'https://mechdost.com',
  };

  it('production needs at least one trusted proxy hop (else every user shares one rate-limit bucket; review C2)', () => {
    expect(() => loadConfig({ ...prod, TRUSTED_PROXY_HOPS: '0' })).toThrow(/TRUSTED_PROXY_HOPS/);
    const { TRUSTED_PROXY_HOPS: _unset, ...withoutHops } = prod;
    expect(() => loadConfig(withoutHops)).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(loadConfig(prod).trustedProxyHops).toBe(1);
  });

  it('production with Razorpay keys needs the webhook secret (no capture may go unnoticed; final review 2026-11-12)', () => {
    const live = {
      ...prod,
      RAZORPAY_KEY_ID: 'rzp_live_Fake0123456789',
      RAZORPAY_KEY_SECRET: 'live_key_secret_0123456789',
    };
    expect(() => loadConfig(live)).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
    expect(loadConfig({ ...live, RAZORPAY_WEBHOOK_SECRET: 'whsec_0123456789' }).razorpay?.webhookSecret).toBe(
      'whsec_0123456789',
    );
    expect(loadConfig(prod).razorpay).toBeNull();
  });

  it('on Cloud Run (K_SERVICE set) the API refuses to start unless NODE_ENV=production (review C3)', () => {
    expect(() => loadConfig({ ...base, K_SERVICE: 'mechdost-api' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'development', K_SERVICE: 'mechdost-api' })).toThrow(
      /NODE_ENV/,
    );
    expect(loadConfig({ ...prod, K_SERVICE: 'mechdost-api' }).trustedProxyHops).toBe(1);
  });

  it('refuses unsafe production setups and names the variables, not their values', () => {
    try {
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        CORS_ORIGINS: 'http://localhost:3000',
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as ConfigError).message;
      for (const key of [
        'UPSTASH_REDIS_REST_URL',
        'FIREBASE_AUTH_EMULATOR_HOST',
        'FIREBASE_PROJECT_ID',
        'CORS_ORIGINS',
        'FIREBASE_API_KEY',
        'TURNSTILE_SECRET_KEY',
      ]) {
        expect(msg).toContain(key);
      }
      expect(msg).not.toContain('postgres://x');
    }
  });

  // AWS server (2026-11-14, Q93): no automatic Google credentials there, so firebase-admin needs the project's
  // service-account key — only as a mounted secret file, never from anywhere else.
  it('production accepts a Firebase key file only from /run/secrets', () => {
    expect(
      loadConfig({ ...prod, GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/firebase-admin.json' })
        .firebaseKeyFile,
    ).toBe('/run/secrets/firebase-admin.json');
    for (const path of ['/opt/mechdost/key.json', './firebase.json', '/run/secrets/../etc/key.json'])
      expect(() => loadConfig({ ...prod, GOOGLE_APPLICATION_CREDENTIALS: path })).toThrow(
        /GOOGLE_APPLICATION_CREDENTIALS/,
      );
  });

  it('rejects placeholder database URLs from .env.example', () => {
    expect(() =>
      loadConfig({ DATABASE_POOL_URL: 'postgresql://postgres.<project-ref>:<db-password>@h/p' }),
    ).toThrow(ConfigError);
  });

  it('treats blank .env values as unset', () => {
    const cfg = loadConfig({ ...base, FIREBASE_PROJECT_ID: '', UPSTASH_REDIS_REST_URL: '', PORT: ' ' });
    expect(cfg.firebaseProjectId).toBe('demo-mechdost');
    expect(cfg.upstash).toBeNull();
    expect(cfg.port).toBe(4000);
  });

  it('parses a valid production config', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'production',
      FIREBASE_PROJECT_ID: 'mechdost-prod',
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
      FIREBASE_API_KEY: 'test-web-api-key-0000',
      TURNSTILE_SECRET_KEY: '0x-test-secret-0000',
      CORS_ORIGINS: 'https://mechdost.com, https://www.mechdost.com',
      TRUSTED_PROXY_HOPS: '1',
      WEB_BASE_URL: 'https://mechdost.com',
    });
    expect(cfg.corsOrigins).toEqual(['https://mechdost.com', 'https://www.mechdost.com']);
    expect(cfg.apiDocs).toBe(false);
    expect(cfg.trustedProxyHops).toBe(1);
  });
});
