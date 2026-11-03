/**
 * Operational settings over HTTP (spec 08, hard rule 8): `settings:read` lists, `settings:write` changes; a city
 * manager sees only their city (another city or the global row is 404); writes are compare-and-set and validated
 * against the shared registry; the per-user limit is counted once per request (L54).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let raipur: string;

async function person(
  n: string,
  role: 'super_admin' | 'ops_manager' | 'city_manager',
  cityId: string | null,
) {
  const phone = `+9198444444${n}`;
  const token = ctx.verifier.add(`token-settings-000${n}`, {
    firebaseUid: `st-${n}`,
    phone,
    email: `st-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `st-${n}`,
    phone,
    email: `st-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

interface Listed {
  settings: { key: string; effective: unknown; city: { version: number } | null }[];
}
const effective = (body: Listed, key: string) => body.settings.find((r) => r.key === key)?.effective;

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state not created');
  const cities = await ctx.db
    .insert(s.cities)
    .values([
      { stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' },
      { stateId: state.id, code: 'BLS', slug: 'bilaspur', name: 'Bilaspur', status: 'coming_soon' },
    ])
    .returning();
  raipur = cities[0]?.id ?? '';
});

describe('admin settings', () => {
  it('super admin sets a global value and a city override; the city value wins and clears back', async () => {
    const admin = await person('01', 'super_admin', null);
    const url = '/v1/admin/settings/orders.acceptance_timeout_min';
    const global = await ctx.app.request(url, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ city: null, value: 20, version: null }),
    });
    expect(global.status).toBe(200);
    const city = await ctx.app.request(url, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ city: 'RPR', value: 10, version: null }),
    });
    expect(city.status).toBe(200);
    const { version } = (await city.json()) as { version: number };

    const listed = (await (
      await ctx.app.request('/v1/admin/settings?city=RPR', { headers: admin })
    ).json()) as Listed;
    expect(effective(listed, 'orders.acceptance_timeout_min')).toBe(10);
    expect(effective(listed, 'checkout.cod_cap_paise')).toBe(500_000); // registry default

    const outOfRange = await ctx.app.request(url, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ city: 'RPR', value: 0, version }),
    });
    expect(outOfRange.status).toBe(422);
    expect(((await outOfRange.json()) as ErrorJson).error.code).toBe('SETTING_RANGE');

    const stale = await ctx.app.request(`${url}/clear`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ city: 'RPR', version: version + 1 }),
    });
    expect(stale.status).toBe(409);
    const cleared = await ctx.app.request(`${url}/clear`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ city: 'RPR', version }),
    });
    expect(cleared.status).toBe(200);
    const after = (await (
      await ctx.app.request('/v1/admin/settings?city=RPR', { headers: admin })
    ).json()) as Listed;
    expect(effective(after, 'orders.acceptance_timeout_min')).toBe(20);

    const unknown = await ctx.app.request('/v1/admin/settings/orders.anything', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ city: null, value: 1, version: null }),
    });
    expect(unknown.status).toBe(400);
  });

  it('ops manager can read but not write', async () => {
    const ops = await person('02', 'ops_manager', null);
    expect((await ctx.app.request('/v1/admin/settings', { headers: ops })).status).toBe(200);
    const put = await ctx.app.request('/v1/admin/settings/checkout.cod_cap_paise', {
      method: 'PUT',
      headers: ops,
      body: JSON.stringify({ city: null, value: 300_000, version: null }),
    });
    expect(put.status).toBe(403);
  });

  it('a city manager reads only their city; global and other cities are 404', async () => {
    const manager = await person('03', 'city_manager', raipur);
    expect((await ctx.app.request('/v1/admin/settings?city=RPR', { headers: manager })).status).toBe(200);
    expect((await ctx.app.request('/v1/admin/settings?city=BLS', { headers: manager })).status).toBe(404);
    expect((await ctx.app.request('/v1/admin/settings', { headers: manager })).status).toBe(404);
  });

  it('counts the per-user rate limit once per request', async () => {
    const admin = await person('04', 'super_admin', null);
    const first = await ctx.app.request('/v1/admin/settings', { headers: admin });
    const second = await ctx.app.request('/v1/admin/settings', { headers: admin });
    const remaining = (r: Response) => Number(r.headers.get('RateLimit-Remaining'));
    expect(remaining(first) - remaining(second)).toBe(1);
  });
});
