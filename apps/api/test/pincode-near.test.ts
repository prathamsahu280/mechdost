/**
 * `GET /v1/geo/pincode-near` (spec 06 "Use my location", spec 15): the nearest active MechDost PIN centroids of a
 * live city for a position, nearest first, in the page locale. It never claims a PIN: PIN areas are irregular, so
 * the nearest post office is only a shortlist (founder, Sarona 2026-11-28: real PIN 492099, nearest centroid
 * 492013, OpenStreetMap said 493332). Outside every live city's PINs the answer is "not served" so the web falls back.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, setPincodeActive } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { buildApp } from './helpers';

const seed = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../packages/db/seed/raipur-pincodes.json', import.meta.url)),
    'utf8',
  ),
) as {
  pincodes: { pincode: string; areaEn: string; areaHi: string; lat: number; lng: number; active: boolean }[];
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let cityId = '';
let staffUserId = '';

interface Near {
  served: boolean;
  nearest: { pincode: string; area: string | null; distanceM: number }[];
}
const near = async (qs: string): Promise<{ status: number; body: Near }> => {
  const res = await ctx.app.request(`/v1/geo/pincode-near?${qs}`);
  return { status: res.status, body: (await res.json()) as Near };
};

const haversineKm = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const x =
    Math.sin(((b[0] - a[0]) * r) / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
const expectedNearest = (lat: number, lng: number, n: number) =>
  seed.pincodes
    .filter((p) => p.active)
    .map((p) => ({ pin: p.pincode, km: haversineKm([lat, lng], [p.lat, p.lng]) }))
    .sort((x, y) => x.km - y.km)
    .slice(0, n)
    .map((x) => x.pin);

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state not created');
  const [city] = await ctx.db
    .insert(s.cities)
    .values({
      stateId: state.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      nameHi: 'रायपुर',
      status: 'live',
      centroid: { lng: 81.6296, lat: 21.2514 },
    })
    .returning();
  if (!city) throw new Error('city not created');
  cityId = city.id;
  staffUserId = (
    await ensureUser(ctx.db, {
      firebaseUid: 'near-1',
      phone: '+919855000001',
      email: null,
      emailVerified: false,
    })
  ).id;
  await ctx.db.insert(s.pincodes).values(
    seed.pincodes.map((p) => ({
      pincode: p.pincode,
      stateId: state.id,
      cityId: city.id,
      locality: p.areaEn,
      localityHi: p.areaHi,
      centroid: { lng: p.lng, lat: p.lat },
    })),
  );
});

describe('GET /v1/geo/pincode-near', () => {
  it.each([
    ['Pachpedi Naka', 21.227, 81.64],
    ['Raipur railway station', 21.2514, 81.6296],
    ['Tatibandh', 21.238, 81.585],
    ['Urla', 21.29, 81.59],
    ['Sarona', 21.216, 81.597],
  ])(
    '%s: the five nearest MechDost PINs, nearest first, never OpenStreetMap 493332',
    async (_n, lat, lng) => {
      const { status, body } = await near(`lat=${String(lat)}&lng=${String(lng)}`);
      expect(status).toBe(200);
      expect(body.served).toBe(true);
      expect(body.nearest.map((p) => p.pincode)).toEqual(expectedNearest(lat, lng, 5));
      expect(body.nearest.map((p) => p.pincode)).not.toContain('493332');
    },
  );

  it('Sarona: the real PIN 492099 is among the choices (the founder can tap it)', async () => {
    const { body } = await near('lat=21.216&lng=81.597');
    expect(body.nearest.map((p) => p.pincode)).toContain('492099');
  });

  it('returns Devanagari area names for locale=hi and English otherwise', async () => {
    const hi = await near('lat=21.2514&lng=81.6296&locale=hi');
    expect(hi.body.nearest[0]?.area).toMatch(/[ऀ-ॿ]/);
    const en = await near('lat=21.2514&lng=81.6296&locale=en');
    expect(en.body.nearest[0]?.area).not.toMatch(/[ऀ-ॿ]/);
  });

  it('a far-away point (Mumbai) is not served: the web falls back to the map provider', async () => {
    const { status, body } = await near('lat=19.076&lng=72.877');
    expect(status).toBe(200);
    expect(body).toMatchObject({ served: false, nearest: [] });
  });

  it('a point beyond the maximum distance (Bhilai, about 25 km west) is not served', async () => {
    const { body } = await near('lat=21.19&lng=81.35');
    expect(body.served).toBe(false);
  });

  it('never offers an inactive PIN', async () => {
    const common = { cityId, pincode: '492017', staffUserId };
    await setPincodeActive(ctx.db, {
      ...common,
      expectedVersion: 1,
      active: false,
      reason: 'operational_pause',
    });
    const { body } = await near('lat=21.2514&lng=81.6296');
    expect(body.nearest.map((p) => p.pincode)).not.toContain('492017');
    await setPincodeActive(ctx.db, { ...common, expectedVersion: 2, active: true });
  });

  it.each([
    '',
    'lat=abc&lng=81.6',
    'lat=21.2',
    'lat=0&lng=0',
    'lat=21.2&lng=81.6&limit=99',
    'lat=21.2&lng=81.6&locale=fr',
  ])('refuses invalid input (%s) with 400', async (qs) => {
    expect((await near(qs)).status).toBe(400);
  });
});
