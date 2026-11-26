/**
 * Shopping personalisation phases 2 and 3 over HTTP (design 2026-11-25, founder approval 2026-11-26): the recently
 * viewed list is signed-in only, private (no-store), stored only with the personalisation consent, rate limited and
 * strict; "Similar options" is the public `similar` slot; the fitting link rides on the product slot; the admin rule
 * form can pick products (categories:write only); the suggestion funnel is staff analytics only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
// First: loading the app extends Zod with .openapi() before the shared catalogue schemas are created.
import { bearer, buildApp, type ErrorJson } from './helpers';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import * as s from '@mechdost/db/schema';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { RecommendationListDto, RecoProductListDto } from '@mechdost/shared/recommendations';
import { RecentlyViewedDto } from '@mechdost/shared/recently-viewed-api';
import { RECENT_WRITE_RATE } from '../src/routes/recently-viewed';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string): Promise<Person> {
  const identity = {
    firebaseUid: `p23-${n}`,
    phone: `+9198444444${n}`,
    email: `p23-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-p23-00000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? {},
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const view = (slug: string, viewedAt = new Date().toISOString()) => ({
  views: [{ slug, viewedAt }],
  city: 'RPR',
});
let categories: Record<string, string> = {};

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  categories = Object.fromEntries((await ctx.db.select().from(s.categories)).map((x) => [x.slug, x.id]));
});

describe('recently viewed (phase 2)', () => {
  it('is for signed-in people only', async () => {
    expect((await call(null, 'GET', '/me/recently-viewed')).status).toBe(401);
    expect((await call(null, 'POST', '/me/recently-viewed', view('hp-racer4-20w40-900ml'))).status).toBe(401);
    expect((await call(null, 'DELETE', '/me/recently-viewed')).status).toBe(401);
  });

  it('without the consent nothing is stored; with it the list is kept, private and cleared on demand', async () => {
    const asha = await person('01');
    const first = await call(asha, 'POST', '/me/recently-viewed', view('hp-racer4-20w40-900ml'));
    expect(first.status).toBe(200);
    expect(RecentlyViewedDto.parse(first.body)).toEqual({ stored: false, items: [] });
    expect(first.headers.get('cache-control')).toBe('private, no-store');

    expect((await call(asha, 'PUT', '/me/privacy/consents/personalisation', { granted: true })).status).toBe(
      200,
    );
    const saved = await call(asha, 'POST', '/me/recently-viewed', view('hp-racer4-20w40-900ml'));
    expect(RecentlyViewedDto.parse(saved.body).items.map((i) => i.slug)).toEqual(['hp-racer4-20w40-900ml']);
    const read = await call(asha, 'GET', '/me/recently-viewed');
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    expect(RecentlyViewedDto.parse(read.body).stored).toBe(true);

    const cleared = await call(asha, 'DELETE', '/me/recently-viewed');
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ cleared: 1 });
    expect(RecentlyViewedDto.parse((await call(asha, 'GET', '/me/recently-viewed')).body).items).toEqual([]);
  });

  it('refuses extra fields (no mass assignment) and more than ten views', async () => {
    const ravi = await person('02');
    expect(
      (await call(ravi, 'POST', '/me/recently-viewed', { ...view('a-b'), userId: ravi.id })).status,
    ).toBe(400);
    const many = {
      city: 'RPR',
      views: Array.from({ length: 11 }, (_, i) => ({
        slug: `p-${String(i)}`,
        viewedAt: new Date().toISOString(),
      })),
    };
    expect((await call(ravi, 'POST', '/me/recently-viewed', many)).status).toBe(400);
  });

  it('limits writes per person', async () => {
    const meera = await person('03');
    const before = await call(meera, 'POST', '/me/recently-viewed', view('hp-racer4-20w40-900ml'));
    const limit = Number(before.headers.get('ratelimit-limit') ?? before.headers.get('x-ratelimit-limit'));
    expect(limit).toBe(RECENT_WRITE_RATE.limit);
  });
});

describe('suggestions (phase 3)', () => {
  it('the public similar slot gives same-size options of other brands with the shared size', async () => {
    const res = await call(null, 'GET', '/recommendations?slot=similar&slugs=castrol-activ-4t-20w40-900ml');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    const list = RecommendationListDto.parse(res.body);
    expect(list.items.map((i) => i.card.slug)).toContain('hp-racer4-20w40-900ml');
    expect(list.items[0]?.reason.source).toBe('similar');
  });

  it('a workshop fitting rule rides on the product slot as `fitting`', async () => {
    const mgr = await person('04');
    await grantRole(ctx.db, { userId: mgr.id, role: 'catalogue_manager', grantedBy: null });
    const made = await call(mgr, 'POST', '/admin/recommendation-rules', {
      triggerCategoryId: categories.tyres,
      suggestKind: 'workshop_fitting',
      label: 'Get it fitted at a nearby workshop',
      labelHi: 'पास की वर्कशॉप में फ़िट करवाएँ',
      priority: 50,
      active: true,
    });
    expect(made.status).toBe(201);
    const res = await call(null, 'GET', '/recommendations?slot=product&slugs=car-tyre-185-65-r15&locale=hi');
    expect(RecommendationListDto.parse(res.body).fitting).toEqual({
      label: 'पास की वर्कशॉप में फ़िट करवाएँ',
    });
  });

  it('the rule form product picker is for categories:write holders only', async () => {
    const customer = await person('05');
    expect((await call(customer, 'GET', '/admin/recommendation-products?q=activ')).status).toBe(403);
    const mgr = await person('06');
    await grantRole(ctx.db, { userId: mgr.id, role: 'catalogue_manager', grantedBy: null });
    const res = await call(mgr, 'GET', '/admin/recommendation-products?q=activ');
    expect(res.status).toBe(200);
    expect(RecoProductListDto.parse(res.body).products.map((p) => p.slug)).toContain(
      'castrol-activ-4t-20w40-900ml',
    );
  });

  it('the suggestion funnel is staff analytics only', async () => {
    const customer = await person('07');
    expect((await call(customer, 'GET', '/admin/analytics/reco-funnel?days=7')).status).toBe(403);
    const admin = await person('08');
    await grantRole(ctx.db, { userId: admin.id, role: 'super_admin', grantedBy: null });
    const res = await call(admin, 'GET', '/admin/analytics/reco-funnel?days=7');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('a city-scoped manager is refused (client events carry no city, so the funnel is all-city data only)', async () => {
    const [rpr] = await ctx.db.select().from(s.cities).limit(1);
    const cityMgr = await person('09');
    await grantRole(ctx.db, {
      userId: cityMgr.id,
      role: 'city_manager',
      cityId: rpr?.id ?? null,
      grantedBy: null,
    });
    const refused = await call(cityMgr, 'GET', '/admin/analytics/reco-funnel?days=7');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ALL_CITIES_REQUIRED');
    const allCities = await person('10');
    await grantRole(ctx.db, { userId: allCities.id, role: 'ops_manager', cityId: null, grantedBy: null });
    expect((await call(allCities, 'GET', '/admin/analytics/reco-funnel?days=7')).status).toBe(200);
  });
});
