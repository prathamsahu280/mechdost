/**
 * Service-area PIN codes over HTTP (spec 15 "PIN codes"): `settings:read` lists a city's PIN codes, `cities:manage`
 * adds, edits and switches them on/off (compare-and-set, Zod at the boundary, reason code required); a city manager
 * only reaches their own city (another city is 404); the public list shows a live city's active PINs in the
 * requested language; an inactive PIN is refused by the checkout quote and the nearby-workshops search.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let raipur = '';
let bilaspur = '';

async function person(
  n: string,
  role: 'super_admin' | 'ops_manager' | 'city_manager',
  cityId: string | null,
) {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-pincodes-000${n}`, {
    firebaseUid: `pc-${n}`,
    phone,
    email: `pc-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `pc-${n}`,
    phone,
    email: `pc-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

interface Row {
  pincode: string;
  areaEn: string | null;
  areaHi: string | null;
  active: boolean;
  inactiveReason: string | null;
  freeDeliveryMinPaise: number | null;
  source: string;
  version: number;
}
interface Listed {
  city: { code: string };
  pincodes: Row[];
}

const post = (headers: Record<string, string>, url: string, body: unknown, method = 'POST') =>
  ctx.app.request(url, { method, headers, body: JSON.stringify(body) });
const code = async (res: Response) => ((await res.json()) as ErrorJson).error.code;

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
      {
        stateId: state.id,
        code: 'RPR',
        slug: 'raipur',
        name: 'Raipur',
        nameHi: 'रायपुर',
        status: 'live',
        centroid: { lng: 81.63, lat: 21.25 },
      },
      {
        stateId: state.id,
        code: 'BSP',
        slug: 'bilaspur',
        name: 'Bilaspur',
        status: 'live',
        centroid: { lng: 82.15, lat: 22.08 },
      },
    ])
    .returning();
  raipur = cities[0]?.id ?? '';
  bilaspur = cities[1]?.id ?? '';
  await ctx.db.insert(s.pincodes).values([
    {
      pincode: '492001',
      stateId: state.id,
      cityId: raipur,
      locality: 'Raipur GPO',
      localityHi: 'रायपुर जीपीओ',
      centroid: { lng: 81.6338, lat: 21.2292 },
    },
    { pincode: '495001', stateId: state.id, cityId: bilaspur, centroid: { lng: 82.15, lat: 22.08 } },
  ]);
});

describe('admin PIN codes', () => {
  it('super admin adds, edits, switches off and on; every write is compare-and-set', async () => {
    const admin = await person('01', 'super_admin', null);
    const added = await post(admin, '/v1/admin/pincodes', {
      city: 'RPR',
      pincode: '492004',
      lat: 21.2638,
      lng: 81.6316,
      areaEn: 'Pandri',
      areaHi: 'पंडरी',
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({ pincode: '492004', version: 1 });

    const dup = await post(admin, '/v1/admin/pincodes', {
      city: 'RPR',
      pincode: '492004',
      lat: 21.26,
      lng: 81.63,
      areaEn: 'Pandri',
      areaHi: 'पंडरी',
    });
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe('PINCODE_EXISTS');

    const edited = await post(
      admin,
      '/v1/admin/pincodes/492004',
      {
        city: 'RPR',
        version: 1,
        area: { en: 'Pandri Market', hi: 'पंडरी मार्केट' },
        freeDeliveryMinPaise: 0,
      },
      'PATCH',
    );
    expect(edited.status).toBe(200);
    const stale = await post(
      admin,
      '/v1/admin/pincodes/492004',
      { city: 'RPR', version: 1, freeDeliveryMinPaise: 1 },
      'PATCH',
    );
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe('STALE_PINCODE');

    const noReason = await post(admin, '/v1/admin/pincodes/492004/status', {
      city: 'RPR',
      version: 2,
      active: false,
    });
    expect(noReason.status).toBe(400);
    const off = await post(admin, '/v1/admin/pincodes/492004/status', {
      city: 'RPR',
      version: 2,
      active: false,
      reason: 'no_partners',
      note: 'Waiting for a shop',
    });
    expect(off.status).toBe(200);

    const listed = (await (
      await ctx.app.request('/v1/admin/pincodes?city=RPR', { headers: admin })
    ).json()) as Listed;
    expect(listed.city.code).toBe('RPR');
    const byPin = (await (
      await ctx.app.request('/v1/admin/pincodes?pincode=492001', { headers: admin })
    ).json()) as Listed;
    expect(byPin.pincodes.length).toBe(2);
    expect(
      (await ctx.app.request('/v1/admin/pincodes?city=RPR&pincode=492001', { headers: admin })).status,
    ).toBe(400);
    expect((await ctx.app.request('/v1/admin/pincodes?pincode=110001', { headers: admin })).status).toBe(404);
    expect(listed.pincodes.map((p) => p.pincode)).toEqual(['492001', '492004']);
    expect(listed.pincodes[1]).toMatchObject({
      areaEn: 'Pandri Market',
      areaHi: 'पंडरी मार्केट',
      active: false,
      inactiveReason: 'no_partners',
      freeDeliveryMinPaise: 0,
      source: 'admin',
      version: 3,
    });
  });

  it('refuses bad input at the boundary: format, coordinates, unknown fields, nothing to change', async () => {
    const admin = await person('02', 'super_admin', null);
    const base = {
      city: 'RPR',
      pincode: '492009',
      lat: 21.25,
      lng: 81.6,
      areaEn: 'Telibandha',
      areaHi: 'तेलीबांधा',
    };
    expect((await post(admin, '/v1/admin/pincodes', { ...base, pincode: '49200' })).status).toBe(400);
    expect((await post(admin, '/v1/admin/pincodes', { ...base, lat: 81.6, lng: 21.25 })).status).toBe(400);
    expect((await post(admin, '/v1/admin/pincodes', { ...base, active: false })).status).toBe(400);
    const english = await post(admin, '/v1/admin/pincodes', { ...base, areaHi: 'Telibandha' });
    expect(english.status).toBe(422);
    expect(await code(english)).toBe('PINCODE_AREA');
    const far = await post(admin, '/v1/admin/pincodes', { ...base, lat: 28.63, lng: 77.22 });
    expect(far.status).toBe(422);
    expect(await code(far)).toBe('PINCODE_FAR_FROM_CITY');
    expect(
      (await post(admin, '/v1/admin/pincodes/492001', { city: 'RPR', version: 1 }, 'PATCH')).status,
    ).toBe(400);
  });

  it('ops manager reads but cannot write; a city manager reaches only their city', async () => {
    const ops = await person('03', 'ops_manager', null);
    expect((await ctx.app.request('/v1/admin/pincodes?city=RPR', { headers: ops })).status).toBe(200);
    const opsAdd = await post(ops, '/v1/admin/pincodes', {
      city: 'RPR',
      pincode: '492010',
      lat: 21.25,
      lng: 81.6,
      areaEn: 'Mowa',
      areaHi: 'मोवा',
    });
    expect(opsAdd.status).toBe(403);

    const cm = await person('04', 'city_manager', bilaspur);
    expect((await ctx.app.request('/v1/admin/pincodes?city=BSP', { headers: cm })).status).toBe(200);
    expect((await ctx.app.request('/v1/admin/pincodes?city=RPR', { headers: cm })).status).toBe(404);
    const foreign = await post(cm, '/v1/admin/pincodes/492001/status', {
      city: 'BSP',
      version: 1,
      active: false,
      reason: 'other',
    });
    expect(foreign.status).toBe(404); // a Raipur PIN through the Bilaspur scope
    expect((await ctx.app.request('/v1/admin/pincodes?city=RPR')).status).toBe(401);
  });
});

describe('public PIN list and serviceability', () => {
  it('lists active PINs of a live city in the requested language; 404 for an unknown city', async () => {
    const hi = await ctx.app.request('/v1/cities/RPR/pincodes?locale=hi');
    expect(hi.status).toBe(200);
    expect(hi.headers.get('cache-control')).toContain('max-age=300');
    const body = (await hi.json()) as { city: string; pincodes: { pincode: string; area: string | null }[] };
    expect(body.city).toBe('RPR');
    expect(body.pincodes).toEqual([{ pincode: '492001', area: 'रायपुर जीपीओ', lat: 21.2292, lng: 81.6338 }]);
    expect((await ctx.app.request('/v1/cities/XYZ/pincodes')).status).toBe(404);
    expect((await ctx.app.request('/v1/cities/rpr/pincodes')).status).toBe(400);
  });

  it('an inactive PIN is refused by the checkout quote and the nearby-workshops search', async () => {
    const quote = await ctx.app.request('/v1/checkout/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pincode: '492004', lines: [{ sku: 'ANY-SKU', qty: 1 }], locale: 'en' }),
    });
    expect(quote.status).toBe(422);
    expect(await code(quote)).toBe('PINCODE_NOT_SERVICEABLE');
    const nearby = await ctx.app.request('/v1/workshops?pincode=492004');
    expect(nearby.status).toBe(422);
    expect(await code(nearby)).toBe('PINCODE_UNKNOWN');
    // The active one still works.
    expect((await ctx.app.request('/v1/workshops?pincode=492001')).status).toBe(200);
  });
});
