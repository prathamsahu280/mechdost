/**
 * Monitoring (decision 2026-11-14): Sentry error reports and PostHog EU forwarding. Both are off until their keys
 * are set; nothing personal leaves the server; analytics only with consent; a failing provider never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ForwardableEvent } from '@mechdost/db/repo';
import { ConfigError, loadConfig } from '../src/config';
import { log, setErrorHook, setLogSink } from '../src/logger';
import {
  createPosthogSender,
  scrubProps,
  startPosthogForwarder,
  toPosthogEvent,
  type PosthogEvent,
} from '../src/analytics/posthog';
import { errorHookFor, sentryOptions } from '../src/monitoring/sentry';

const DSN = 'https://0123456789abcdef0123456789abcdef@o4500000000000000.ingest.de.sentry.io/4500000000000001';
const KEY = 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
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

describe('config', () => {
  it('both are off when unset, and production still starts', () => {
    const cfg = loadConfig(prod);
    expect(cfg.sentry).toBeNull();
    expect(cfg.posthog).toBeNull();
    expect(loadConfig({ ...prod, SENTRY_DSN: '', POSTHOG_KEY: '' }).sentry).toBeNull();
  });

  it('reads a DSN and a key; PostHog defaults to the EU host', () => {
    const cfg = loadConfig({ ...prod, SENTRY_DSN: DSN, SENTRY_RELEASE: 'abc123', POSTHOG_KEY: KEY });
    expect(cfg.sentry).toEqual({ dsn: DSN, environment: 'production', release: 'abc123' });
    expect(cfg.posthog).toEqual({ key: KEY, host: 'https://eu.i.posthog.com' });
    expect(loadConfig({ ...base, SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging' }).sentry?.environment).toBe(
      'staging',
    );
  });

  it('refuses malformed values without echoing them', () => {
    for (const bad of [
      { SENTRY_DSN: 'http://key@sentry.io/1' },
      { SENTRY_DSN: 'not a dsn' },
      { POSTHOG_KEY: 'sk_live_secret_value_123456' },
      { SENTRY_ENVIRONMENT: 'Prod Env' },
    ]) {
      try {
        loadConfig({ ...base, ...bad });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as Error).message).not.toContain(Object.values(bad)[0]);
      }
    }
  });

  it('production needs an https PostHog host', () => {
    expect(() => loadConfig({ ...prod, POSTHOG_KEY: KEY, POSTHOG_HOST: 'http://posthog.local' })).toThrow(
      /POSTHOG_HOST/,
    );
  });
});

describe('Sentry options', () => {
  const opts = sentryOptions({ dsn: DSN, environment: 'production', release: 'abc' }, 'api', []);

  it('sends no default PII, no tracing, no breadcrumbs, and names the service, not the host', () => {
    expect(opts.sendDefaultPii).toBe(false);
    expect('tracesSampleRate' in opts).toBe(false);
    expect(opts.defaultIntegrations).toBe(false);
    expect(opts.skipOpenTelemetrySetup).toBe(true);
    expect(opts.registerEsmLoaderHooks).toBe(false);
    expect(opts.maxBreadcrumbs).toBe(0);
    expect(opts.serverName).toBe('api');
    expect(opts.release).toBe('abc');
  });

  it('beforeSend scrubs bodies, headers, users, phone numbers, emails and SQL parameters', () => {
    const event = opts.beforeSend({
      user: { email: 'ravi@example.com' },
      request: { url: 'https://api.mechdost.com/v1/me?phone=9876543210', data: '{"phone":"+919876543210"}' },
      exception: {
        values: [{ type: 'Error', value: 'Failed query: select 1\nparams: +919876543210,ravi@example.com' }],
      },
      extra: { email: 'ravi@example.com', count: 1 },
    });
    expect(JSON.stringify(event)).not.toMatch(/9876543210|ravi@/u);
    expect(event.exception.values[0]?.value).toBe('Failed query [redacted]');
    expect(event.request).toEqual({ url: 'https://api.mechdost.com/v1/me' });
  });
});

describe('logged errors reach Sentry, throttled', () => {
  afterEach(() => {
    setErrorHook(null);
    setLogSink((line) => process.stdout.write(`${line}\n`));
  });

  it('reports each error message at most once per window, never request lines or handled exceptions', () => {
    const sent: { name: string; fields: Record<string, unknown> }[] = [];
    let now = 0;
    setLogSink(() => undefined);
    setErrorHook(
      errorHookFor(
        (name, fields) => sent.push({ name, fields }),
        () => now,
      ),
    );
    log('error', 'assignment_expiry_failed', { errorName: 'Error', assignmentId: 'a1' });
    log('error', 'assignment_expiry_failed', { errorName: 'Error', assignmentId: 'a2' });
    log('error', 'request', { status: 500 });
    log('error', 'unhandled_error', { errorName: 'TypeError' });
    log('warn', 'something_odd', {});
    expect(sent.map((s) => s.name)).toEqual(['assignment_expiry_failed']);
    now += 10 * 60_000 + 1;
    log('error', 'assignment_expiry_failed', { errorName: 'Error' });
    expect(sent).toHaveLength(2);
  });
});

const row = (over: Partial<ForwardableEvent> = {}): ForwardableEvent => ({
  id: '019a8f00-0000-7000-8000-000000000001',
  occurredAt: new Date('2026-11-14T10:00:00.000Z'),
  source: 'web',
  event: 'add_to_cart',
  userId: null,
  anonymousId: 'a0f1c7a2-0000-4000-8000-000000000001',
  sessionId: '0123456789abcdef0123456789abcdef',
  cityId: null,
  page: '/shop',
  props: { slug: 'castrol-activ-4t', qty: 1 },
  consentVersion: '2026-11-14',
  cursor: { receivedAt: '2026-11-14 10:00:01.000017+00', id: '019a8f00-0000-7000-8000-000000000001' },
  ...over,
});
const WEB = 'https://mechdost.com';

describe('PostHog payload', () => {
  it('web events: the visitor id, personless, no GeoIP, the path only', () => {
    expect(toPosthogEvent(row(), WEB)).toEqual({
      event: 'add_to_cart',
      distinct_id: 'a0f1c7a2-0000-4000-8000-000000000001',
      timestamp: '2026-11-14T10:00:00.000Z',
      uuid: '019a8f00-0000-7000-8000-000000000001',
      properties: {
        slug: 'castrol-activ-4t',
        qty: 1,
        $process_person_profile: false,
        $geoip_disable: true,
        $lib: 'mechdost-forwarder',
        source: 'web',
        session_id: '0123456789abcdef0123456789abcdef',
        consent_version: '2026-11-14',
        $pathname: '/shop',
        $current_url: 'https://mechdost.com/shop',
      },
    });
  });

  it('page views become $pageview so PostHog web analytics works', () => {
    const e = toPosthogEvent(row({ event: 'page_view', props: { path: '/shop', locale: 'hi' } }), WEB);
    expect(e?.event).toBe('$pageview');
    expect(e?.properties).toMatchObject({ locale: 'hi', $pathname: '/shop', mechdost_event: 'page_view' });
  });

  it('consent gate: web events without consent, or consented before the notice named PostHog, are never sent', () => {
    expect(toPosthogEvent(row({ consentVersion: null }), WEB)).toBeNull();
    expect(toPosthogEvent(row({ consentVersion: '2026-11' }), WEB)).toBeNull();
    expect(toPosthogEvent(row({ anonymousId: null }), WEB)).toBeNull();
  });

  it('server events carry no user: one fixed id, the city and business codes only', () => {
    const e = toPosthogEvent(
      row({
        source: 'server',
        event: 'purchase',
        userId: '019a0000-0000-7000-8000-00000000abcd',
        anonymousId: null,
        sessionId: null,
        page: null,
        consentVersion: null,
        cityId: '019a0000-0000-7000-8000-00000000c1c1',
        props: { orderCode: 'MD-RPR-2026-7K2M9Q', totalPaise: 120000, customerId: 'u1' },
      }),
      WEB,
    );
    expect(e?.distinct_id).toBe('mechdost-server');
    expect(JSON.stringify(e)).not.toContain('019a0000-0000-7000-8000-00000000abcd');
    expect(e?.properties).toMatchObject({
      orderCode: 'MD-RPR-2026-7K2M9Q',
      totalPaise: 120000,
      city_id: '019a0000-0000-7000-8000-00000000c1c1',
    });
    expect(e?.properties).not.toHaveProperty('customerId');
  });

  it('strips phone, email, name, address and free text from props, whatever the key or nesting', () => {
    expect(
      scrubProps({
        phone: '9876543210',
        contactEmail: 'a@b.co',
        name: 'Ravi',
        shopName: 'Sahu Motors',
        address: 'House 12',
        query: 'battery 9876543210',
        note: 'call me',
        message: 'hi',
        lat: 21.25,
        lng: 81.63,
        userId: 'u1',
        sku: 'CAS-ACT4T-0900',
        hidden: 'mail me at x@y.in',
        sneaky: '98765 43210',
        long: 'x'.repeat(300),
        nested: { email: 'a@b.co', ok: 'fine', deeper: { phone: '1' } },
        list: ['ok', 'a@b.co'],
        count: 2,
        flag: true,
      }),
    ).toEqual({
      sku: 'CAS-ACT4T-0900',
      query_length: 18,
      nested: { ok: 'fine', deeper: {} },
      list: ['ok'],
      count: 2,
      flag: true,
    });
  });
});

/** Fixed UUID v7 sample (time-ordered ids are full of digit runs that look like phone numbers to the mask). */
function uuidV7Sample(n: number): string[] {
  let seed = 0x2f6b1d3;
  const hex = (len: number) => {
    let out = '';
    for (let i = 0; i < len; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      out += (seed % 16).toString(16);
    }
    return out;
  };
  return Array.from(
    { length: n },
    () =>
      `${hex(8)}-${hex(4)}-7${hex(3)}-${'89ab'[Number.parseInt(hex(1), 16) % 4] ?? '8'}${hex(3)}-${hex(12)}`,
  );
}

describe('PostHog props keep pseudonymous ids (review 2026-11-14)', () => {
  it('every UUID v7 and public code survives; phone numbers still go', () => {
    const ids = [
      '01a1db2d-e45a-7f47-8659-9433601cf99d',
      '019a8f00-0000-7000-8000-000000000001',
      ...uuidV7Sample(200),
    ];
    for (const id of ids) expect(scrubProps({ shopId: id })).toEqual({ shopId: id });
    for (const code of [
      'MD-RPR-2026-234567',
      'SR-RPR-2026-7K2M9Q',
      'REQ-RPR-2026-000001',
      'QT-RPR-2026-99999Z',
    ])
      expect(scrubProps({ orderCode: code })).toEqual({ orderCode: code });
    expect(scrubProps({ ids: ['01a1db2d-e45a-7f47-8659-9433601cf99d', '9876543210'] })).toEqual({
      ids: ['01a1db2d-e45a-7f47-8659-9433601cf99d'],
    });
    expect(scrubProps({ ref: '98765 43210', other: '+91-9876543210' })).toEqual({});
  });
});

const ok = () => new Response('{"status":"Ok"}', { status: 200 });

describe('PostHog sender', () => {
  const events: PosthogEvent[] = [toPosthogEvent(row(), WEB)!];

  it('posts one batch to {host}/batch/ with the project key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(ok()));
    const sender = createPosthogSender({ host: 'https://eu.i.posthog.com', key: KEY, fetchImpl });
    expect(await sender.send(events)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    expect(JSON.parse(init?.body as string)).toEqual({ api_key: KEY, batch: events });
  });

  it('retries network errors and 5xx/429 a bounded number of times, then gives up without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('ECONNRESET')));
    const sleep = vi.fn(() => Promise.resolve());
    const sender = createPosthogSender({ host: 'https://eu.i.posthog.com', key: KEY, fetchImpl, sleep });
    expect(await sender.send(events)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const flaky = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok());
    expect(
      await createPosthogSender({ host: 'https://x.io', key: KEY, fetchImpl: flaky, sleep }).send(events),
    ).toBe(true);
  });

  it('a 4xx (bad key, bad payload) is not retried', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 401 })));
    const sender = createPosthogSender({
      host: 'https://x.io',
      key: KEY,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(await sender.send(events)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('PostHog forwarder', () => {
  const rows = (n: number, start = 0) =>
    Array.from({ length: n }, (_, i) =>
      row({
        id: `019a8f00-0000-7000-8000-${String(start + i).padStart(12, '0')}`,
        cursor: { receivedAt: `t${start + i}`, id: `id${start + i}` },
      }),
    );

  it('sends consented rows in batches, skips the rest, and moves the cursor', async () => {
    const reads: unknown[] = [];
    const data = [...rows(3), row({ id: 'x', consentVersion: null, cursor: { receivedAt: 't9', id: 'x' } })];
    const sent: PosthogEvent[][] = [];
    const fwd = startPosthogForwarder({
      read: (after, limit) => {
        reads.push(after);
        return Promise.resolve(after ? [] : data.slice(0, limit));
      },
      sender: { send: (b) => (sent.push(b), Promise.resolve(true)) },
      webBaseUrl: WEB,
      intervalMs: 0,
      batchSize: 10,
      sendSize: 2,
      log: () => undefined,
    });
    const stats = await fwd.tick();
    expect(sent.map((b) => b.length)).toEqual([2, 1]);
    expect(stats).toMatchObject({ forwarded: 3, skipped: 1, dropped: 0 });
    // A short page ends the tick; the next one reads after the last row (also the skipped one).
    await fwd.tick();
    await fwd.stop();
    expect(reads).toEqual([null, { receivedAt: 't9', id: 'x' }]);
    expect(fwd.totals()).toMatchObject({ forwarded: 3, skipped: 1 });
  });

  it('a failed send drops that batch with a count and a log line, moves on, and never throws', async () => {
    const logs: string[] = [];
    let calls = 0;
    const fwd = startPosthogForwarder({
      read: (after) => Promise.resolve(after ? [] : rows(2)),
      sender: { send: () => Promise.resolve(++calls > 1) },
      webBaseUrl: WEB,
      intervalMs: 0,
      batchSize: 10,
      sendSize: 1,
      log: (_s, m) => logs.push(m),
    });
    const stats = await fwd.tick();
    await fwd.stop();
    expect(stats).toMatchObject({ forwarded: 1, dropped: 1 });
    expect(logs).toContain('posthog_batch_dropped');
  });

  it('a row that cannot be converted is skipped (cursor moves on); a throwing sender never kills the worker', async () => {
    const logs: string[] = [];
    const poison = row({ id: 'p', occurredAt: new Date(Number.NaN), cursor: { receivedAt: 't0', id: 'p' } });
    const reads: unknown[] = [];
    const fwd = startPosthogForwarder({
      read: (after) => (reads.push(after), Promise.resolve(after ? [] : [poison, ...rows(1, 1)])),
      sender: { send: () => Promise.reject(new Error('boom')) },
      webBaseUrl: WEB,
      intervalMs: 0,
      log: (_s, m) => logs.push(m),
    });
    // A sender that throws counts as a dropped batch.
    await expect(fwd.tick()).resolves.toMatchObject({ forwarded: 0, dropped: 1, skipped: 1 });
    // Anything unexpected inside a tick is logged, never an unhandled rejection (which would end the worker).
    const broken = startPosthogForwarder({
      read: () => Promise.resolve(null as unknown as []),
      sender: { send: () => Promise.resolve(true) },
      webBaseUrl: WEB,
      intervalMs: 0,
      log: (_s, m) => logs.push(m),
    });
    await expect(broken.tick()).resolves.toMatchObject({ forwarded: 0 });
    expect(logs).toContain('posthog_tick_failed');
    await broken.stop();
    const safe = startPosthogForwarder({
      read: (after) => (reads.push(after), Promise.resolve(after ? [] : [poison, ...rows(1, 1)])),
      sender: { send: () => Promise.resolve(true) },
      webBaseUrl: WEB,
      intervalMs: 0,
      log: (_s, m) => logs.push(m),
    });
    await expect(safe.tick()).resolves.toMatchObject({ forwarded: 1, skipped: 1 });
    await safe.tick();
    expect(reads.at(-1)).toEqual({ receivedAt: 't1', id: 'id1' });
    expect(logs).toContain('posthog_row_skipped');
    await fwd.stop();
    await safe.stop();
  });

  it('a failed read keeps the cursor and logs, without throwing', async () => {
    const logs: string[] = [];
    const fwd = startPosthogForwarder({
      read: () => Promise.reject(new Error('db down')),
      sender: { send: () => Promise.resolve(true) },
      webBaseUrl: WEB,
      intervalMs: 0,
      log: (_s, m) => logs.push(m),
    });
    await expect(fwd.tick()).resolves.toMatchObject({ forwarded: 0 });
    await fwd.stop();
    expect(logs).toContain('posthog_read_failed');
  });
});
