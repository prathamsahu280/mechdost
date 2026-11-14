/**
 * Admin analytics over HTTP (spec 08 "Analytics"): `analytics:read` and verified staff only; city-scoped staff see
 * only their cities (another city is 404) and no site-wide traffic; ranges are IST dates, at most 180 days; answers
 * are cached privately for a short time. The Overview queue counts follow each queue's own read permission.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminOverviewDto, AnalyticsDashboardDto } from '@mechdost/shared/admin-analytics-api';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const F: Record<string, string> = {};
let n = 0;

async function person(
  role: 'super_admin' | 'support_agent' | 'city_manager' | null,
  cityId: string | null = null,
  verified = true,
) {
  n += 1;
  const id = String(n).padStart(2, '0');
  const phone = `+9198444444${id}`;
  const token = ctx.verifier.add(`token-analytics-0000${id}`, {
    firebaseUid: `an-${id}`,
    phone,
    email: `an-${id}@example.com`,
    emailVerified: verified,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `an-${id}`,
    phone,
    email: `an-${id}@example.com`,
    emailVerified: verified,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { id: user.id, headers: bearer(token) };
}

async function order(cityId: string, userId: string, at: string) {
  n += 1;
  const code = `MD-RPR-2026-AP${String(n).padStart(4, '0')}`;
  const [g] = await ctx.db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 40000,
      totalPaise: 40000,
      idempotencyKey: `analytics-api-${String(n).padStart(8, '0')}`,
      createdAt: new Date(at),
    })
    .returning();
  await ctx.db.insert(s.orders).values({
    groupId: g!.id,
    subNo: 1,
    code: `${code}-1`,
    userId,
    cityId,
    status: 'placed',
    shippingAddress: { line1: 'Sarona', pincode: '492001' },
    pincode: '492001',
    subtotalPaise: 40000,
    totalPaise: 40000,
    placedAt: new Date(at),
  });
}

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const dashboard = (q = '') => `/v1/admin/analytics/dashboard${q}`;

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({
      stateId: state!.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      nameHi: 'रायपुर',
      status: 'live',
    })
    .returning();
  const [bhilai] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'BHI', slug: 'bhilai', name: 'Bhilai', status: 'live' })
    .returning();
  F.raipur = raipur!.id;
  F.bhilai = bhilai!.id;
  const buyer = await person(null);
  // Two orders today (IST) in Raipur, one in Bhilai.
  const now = new Date().toISOString();
  await order(F.raipur, buyer.id, now);
  await order(F.raipur, buyer.id, now);
  await order(F.bhilai, buyer.id, now);
});

describe('GET /admin/analytics/dashboard', () => {
  it('needs signing in, verification and analytics:read', async () => {
    expect((await ctx.app.request(dashboard())).status).toBe(401);
    const agent = await person('support_agent');
    const denied = await ctx.app.request(dashboard(), { headers: agent.headers });
    expect(denied.status).toBe(403);
    const unverified = await person('super_admin', null, false);
    const res = await ctx.app.request(dashboard(), { headers: unverified.headers });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorJson).error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('gives an all-cities admin every city, site traffic and a private short cache', async () => {
    const admin = await person('super_admin');
    const res = await ctx.app.request(dashboard(), { headers: admin.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    const body = AnalyticsDashboardDto.parse(await res.json());
    expect(body.range).toMatchObject({ to: today(), days: 30 });
    expect(body.city).toBeNull();
    expect(body.cities.map((c) => c.code)).toEqual(['BHI', 'RPR']);
    expect(body.kpis.ordersPlaced).toBe(3);
    expect(body.traffic).not.toBeNull();
    expect(body.daily).toHaveLength(30);

    const raipur = AnalyticsDashboardDto.parse(
      await (await ctx.app.request(dashboard('?city=RPR'), { headers: admin.headers })).json(),
    );
    expect(raipur.city).toBe('RPR');
    expect(raipur.kpis.ordersPlaced).toBe(2);
  });

  it('keeps a city manager to their city: no traffic, another city is 404', async () => {
    const manager = await person('city_manager', F.bhilai);
    const body = AnalyticsDashboardDto.parse(
      await (await ctx.app.request(dashboard(), { headers: manager.headers })).json(),
    );
    expect(body.cities).toEqual([{ code: 'BHI', name: 'Bhilai', nameHi: null }]);
    expect(body.kpis.ordersPlaced).toBe(1);
    expect(body.traffic).toBeNull();
    expect(body.topSearches).toBeNull();
    const other = await ctx.app.request(dashboard('?city=RPR'), { headers: manager.headers });
    expect(other.status).toBe(404);
    expect((await ctx.app.request(dashboard('?city=XYZ'), { headers: manager.headers })).status).toBe(404);
  });

  it('validates the range: IST dates, from ≤ to, at most 180 days, unknown parameters refused', async () => {
    const admin = await person('super_admin');
    const code = async (q: string) => {
      const res = await ctx.app.request(dashboard(q), { headers: admin.headers });
      return { status: res.status, code: ((await res.json()) as ErrorJson).error.code };
    };
    expect(await code('?from=2026-11-10&to=2026-11-01')).toEqual({ status: 400, code: 'RANGE_INVALID' });
    expect(await code('?from=2025-01-01&to=2026-11-01')).toEqual({ status: 400, code: 'RANGE_TOO_LONG' });
    expect(await code('?from=11/01/2026')).toEqual({ status: 400, code: 'VALIDATION' });
    expect(await code('?city=raipur')).toEqual({ status: 400, code: 'VALIDATION' });
    expect(await code('?days=999')).toEqual({ status: 400, code: 'VALIDATION' });
    const ok = await ctx.app.request(dashboard('?from=2026-11-01&to=2026-11-07'), { headers: admin.headers });
    expect(ok.status).toBe(200);
    expect(AnalyticsDashboardDto.parse(await ok.json()).range).toEqual({
      from: '2026-11-01',
      to: '2026-11-07',
      days: 7,
    });
  });
});

describe('GET /admin/overview', () => {
  it('counts each queue only with its read permission, in the staff member’s cities', async () => {
    const agent = await person('support_agent');
    const res = await ctx.app.request('/v1/admin/overview', { headers: agent.headers });
    expect(res.status).toBe(200);
    const body = AdminOverviewDto.parse(await res.json());
    expect(body).toMatchObject({
      ordersNeedRouting: 3,
      ticketsOpen: 0,
      reviewsPending: null,
      applicationsPending: null,
      ordersToday: null,
      gmvTodayPaise: null,
    });
    const manager = await person('city_manager', F.raipur);
    const city = AdminOverviewDto.parse(
      await (await ctx.app.request('/v1/admin/overview', { headers: manager.headers })).json(),
    );
    expect(city).toMatchObject({
      ordersNeedRouting: 2,
      ordersToday: 2,
      gmvTodayPaise: 80000,
      applicationsPending: null,
    });
  });

  it('is staff only', async () => {
    const customer = await person(null);
    expect((await ctx.app.request('/v1/admin/overview', { headers: customer.headers })).status).toBe(403);
  });
});
