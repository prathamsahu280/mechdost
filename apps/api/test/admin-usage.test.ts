/**
 * Usage & limits (founder 2026-11-26; spec 08): provider adapters against fakes (R2 listing with pagination, 403,
 * page cap; Cloudflare analytics; disk and memory), the counting media host, and the admin routes (roles, Check now
 * with its rate limit, versioned edits, no secret in any answer).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { createUsageCounter, countingMediaHost } from '../src/usage/counter';
import { measureR2, parseListPage, r2OperationsThisMonth } from '../src/usage/r2';
import { measureServer, type ServerProbes } from '../src/usage/server';
import type { UsageSources } from '../src/usage/check';
import type { MediaHost } from '../src/ustaad/media/host';
import { loadConfig } from '../src/config';
import { bearer, buildApp } from './helpers';

const SECRET = 'r2-secret-key-0123456789abcdef0123456789abcdef';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const creds = { accessKeyId: 'AKIAEXAMPLEKEY0001', secretAccessKey: SECRET };

const page = (sizes: number[], next: string | null) =>
  `<?xml version="1.0"?><ListBucketResult>${sizes
    .map((n, i) => `<Contents><Key>k${String(i)}</Key><Size>${String(n)}</Size></Contents>`)
    .join('')}<IsTruncated>${next ? 'true' : 'false'}</IsTruncated>${
    next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''
  }</ListBucketResult>`;

const probes = (over: Partial<ServerProbes> = {}): ServerProbes => ({
  statfs: () => Promise.resolve({ blocks: 1000, bsize: 4096, bavail: 300, bfree: 400 }),
  meminfo: () => Promise.resolve('MemTotal:        2048000 kB\nMemAvailable:     512000 kB\n'),
  os: () => ({ total: 1, free: 1 }),
  ...over,
});

describe('R2 listing', () => {
  it('reads sizes, truncation and an XML-escaped continuation token', () => {
    expect(parseListPage(page([1, 2], 'a&amp;b'))).toEqual({ sizes: [1, 2], truncated: true, next: 'a&b' });
  });

  it('follows pages per bucket, counts each list call, never puts the secret in a URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>((url) => {
      const u = new URL(url);
      expect(u.searchParams.get('list-type')).toBe('2');
      expect(url as string).not.toContain(SECRET);
      if (u.pathname === '/one' && !u.searchParams.get('continuation-token'))
        return Promise.resolve(new Response(page([100, 200], 'tok+1')));
      if (u.pathname === '/one') {
        expect(u.searchParams.get('continuation-token')).toBe('tok+1');
        return Promise.resolve(new Response(page([300], null)));
      }
      return Promise.resolve(new Response(page([5], null)));
    });
    const r = await measureR2(
      { accountId: ACCOUNT, credentials: creds, buckets: ['one', 'two'], endpoint: 'https://r2.test' },
      fetchImpl,
    );
    expect(r).toEqual({ status: 'ok', bytes: 605, objects: 4, listCalls: 3 });
  });

  it('a refused bucket fails the provider (no partial number)', async () => {
    const r = await measureR2(
      { accountId: ACCOUNT, credentials: creds, buckets: ['one'], endpoint: 'https://r2.test' },
      () => Promise.resolve(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })),
    );
    expect(r.status).toBe('failed');
  });

  it('past the page cap the result is partial', async () => {
    const r = await measureR2(
      { accountId: ACCOUNT, credentials: creds, buckets: ['one'], endpoint: 'https://r2.test' },
      () => Promise.resolve(new Response(page([10], 'more'))),
      { maxPagesPerBucket: 3 },
    );
    expect(r).toMatchObject({ status: 'partial', bytes: 30, listCalls: 3 });
  });

  it('Cloudflare analytics: Class A and B summed by action, free ones ignored', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  r2OperationsAdaptiveGroups: [
                    { sum: { requests: 10 }, dimensions: { actionType: 'PutObject' } },
                    { sum: { requests: 5 }, dimensions: { actionType: 'ListObjectsV2' } },
                    { sum: { requests: 70 }, dimensions: { actionType: 'GetObject' } },
                    { sum: { requests: 9 }, dimensions: { actionType: 'DeleteObject' } },
                  ],
                },
              ],
            },
          },
        }),
      ),
    );
    const r = await r2OperationsThisMonth(
      { accountId: ACCOUNT, token: 'cf-token-abcdefghijklmnopqrst', now: new Date('2026-11-26T00:00:00Z') },
      fetchImpl,
    );
    expect(r).toEqual({ classA: 15, classB: 70 });
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string) as { variables: { start: string } };
    expect(body.variables.start).toBe('2026-11-01T00:00:00.000Z');
    expect(
      await r2OperationsThisMonth({ accountId: ACCOUNT, token: 'x'.repeat(30), now: new Date() }, () =>
        Promise.resolve(Response.json({ errors: [{ message: 'no' }] })),
      ),
    ).toBeNull();
  });
});

describe('server disk and memory', () => {
  it('disk used = total minus free; memory from MemAvailable', async () => {
    const r = await measureServer('/', probes());
    expect(r.disk).toEqual({ used: 600 * 4096, total: 1000 * 4096 });
    expect(r.memory).toEqual({ used: (2048000 - 512000) * 1024, total: 2048000 * 1024 });
    expect(r.status).toBe('ok');
  });

  it('without /proc/meminfo memory falls back to os; a disk failure makes it partial', async () => {
    const r = await measureServer(
      '/',
      probes({
        statfs: () => Promise.reject(new Error('no')),
        meminfo: () => Promise.resolve(null),
        os: () => ({ total: 100, free: 40 }),
      }),
    );
    expect(r).toEqual({ status: 'partial', disk: null, memory: { used: 60, total: 100 } });
  });
});

describe('counting media host', () => {
  const fake = (): MediaHost =>
    ({
      id: 'r2',
      maxFileBytes: 1,
      supportsMultipart: true,
      presignPut: () => Promise.resolve({ url: 'u', headers: {}, method: 'PUT' as const }),
      presignGet: () => Promise.resolve('u'),
      head: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
    }) as unknown as MediaHost;

  it('counts uploads as Class A, reads as Class B, deletes as nothing', async () => {
    const counter = createUsageCounter(() => new Date('2026-11-26T00:00:00Z'));
    const host = countingMediaHost(fake(), counter);
    await host.presignPut('quarantine', 'k', { mime: 'image/webp', bytes: 1 }, 60);
    await host.presignGet('media', 'k', 60);
    await host.head('media', 'k');
    await host.remove('media', 'k');
    expect(counter.pending()).toEqual({ r2_class_a_ops_month_count: 1, r2_class_b_ops_month_count: 2 });
  });

  it('a failed flush keeps the tally for the next one', async () => {
    const counter = createUsageCounter(() => new Date('2026-11-26T00:00:00Z'));
    counter.bump('r2_class_a_ops_month_count', 4);
    await expect(counter.flush(() => Promise.reject(new Error('db down')))).rejects.toThrow();
    counter.bump('r2_class_a_ops_month_count');
    const seen: unknown[] = [];
    await counter.flush((period, d) => {
      seen.push([period, d]);
      return Promise.resolve();
    });
    expect(seen).toEqual([['2026-11', { r2_class_a_ops_month_count: 5 }]]);
    expect(counter.pending()).toEqual({});
  });
});

describe('config', () => {
  const base = { DATABASE_POOL_URL: 'postgres://x' };
  it('the analytics token is optional and the disk path defaults to /', () => {
    expect(loadConfig(base).usage).toEqual({ cloudflareAnalyticsToken: null, diskPath: '/' });
    expect(() => loadConfig({ ...base, USAGE_DISK_PATH: 'relative' })).toThrow(/USAGE_DISK_PATH/);
    expect(() => loadConfig({ ...base, CLOUDFLARE_ANALYTICS_TOKEN: 'bad token!' })).toThrow(
      /CLOUDFLARE_ANALYTICS_TOKEN/,
    );
  });
});

describe('/v1/admin/usage', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let raipur = '';
  const r2Fetch = vi.fn<typeof fetch>(() => Promise.resolve(new Response(page([7_500_000_000], null))));
  const sources: UsageSources = {
    r2: { accountId: ACCOUNT, credentials: creds, buckets: ['ustaad-media'], endpoint: 'https://r2.test' },
    cloudflareToken: null,
    diskPath: '/',
    emailConfigured: false,
    fetchImpl: r2Fetch,
    serverProbes: probes(),
  };

  async function person(n: string, role: 'super_admin' | 'ops_manager' | 'city_manager' | 'finance' | null) {
    const phone = `+9198666666${n}`;
    const token = ctx.verifier.add(`token-usage-0000000${n}`, {
      firebaseUid: `us-${n}`,
      phone,
      email: `us-${n}@example.com`,
      emailVerified: true,
    });
    const user = await ensureUser(ctx.db, {
      firebaseUid: `us-${n}`,
      phone,
      email: `us-${n}@example.com`,
      emailVerified: true,
    });
    if (role)
      await grantRole(ctx.db, {
        userId: user.id,
        role,
        cityId: role === 'city_manager' ? raipur : null,
        grantedBy: null,
      }).catch(() => undefined);
    return bearer(token);
  }

  beforeAll(async () => {
    ctx = await buildApp({ usageSources: sources });
    const existing = await ctx.db.select().from(s.cities);
    if (existing[0]) raipur = existing[0].id;
    else {
      const [state] = await ctx.db
        .insert(s.states)
        .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
        .returning();
      const [city] = await ctx.db
        .insert(s.cities)
        .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
        .returning();
      raipur = city!.id;
    }
  });

  it('super admin and operations manager read it; only the super admin may edit', async () => {
    const sup = await ctx.app.request('/v1/admin/usage', { headers: await person('01', 'super_admin') });
    expect(sup.status).toBe(200);
    expect(sup.headers.get('cache-control')).toBe('no-store');
    expect(((await sup.json()) as { canEdit: boolean }).canEdit).toBe(true);
    const ops = await ctx.app.request('/v1/admin/usage', { headers: await person('02', 'ops_manager') });
    expect(ops.status).toBe(200);
    expect(((await ops.json()) as { canEdit: boolean }).canEdit).toBe(false);
  });

  it('a city manager gets 404, finance and customers 403, strangers 401', async () => {
    const get = async (h?: Record<string, string>) =>
      (await ctx.app.request('/v1/admin/usage', h ? { headers: h } : {})).status;
    expect(await get(await person('03', 'city_manager'))).toBe(404);
    expect(await get(await person('04', 'finance'))).toBe(403);
    expect(await get(await person('05', null))).toBe(403);
    expect(await get()).toBe(401);
  });

  it('Check now measures, stores, raises the 70 % alert and returns the view without secrets', async () => {
    const res = await ctx.app.request('/v1/admin/usage/check', {
      method: 'POST',
      headers: await person('02', 'ops_manager'),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('AKIAEXAMPLEKEY0001');
    const body = JSON.parse(text) as {
      stored: number;
      alerts: number;
      usage: {
        providers: { provider: string; status: string }[];
        metrics: { code: string; value: number | null; level: string; source: string | null }[];
      };
    };
    expect(body.alerts).toBe(1);
    const r2 = body.usage.metrics.find((m) => m.code === 'r2_storage_bytes');
    expect(r2).toMatchObject({ value: 7_500_000_000, level: 'warn', source: 'measured' });
    const classA = body.usage.metrics.find((m) => m.code === 'r2_class_a_ops_month_count');
    expect(classA).toMatchObject({ value: 1, source: 'estimated' });
    expect(body.usage.providers.find((p) => p.provider === 'resend')?.status).toBe('not_configured');
    const runs = await ctx.db.select().from(s.usageRuns);
    expect(runs.at(-1)).toMatchObject({ trigger: 'manual' });
  });

  it('Check now is rate-limited per person', async () => {
    const h = await person('06', 'super_admin');
    let last = 0;
    for (let i = 0; i < 6; i += 1)
      last = (await ctx.app.request('/v1/admin/usage/check', { method: 'POST', headers: h })).status;
    expect(last).toBe(200);
    const over = await ctx.app.request('/v1/admin/usage/check', { method: 'POST', headers: h });
    expect(over.status).toBe(429);
  });

  it('limits: super admin saves (versioned), operations manager is refused, bad input is refused', async () => {
    const sup = await person('01', 'super_admin');
    const put = (h: Record<string, string>, body: unknown, metric = 'supabase_db_bytes') =>
      ctx.app.request(`/v1/admin/usage/limits/${metric}`, {
        method: 'PUT',
        headers: { ...h, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(
      (await put(await person('02', 'ops_manager'), { limit: 5, alerts: true, expectedVersion: null }))
        .status,
    ).toBe(403);
    const ok = await put(sup, { limit: 8_000_000_000, alerts: true, expectedVersion: null });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ version: 1 });
    expect((await put(sup, { limit: 1, alerts: true, expectedVersion: null })).status).toBe(409);
    expect((await put(sup, { limit: -1, alerts: true, expectedVersion: 1 })).status).toBe(400);
    expect((await put(sup, { limit: 1, alerts: true, expectedVersion: 1, extra: 1 })).status).toBe(400);
    expect((await put(sup, { limit: 1, alerts: true, expectedVersion: 1 }, 'nope')).status).toBe(400);
  });

  it('alert settings: ordered thresholds and valid addresses only', async () => {
    const sup = await person('01', 'super_admin');
    const view = (await (await ctx.app.request('/v1/admin/usage', { headers: sup })).json()) as {
      config: { version: number };
    };
    const put = (body: unknown) =>
      ctx.app.request('/v1/admin/usage/alerts', {
        method: 'PUT',
        headers: { ...sup, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const base = {
      warnPct: 60,
      criticalPct: 85,
      recipients: [],
      emailLocale: 'hi',
      expectedVersion: view.config.version,
    };
    expect((await put({ ...base, warnPct: 90 })).status).toBe(400);
    expect((await put({ ...base, recipients: ['not-an-email'] })).status).toBe(400);
    const ok = await put({ ...base, recipients: ['owner@example.com'] });
    expect(ok.status).toBe(200);
    expect((await put(base)).status).toBe(409);
  });
});
