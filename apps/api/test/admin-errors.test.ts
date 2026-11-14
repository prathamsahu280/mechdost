/**
 * Admin → Errors (decision 2026-11-14, spec 08): super admin and operations manager (all-cities `settings:read`)
 * see the latest unresolved Sentry issues; a city manager, a customer or a stranger does not. Only counts and links
 * leave the server (no user emails, IPs or payloads), titles are scrubbed, the read token is never echoed, and
 * without a token the answer says "not connected".
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import {
  createSentryIssuesClient,
  toIssue,
  type SentryIssuesSettings,
} from '../src/monitoring/sentry-issues';
import { loadConfig } from '../src/config';
import { bearer, buildApp } from './helpers';

const TOKEN = 'sntryu_0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';
const settings: SentryIssuesSettings = {
  token: TOKEN,
  org: 'mechdost',
  projects: { web: 'mechdost-api', api: 'mechdost-api-actual' },
  baseUrl: 'https://de.sentry.io',
  environment: 'production',
};

const sentryIssue = (over: Record<string, unknown> = {}) => ({
  id: '4500000001',
  shortId: 'MECHDOST-API-1A',
  title: 'TypeError: cannot read map of undefined for ravi@example.com 9876543210',
  culprit: '/v1/me',
  level: 'error',
  count: '42',
  userCount: 7,
  firstSeen: '2026-11-13T10:00:00Z',
  lastSeen: '2026-11-14T09:00:00Z',
  permalink: 'https://mechdost.sentry.io/issues/4500000001/',
  stats: {
    '24h': [
      [1, 2],
      [2, 3],
    ],
  },
  // Things Sentry may send that must never be forwarded:
  metadata: { value: 'phone 9876543210' },
  assignedTo: { email: 'owner@mechdost.com' },
  ...over,
});

describe('Sentry issue mapping', () => {
  it('keeps only counts, dates and a sentry.io link; scrubs the title', () => {
    expect(toIssue(sentryIssue(), settings)).toEqual({
      id: '4500000001',
      shortId: 'MECHDOST-API-1A',
      title: 'TypeError: cannot read map of undefined for # #',
      level: 'error',
      count24h: 5,
      countTotal: 42,
      usersAffected: 7,
      firstSeen: '2026-11-13T10:00:00Z',
      lastSeen: '2026-11-14T09:00:00Z',
      link: 'https://mechdost.sentry.io/issues/4500000001/',
    });
  });

  it('never links outside sentry.io, and unknown levels read as error', () => {
    const i = toIssue(sentryIssue({ permalink: 'https://evil.example.com/x', level: 'weird' }), settings);
    expect(i?.link).toBe('https://de.sentry.io/organizations/mechdost/issues/4500000001/');
    expect(i?.level).toBe('error');
    expect(toIssue({ id: 'not-a-number' }, settings)).toBeNull();
  });

  it('reads both projects from the EU region with the token, caches for 60 s, survives a failing project', async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>((url) =>
      Promise.resolve(
        (url as string).includes('mechdost-api-actual')
          ? new Response('nope', { status: 500 })
          : Response.json([sentryIssue()]),
      ),
    );
    const client = createSentryIssuesClient(settings, { fetchImpl, now: () => now });
    const first = await client.list();
    expect(first.projects.map((p) => [p.project, p.ok, p.issues.length])).toEqual([
      ['web', true, 1],
      ['api', false, 0],
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url as string).toMatch(
      /^https:\/\/de\.sentry\.io\/api\/0\/projects\/mechdost\/mechdost-api\/issues\/\?query=is%3Aunresolved\+environment%3Aproduction&statsPeriod=24h$/u,
    );
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    now += 10_000;
    await client.list();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // cached (a failed project shortens the cache to 15 s)
    now += 10_000;
    await client.list();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('config: connected only with token, org and a project; the region defaults to the EU', () => {
    const base = { DATABASE_POOL_URL: 'postgres://x' };
    expect(loadConfig(base).sentryIssues).toBeNull();
    expect(loadConfig({ ...base, SENTRY_API_TOKEN: TOKEN, SENTRY_ORG: 'mechdost' }).sentryIssues).toBeNull();
    expect(
      loadConfig({
        ...base,
        SENTRY_API_TOKEN: TOKEN,
        SENTRY_ORG: 'mechdost',
        SENTRY_PROJECT_API: 'mechdost-api-actual',
      }).sentryIssues,
    ).toMatchObject({ baseUrl: 'https://de.sentry.io', projects: { web: null, api: 'mechdost-api-actual' } });
    expect(() => loadConfig({ ...base, SENTRY_REGION_URL: 'https://evil.example.com' })).toThrow(
      /SENTRY_REGION_URL/,
    );
    // Internal Integration tokens are 64 hex characters without a prefix.
    const hex = 'a1b2c3d4'.repeat(8);
    expect(
      loadConfig({
        ...base,
        SENTRY_API_TOKEN: hex,
        SENTRY_ORG: 'mechdost',
        SENTRY_PROJECT_WEB: 'mechdost-api',
      }).sentryIssues?.token,
    ).toBe(hex);
  });
});

describe('GET /v1/admin/errors', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let bare: Awaited<ReturnType<typeof buildApp>>;
  let raipur = '';
  const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(Response.json([sentryIssue()])));

  async function person(
    app: typeof ctx,
    n: string,
    role: 'super_admin' | 'ops_manager' | 'city_manager' | null,
  ) {
    const phone = `+9198555555${n}`;
    const token = app.verifier.add(`token-errors-00000${n}`, {
      firebaseUid: `er-${n}`,
      phone,
      email: `er-${n}@example.com`,
      emailVerified: true,
    });
    const user = await ensureUser(app.db, {
      firebaseUid: `er-${n}`,
      phone,
      email: `er-${n}@example.com`,
      emailVerified: true,
    });
    if (role)
      await grantRole(app.db, {
        userId: user.id,
        role,
        cityId: role === 'city_manager' ? raipur : null,
        grantedBy: null,
      }).catch(() => undefined);
    return bearer(token);
  }

  beforeAll(async () => {
    ctx = await buildApp({ sentryIssues: createSentryIssuesClient(settings, { fetchImpl }) });
    bare = await buildApp();
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

  it('super admin and operations manager see issues: counts and links, no PII, no token', async () => {
    for (const [n, role] of [
      ['01', 'super_admin'],
      ['02', 'ops_manager'],
    ] as const) {
      const res = await ctx.app.request('/v1/admin/errors', { headers: await person(ctx, n, role) });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      expect(text).not.toMatch(/ravi@|9876543210|owner@mechdost|sntryu_|metadata|assignedTo/u);
      const body = JSON.parse(text) as {
        connected: boolean;
        projects: { issues: { countTotal: number }[] }[];
      };
      expect(body.connected).toBe(true);
      expect(body.projects[0]?.issues[0]?.countTotal).toBe(42);
    }
  });

  it('a city manager, a customer and a stranger are refused', async () => {
    expect(
      (await ctx.app.request('/v1/admin/errors', { headers: await person(ctx, '03', 'city_manager') }))
        .status,
    ).toBe(404);
    expect(
      (await ctx.app.request('/v1/admin/errors', { headers: await person(ctx, '04', null) })).status,
    ).toBe(403);
    expect((await ctx.app.request('/v1/admin/errors')).status).toBe(401);
  });

  it('without a read token the answer is "not connected" and nothing is fetched', async () => {
    const calls = fetchImpl.mock.calls.length;
    const res = await bare.app.request('/v1/admin/errors', {
      headers: await person(bare, '05', 'super_admin'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false, environment: null, fetchedAt: null, projects: [] });
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });
});
