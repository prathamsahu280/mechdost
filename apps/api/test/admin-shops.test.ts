/**
 * Admin → Partners → Shops and the shop's own profile over HTTP (specs 07/08, decision 2026-11-14 "Shop management").
 * Role-leak matrix: signed out 401, customers 403, read-only staff can read but not write, staff of another city get
 * 404, approval actions need partners:approve; strict bodies; one rate-limit count per request; a shop sees only its
 * own profile and only the owner edits the hours.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};
let raipur = '';
let bhilai = '';

async function person(n: string, role: string | null, scope: { cityId?: string; shopId?: string } = {}) {
  const phone = `+9198777000${n}`;
  const token = ctx.verifier.add(`token-adminshops-00${n}`, {
    firebaseUid: `as-${n}`,
    phone,
    email: `as-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `as-${n}`,
    phone,
    email: `as-${n}@example.com`,
    emailVerified: true,
  });
  if (role)
    await grantRole(ctx.db, {
      userId: user.id,
      role,
      cityId: scope.cityId ?? null,
      shopId: scope.shopId ?? null,
      grantedBy: null,
    });
  return { id: user.id, phone, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const get = (path: string, headers?: Record<string, string>) =>
  ctx.app.request(path, headers ? { headers } : {});
const send = (method: string, path: string, headers: Record<string, string>, body: unknown) =>
  ctx.app.request(path, { method, headers, body: JSON.stringify(body) });
const code = async (res: Response) => ((await res.json()) as ErrorJson).error.code;
const versionOf = async (id: string) =>
  (await ctx.db.select({ id: s.shops.id, v: s.shops.version }).from(s.shops)).find((r) => r.id === id)!.v;

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
  const city = (await ctx.db.select().from(s.cities)).find((c) => c.code === 'RPR');
  raipur = city!.id;
  const [other] = await ctx.db
    .insert(s.cities)
    .values({
      stateId: city!.stateId,
      code: 'BHI',
      slug: 'bhilai',
      name: 'Bhilai',
      status: 'live',
      centroid: { lng: 81.38, lat: 21.21 },
    })
    .returning();
  bhilai = other!.id;
});

describe('admin shops API', () => {
  it('role matrix: 401 / 403 / read-only / other city 404 / write / approve', async () => {
    const customer = await person('01', null);
    const support = await person('02', 'support_agent');
    const elsewhere = await person('03', 'city_manager', { cityId: bhilai });
    const cityMgr = await person('04', 'city_manager', { cityId: raipur });
    const sharma = shop['Sharma Auto Parts']!;

    expect((await get('/v1/admin/shops')).status).toBe(401);
    expect((await get('/v1/admin/shops', customer.headers)).status).toBe(403);

    const remaining = async () =>
      Number((await get('/v1/admin/shops', support.headers)).headers.get('RateLimit-Remaining'));
    const r1 = await remaining();
    expect(await remaining()).toBe(r1 - 1);

    const list = (await (await get('/v1/admin/shops?limit=2', support.headers)).json()) as {
      items: { name: string }[];
      nextCursor: string | null;
    };
    expect(list.items).toHaveLength(2);
    expect(list.nextCursor).not.toBeNull();
    const detail = await get(`/v1/admin/shops/${sharma}`, support.headers);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { coverage: unknown[] }).coverage).toHaveLength(5);
    // Read-only staff may read the offers but not change anything.
    expect((await get(`/v1/admin/shops/${sharma}/inventory`, support.headers)).status).toBe(200);
    const v = await versionOf(sharma);
    expect(
      (await send('PATCH', `/v1/admin/shops/${sharma}`, support.headers, { version: v, nameHi: 'शर्मा' }))
        .status,
    ).toBe(403);

    // Another city's manager: the shop does not exist for them.
    expect((await get(`/v1/admin/shops/${sharma}`, elsewhere.headers)).status).toBe(404);
    expect(((await (await get('/v1/admin/shops', elsewhere.headers)).json()) as { items: [] }).items).toEqual(
      [],
    );
    const foreign = await send('PATCH', `/v1/admin/shops/${sharma}`, elsewhere.headers, {
      version: v,
      name: 'Hijack',
    });
    expect(foreign.status).toBe(404);

    // Strict bodies: no mass assignment of status or version tricks.
    const sneaky = await send('PATCH', `/v1/admin/shops/${sharma}`, cityMgr.headers, {
      version: v,
      status: 'approved',
    });
    expect(sneaky.status).toBe(400);

    const ok = await send('PATCH', `/v1/admin/shops/${sharma}`, cityMgr.headers, {
      version: v,
      freeDeliveryMinPaise: 50000,
      hours: { open: '10:00', close: '20:00', days: [1, 2, 3, 4, 5, 6] },
    });
    expect(ok.status).toBe(200);
    const stale = await send('PATCH', `/v1/admin/shops/${sharma}`, cityMgr.headers, {
      version: v,
      name: 'Old version',
    });
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe('STALE_SHOP');
    const badHours = await send('PATCH', `/v1/admin/shops/${sharma}`, cityMgr.headers, {
      version: await versionOf(sharma),
      hours: { open: '20:00', close: '10:00', days: [1] },
    });
    expect(badHours.status).toBe(400);
  });

  it('coverage, standing with a reason code, members — and the shop sees its own profile', async () => {
    const ops = await person('05', 'ops_manager');
    const support = await person('06', 'support_agent');
    const gupta = shop['Gupta Lubes & Spares']!;

    const cov = await send('PUT', `/v1/admin/shops/${gupta}/coverage`, ops.headers, {
      version: await versionOf(gupta),
      upsert: [{ pincode: '492001', shippingPaise: 2000, leadDays: 1, active: true }],
      remove: ['492099'],
    });
    expect(cov.status).toBe(200);
    const unknownPin = await send('PUT', `/v1/admin/shops/${gupta}/coverage`, ops.headers, {
      version: await versionOf(gupta),
      upsert: [{ pincode: '110001', shippingPaise: 0, leadDays: 1, active: true }],
      remove: [],
    });
    expect(await code(unknownPin)).toBe('PINCODE_UNKNOWN');

    // Standing: approval rights; the reason code is required and never defaulted.
    const noCode = await send('POST', `/v1/admin/shops/${gupta}/standing`, ops.headers, {
      status: 'paused',
      note: 'Stock check this week',
      version: await versionOf(gupta),
    });
    expect(noCode.status).toBe(400);
    const notAllowed = await send('POST', `/v1/admin/shops/${gupta}/standing`, support.headers, {
      status: 'paused',
      reasonCode: 'late_deliveries',
      note: 'Late deliveries',
      version: await versionOf(gupta),
    });
    expect(notAllowed.status).toBe(403);
    const past = await send('POST', `/v1/admin/shops/${gupta}/standing`, ops.headers, {
      status: 'paused',
      reasonCode: 'late_deliveries',
      note: 'Late deliveries',
      pausedUntil: '2020-01-01T00:00:00Z',
      version: await versionOf(gupta),
    });
    expect(await code(past)).toBe('STATUS_ENDS_AT');
    const paused = await send('POST', `/v1/admin/shops/${gupta}/standing`, ops.headers, {
      status: 'paused',
      reasonCode: 'late_deliveries',
      note: 'Three late deliveries this week',
      version: await versionOf(gupta),
    });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ status: 'paused' });

    // Portal access by phone; the owner then sees the pause and its reason.
    const owner = await person('07', null);
    const unknown = await send('POST', `/v1/admin/shops/${gupta}/members`, ops.headers, {
      phone: '+919877700099',
      role: 'seller_owner',
    });
    expect(unknown.status).toBe(404);
    const added = await send('POST', `/v1/admin/shops/${gupta}/members`, ops.headers, {
      phone: owner.phone,
      role: 'seller_owner',
    });
    expect(added.status).toBe(200);
    const me = (await (await get('/v1/shop/me', owner.headers)).json()) as {
      shops: {
        id: string;
        status: string;
        standing: { reasonCode: string; note: string } | null;
        isOwner: boolean;
      }[];
    };
    expect(me.shops).toHaveLength(1);
    expect(me.shops[0]).toMatchObject({
      id: gupta,
      status: 'paused',
      standing: { reasonCode: 'late_deliveries', note: 'Three late deliveries this week' },
      isOwner: true,
    });
    // A customer has no shop profile at all.
    expect((await get('/v1/shop/me', (await person('08', null)).headers)).status).toBe(403);
  });

  it('only the owner sets the working hours; another shop is 404', async () => {
    const battery = shop['Raipur Battery Point']!;
    const owner = await person('09', 'seller_owner', { shopId: battery });
    const staff = await person('10', 'seller_staff', { shopId: battery });
    const hours = { open: '08:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6] };
    const byStaff = await send('PUT', `/v1/shop/hours/${battery}`, staff.headers, {
      version: await versionOf(battery),
      hours,
    });
    expect(byStaff.status).toBe(403);
    expect(await code(byStaff)).toBe('OWNER_ONLY');
    const other = await send('PUT', `/v1/shop/hours/${shop['Sharma Auto Parts']!}`, owner.headers, {
      version: 1,
      hours,
    });
    expect(other.status).toBe(404);
    const ok = await send('PUT', `/v1/shop/hours/${battery}`, owner.headers, {
      version: await versionOf(battery),
      hours,
    });
    expect(ok.status).toBe(200);
    const staffView = (await (await get('/v1/shop/me', staff.headers)).json()) as {
      shops: { hours: unknown; isOwner: boolean; openNow: boolean }[];
    };
    expect(staffView.shops[0]).toMatchObject({ hours, isOwner: false, openNow: true });
  });
});
