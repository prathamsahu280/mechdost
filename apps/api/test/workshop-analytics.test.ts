/**
 * Workshop analytics over HTTP (design 2026-11-15): admin needs `analytics:read` and stays in its cities; the portal
 * "Performance" is for the workshop owner only (staff 403, another workshop 404), never carries another workshop's
 * name, shows city medians only from three workshops with data, validates the range and answers a query over its
 * statement timeout as 503 QUERY_TIMEOUT.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorkshop, ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import {
  AdminWorkshopAnalyticsDto,
  PortalWorkshopAnalyticsDto,
} from '@mechdost/shared/workshop-analytics-api';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const F = { raipur: '', bhilai: '' };
const W = { a: '', b: '', c: '', d: '' };
let n = 0;

async function person(
  grant: { role: string; cityId?: string | null; workshopId?: string | null } | null,
  verified = true,
) {
  n += 1;
  const id = String(n).padStart(2, '0');
  const token = ctx.verifier.add(`token-wsanalytics-00${id}`, {
    firebaseUid: `wsa-${id}`,
    phone: `+9198555555${id}`,
    email: `wsa-${id}@example.com`,
    emailVerified: verified,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `wsa-${id}`,
    phone: `+9198555555${id}`,
    email: `wsa-${id}@example.com`,
    emailVerified: verified,
  });
  if (grant) await grantRole(ctx.db, { userId: user.id, grantedBy: null, ...grant });
  return { id: user.id, headers: bearer(token) };
}

async function workshop(slug: string, name: string, pincode: string) {
  const staff = await ensureUser(ctx.db, {
    firebaseUid: `wsa-admin-${slug}`,
    phone: `+9198555560${String(++n).padStart(2, '0')}`,
    email: `${slug}@example.com`,
    emailVerified: true,
  });
  const w = await createWorkshop(ctx.db, {
    scope: { all: true },
    approveScope: { all: true },
    staffUserId: staff.id,
    workshop: {
      slug,
      name,
      nameHi: `${name} हिं`,
      addressLine: 'GE Road',
      addressLineHi: 'जीई रोड',
      area: 'Shankar Nagar',
      areaHi: 'शंकर नगर',
      pincode,
      lat: 21.25,
      lng: 81.63,
      phone: '+919811199999',
      vehicleTypes: ['2W'],
      evBasic: false,
      pickup: false,
      hours: { open: '09:00', close: '19:00', days: [1, 2, 3] },
      gstin: null,
      locationVerified: true,
      published: true,
      menu: [
        {
          key: 'routine2w',
          title: 'General service (2W)',
          titleHi: 'जनरल सर्विस (2W)',
          included: null,
          includedHi: null,
          lowPaise: 80_000,
          highPaise: 150_000,
          minMinutes: 120,
          maxMinutes: 180,
          vehicleType: '2W',
          active: true,
        },
      ],
    },
  });
  return w.id;
}

async function request(workshopId: string, cityId: string, customerId: string, status = 'proposed') {
  n += 1;
  await ctx.db.insert(s.serviceRequests).values({
    code: `SR-RPR-2026-WB${String(n).padStart(4, '0')}`,
    userId: customerId,
    cityId,
    workshopId,
    routingMode: 'chosen',
    vehicleType: '2W',
    vehicleText: 'Honda Activa 6G',
    vehicleKey: 'honda activa 6g',
    services: [],
    pincode: '492001',
    preferredDate: '2026-11-20',
    preferredSlot: 'morning',
    status,
    idempotencyKey: `wsa-request-${String(n).padStart(8, '0')}`,
  });
}

const adminUrl = (q = '') => `/v1/admin/analytics/workshops${q}`;
const portalUrl = (q = '') => `/v1/workshop/analytics${q}`;

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  const [bhilai] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'BHI', slug: 'bhilai', name: 'Bhilai', status: 'live' })
    .returning();
  F.raipur = raipur!.id;
  F.bhilai = bhilai!.id;
  await ctx.db.insert(s.pincodes).values([
    { pincode: '492001', stateId: state!.id, cityId: raipur!.id, centroid: { lng: 81.63, lat: 21.25 } },
    { pincode: '490001', stateId: state!.id, cityId: bhilai!.id, centroid: { lng: 81.38, lat: 21.21 } },
  ]);
  W.a = await workshop('wsa-alpha', 'Alpha Garage', '492001');
  W.b = await workshop('wsa-bravo', 'Bravo Motors', '492001');
  W.c = await workshop('wsa-charlie', 'Charlie Cars', '492001');
  W.d = await workshop('wsa-delta', 'Delta Bhilai', '490001');
  const buyer = await person(null);
  for (const [w, count] of [
    [W.a, 2],
    [W.b, 1],
    [W.c, 1],
  ] as const)
    for (let i = 0; i < count; i += 1) await request(w, F.raipur, buyer.id);
  await request(W.d, F.bhilai, buyer.id);
}, 60_000);

describe('GET /admin/analytics/workshops', () => {
  it('needs signing in, verification and analytics:read', async () => {
    expect((await ctx.app.request(adminUrl())).status).toBe(401);
    const agent = await person({ role: 'support_agent' });
    expect((await ctx.app.request(adminUrl(), { headers: agent.headers })).status).toBe(403);
    const owner = await person({ role: 'workshop_owner', workshopId: W.a });
    expect((await ctx.app.request(adminUrl(), { headers: owner.headers })).status).toBe(403);
    const unverified = await person({ role: 'super_admin' }, false);
    const res = await ctx.app.request(adminUrl(), { headers: unverified.headers });
    expect(((await res.json()) as ErrorJson).error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('gives an all-cities admin one city at a time, with names, totals and city medians', async () => {
    const admin = await person({ role: 'super_admin' });
    const res = await ctx.app.request(adminUrl('?city=RPR'), { headers: admin.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    const body = AdminWorkshopAnalyticsDto.parse(await res.json());
    expect(body.city).toBe('RPR');
    expect(body.cities.map((c) => c.code)).toEqual(['BHI', 'RPR']);
    expect(body.workshops.map((w) => w.name)).toEqual(['Alpha Garage', 'Bravo Motors', 'Charlie Cars']);
    expect(body.totals.requests).toBe(4);
    expect(body.medians.workshops).toBe(3);
    expect(body.medians.values.requests).toBe(1);
    const first = AdminWorkshopAnalyticsDto.parse(
      await (await ctx.app.request(adminUrl(), { headers: admin.headers })).json(),
    );
    expect(first.city).toBe('BHI');
    expect(first.medians.values.requests).toBeNull();
  });

  it('keeps a city manager to their city: another city is 404', async () => {
    const manager = await person({ role: 'city_manager', cityId: F.bhilai });
    const body = AdminWorkshopAnalyticsDto.parse(
      await (await ctx.app.request(adminUrl(), { headers: manager.headers })).json(),
    );
    expect(body.cities.map((c) => c.code)).toEqual(['BHI']);
    expect(body.workshops.map((w) => w.name)).toEqual(['Delta Bhilai']);
    expect((await ctx.app.request(adminUrl('?city=RPR'), { headers: manager.headers })).status).toBe(404);
  });

  it('validates the range: IST dates, from ≤ to, at most 180 days, unknown parameters refused', async () => {
    const admin = await person({ role: 'super_admin' });
    const code = async (q: string) => {
      const res = await ctx.app.request(adminUrl(q), { headers: admin.headers });
      return { status: res.status, code: ((await res.json()) as ErrorJson).error.code };
    };
    expect(await code('?from=2026-11-10&to=2026-11-01')).toEqual({ status: 400, code: 'RANGE_INVALID' });
    expect(await code('?from=2025-01-01&to=2026-11-01')).toEqual({ status: 400, code: 'RANGE_TOO_LONG' });
    expect(await code('?from=11/01/2026')).toEqual({ status: 400, code: 'VALIDATION' });
    expect(await code('?days=9')).toEqual({ status: 400, code: 'VALIDATION' });
  });
});

describe('GET /workshop/analytics', () => {
  it('is for the owner only: staff, customers and admins who own nothing are refused', async () => {
    expect((await ctx.app.request(portalUrl())).status).toBe(401);
    const staff = await person({ role: 'workshop_staff', workshopId: W.a });
    expect((await ctx.app.request(portalUrl(), { headers: staff.headers })).status).toBe(403);
    const customer = await person(null);
    expect((await ctx.app.request(portalUrl(), { headers: customer.headers })).status).toBe(403);
    const admin = await person({ role: 'super_admin' });
    expect((await ctx.app.request(portalUrl(), { headers: admin.headers })).status).toBe(403);
    const unverified = await person({ role: 'workshop_owner', workshopId: W.a }, false);
    const res = await ctx.app.request(portalUrl(), { headers: unverified.headers });
    expect(((await res.json()) as ErrorJson).error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('gives the owner their own numbers and anonymised city medians, never another workshop’s name', async () => {
    const owner = await person({ role: 'workshop_owner', workshopId: W.a });
    const res = await ctx.app.request(portalUrl(), { headers: owner.headers });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = PortalWorkshopAnalyticsDto.parse(JSON.parse(text));
    expect(body.workshop).toMatchObject({ id: W.a, name: 'Alpha Garage' });
    expect(body.stats.requests).toBe(2);
    // The asking workshop is left out of its own benchmark (security review 2026-11-15): two others remain, which is
    // below the anonymity minimum of three, so no median is shown.
    expect(body.cityMedians.workshops).toBe(2);
    expect(body.cityMedians.values.requests).toBeNull();
    for (const other of ['Bravo', 'Charlie', 'Delta']) expect(text).not.toContain(other);
    expect(text).not.toContain(W.b);
  });

  it('hides the medians below three workshops with data', async () => {
    const owner = await person({ role: 'workshop_owner', workshopId: W.d });
    const body = PortalWorkshopAnalyticsDto.parse(
      await (await ctx.app.request(portalUrl(), { headers: owner.headers })).json(),
    );
    expect(body.stats.requests).toBe(1);
    expect(body.cityMedians.values.requests).toBeNull();
  });

  it('treats a workshop the caller does not own as not found', async () => {
    const owner = await person({ role: 'workshop_owner', workshopId: W.a });
    expect((await ctx.app.request(portalUrl(`?workshop=${W.b}`), { headers: owner.headers })).status).toBe(
      404,
    );
    const own = await ctx.app.request(portalUrl(`?workshop=${W.a}`), { headers: owner.headers });
    expect(own.status).toBe(200);
  });

  it('validates the range', async () => {
    const owner = await person({ role: 'workshop_owner', workshopId: W.a });
    const code = async (q: string) => {
      const res = await ctx.app.request(portalUrl(q), { headers: owner.headers });
      return { status: res.status, code: ((await res.json()) as ErrorJson).error.code };
    };
    expect(await code('?from=2026-11-10&to=2026-11-01')).toEqual({ status: 400, code: 'RANGE_INVALID' });
    expect(await code('?from=2025-01-01&to=2026-11-01')).toEqual({ status: 400, code: 'RANGE_TOO_LONG' });
    expect(await code('?workshop=not-a-uuid')).toEqual({ status: 400, code: 'VALIDATION' });
    expect(await code('?x=1')).toEqual({ status: 400, code: 'VALIDATION' });
  });
});
