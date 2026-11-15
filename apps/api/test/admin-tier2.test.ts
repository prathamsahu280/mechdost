/**
 * Admin next tier part 2 over HTTP (design 2026-11-15 items 5 to 8; specs 08, 13, 15): policy history and restore,
 * the home layout, company details, and the city picker. Role-leak checks: who may read, who may save, which city.
 * Every save refreshes the website's cache by tag (spy).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { createRevalidator, type WebTag } from '../src/revalidate';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const refreshed: (readonly WebTag[])[] = [];

type Role = 'super_admin' | 'ops_manager' | 'city_manager' | 'marketing' | 'support_agent' | 'finance';

async function person(n: string, role: Role, cityId: string | null) {
  const phone = `+9198222222${n}`;
  const token = ctx.verifier.add(`token-tier2-admin-00000${n}`, {
    firebaseUid: `t2-${n}`,
    phone,
    email: `t2-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `t2-${n}`,
    phone,
    email: `t2-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

let raipurId = '';
beforeAll(async () => {
  ctx = await buildApp({
    revalidate: (tags) => {
      refreshed.push(tags);
      return Promise.resolve();
    },
  });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state not created');
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  raipurId = raipur?.id ?? '';
});

const call = (method: string, headers: Record<string, string>, path: string, body?: unknown) =>
  ctx.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const policy = (title: string) => ({
  title,
  lead: 'Lead',
  updatedOn: '2026-11-15',
  sections: [{ heading: 'One', body: 'Body for {company}' }],
});

describe('policy history API', () => {
  it('marketing publishes twice, reads the history and restores the first as a new version', async () => {
    const marketing = await person('01', 'marketing', null);
    const url = '/v1/admin/content/policy.privacy/en';
    for (const title of ['First', 'Second']) {
      const d = await call('PUT', marketing, url, { city: null, value: policy(title), version: null });
      expect(d.status).toBe(200);
      const { version } = (await d.json()) as { version: number };
      expect((await call('POST', marketing, `${url}/publish`, { city: null, version })).status).toBe(200);
    }
    const list = (await (await call('GET', marketing, `${url}/versions`)).json()) as {
      versions: { versionNo: number; action: string }[];
    };
    expect(list.versions.map((v) => v.versionNo)).toEqual([2, 1]);

    refreshed.length = 0;
    const restored = await call('POST', marketing, `${url}/restore`, { city: null, versionNo: 1 });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { version: number }).version).toBe(3);
    expect(refreshed).toEqual([['content']]);
    const live = (await (await ctx.app.request('/v1/content/policies/policy.privacy?locale=en')).json()) as {
      policy: { title: string } | null;
    };
    expect(live.policy?.title).toBe('First');
    const after = (await (await call('GET', marketing, `${url}/versions`)).json()) as {
      versions: { versionNo: number; action: string; restoredFrom: number | null }[];
    };
    expect(after.versions[0]).toMatchObject({ versionNo: 3, action: 'restored', restoredFrom: 1 });
    expect((await call('POST', marketing, `${url}/restore`, { city: null, versionNo: 99 })).status).toBe(404);
  });

  it('role leaks: support cannot read the history, a city manager cannot restore or reach the global text', async () => {
    const support = await person('02', 'support_agent', null);
    const manager = await person('03', 'city_manager', raipurId);
    const url = '/v1/admin/content/policy.privacy/en';
    expect((await call('GET', support, `${url}/versions`)).status).toBe(403);
    expect((await call('POST', support, `${url}/restore`, { city: null, versionNo: 1 })).status).toBe(403);
    expect((await call('GET', manager, `${url}/versions`)).status).toBe(404); // global text: all-cities grant only
    expect((await call('GET', manager, `${url}/versions?city=RPR`)).status).toBe(200);
    expect((await call('POST', manager, `${url}/restore`, { city: 'RPR', versionNo: 1 })).status).toBe(403);
    expect((await ctx.app.request(`${url}/versions`)).status).toBe(401);
    // a short text has no history route: only policy keys
    expect(
      (await call('GET', manager, '/v1/admin/content/hero.titleLine1/en/versions?city=RPR')).status,
    ).toBe(400);
  });
});

describe('home layout API', () => {
  const layout = {
    order: ['faq', 'trust'],
    hidden: ['partners'],
    featured: ['tyres', 'filters', 'batteries'],
    emoji: { tyres: '🛞' },
    mapDefault: 'map',
  };

  it('marketing saves it live; the public read serves it cacheably; reset returns to the default', async () => {
    const marketing = await person('04', 'marketing', null);
    refreshed.length = 0;
    const saved = await call('PUT', marketing, '/v1/admin/site/layout', {
      city: null,
      layout,
      version: null,
    });
    expect(saved.status).toBe(200);
    const { version } = (await saved.json()) as { version: number };
    expect(refreshed).toEqual([['site-layout']]);

    const pub = await ctx.app.request('/v1/site/home-layout?city=RPR');
    expect(pub.headers.get('cache-control')).toContain('s-maxage=300');
    const body = (await pub.json()) as { layout: { order: string[]; hidden: string[]; mapDefault: string } };
    expect(body.layout.order.slice(0, 2)).toEqual(['faq', 'trust']);
    expect(body.layout.hidden).toEqual(['partners']);
    expect(body.layout.mapDefault).toBe('map');

    const stale = await call('PUT', marketing, '/v1/admin/site/layout', {
      city: null,
      layout,
      version: version + 4,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_SETTING');
    const tooFew = await call('PUT', marketing, '/v1/admin/site/layout', {
      city: null,
      layout: { ...layout, featured: ['tyres'] },
      version,
    });
    expect(tooFew.status).toBe(422);
    expect(((await tooFew.json()) as ErrorJson).error.details).toMatchObject({ problem: 'featured_count' });
    expect(
      (
        await call('PUT', marketing, '/v1/admin/site/layout', {
          city: null,
          layout: { ...layout, order: ['nope'] },
          version,
        })
      ).status,
    ).toBe(400);

    const admin = (await (await call('GET', marketing, '/v1/admin/site/layout')).json()) as {
      version: number;
      inherited: boolean;
    };
    expect(admin).toMatchObject({ version, inherited: false });
    expect(
      (await call('POST', marketing, '/v1/admin/site/layout/reset', { city: null, version })).status,
    ).toBe(200);
    const reset = (await (await ctx.app.request('/v1/site/home-layout')).json()) as {
      layout: { order: string[]; mapDefault: string };
    };
    expect(reset.layout.order[0]).toBe('trust');
    expect(reset.layout.mapDefault).toBe('satellite');
  });

  it('role leaks: finance and support cannot read or save; a city manager reads their city but cannot save', async () => {
    const finance = await person('05', 'finance', null);
    const manager = await person('06', 'city_manager', raipurId);
    const body = { city: null, layout, version: null };
    expect((await call('GET', finance, '/v1/admin/site/layout')).status).toBe(403);
    expect((await call('PUT', finance, '/v1/admin/site/layout', body)).status).toBe(403);
    expect((await call('GET', manager, '/v1/admin/site/layout')).status).toBe(404); // global
    expect((await call('GET', manager, '/v1/admin/site/layout?city=RPR')).status).toBe(200);
    expect((await call('PUT', manager, '/v1/admin/site/layout', { ...body, city: 'RPR' })).status).toBe(403);
    expect((await ctx.app.request('/v1/admin/site/layout', { method: 'PUT', body: '{}' })).status).toBe(401);
  });
});

describe('company details API', () => {
  it('super admin saves; the public read shows only filled fields; invalid formats are refused', async () => {
    const admin = await person('07', 'super_admin', null);
    expect(((await (await ctx.app.request('/v1/company')).json()) as { company: object }).company).toEqual(
      {},
    );
    refreshed.length = 0;
    const saved = await call('PUT', admin, '/v1/admin/company', {
      details: {
        legalName: 'Shourya Integrated Services Pvt Ltd',
        cin: 'u74999ct2020ptc012345',
        grievanceEmail: 'G@MechDost.com',
      },
      version: null,
    });
    expect(saved.status).toBe(200);
    const { version } = (await saved.json()) as { version: number };
    expect(refreshed).toEqual([['company']]);
    const pub = (await (await ctx.app.request('/v1/company')).json()) as { company: Record<string, string> };
    expect(pub.company).toEqual({
      legalName: 'Shourya Integrated Services Pvt Ltd',
      cin: 'U74999CT2020PTC012345',
      grievanceEmail: 'g@mechdost.com',
    });
    const bad = await call('PUT', admin, '/v1/admin/company', { details: { gstin: '123' }, version });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson).error.details).toMatchObject({ field: 'gstin' });
    expect(
      (await call('PUT', admin, '/v1/admin/company', { details: { legalName: 'x' }, version: null })).status,
    ).toBe(409);
    expect((await call('PUT', admin, '/v1/admin/company', { details: { nope: 'x' }, version })).status).toBe(
      400,
    );
  });

  it('role leaks: ops manager reads but cannot save; marketing and support cannot read; a city grant is not enough', async () => {
    const ops = await person('08', 'ops_manager', null);
    const marketing = await person('09', 'marketing', null);
    const manager = await person('10', 'city_manager', raipurId);
    expect((await call('GET', ops, '/v1/admin/company')).status).toBe(200);
    expect((await call('PUT', ops, '/v1/admin/company', { details: {}, version: null })).status).toBe(403);
    expect((await call('GET', marketing, '/v1/admin/company')).status).toBe(403);
    expect((await call('GET', manager, '/v1/admin/company')).status).toBe(404); // all-cities grant only
    expect((await ctx.app.request('/v1/admin/company')).status).toBe(401);
  });
});

describe('city picker', () => {
  it('lists the cities the staff member may set values for; others see none', async () => {
    const admin = await person('11', 'super_admin', null);
    const ops = await person('12', 'ops_manager', null);
    const list = (await (await call('GET', admin, '/v1/admin/settings/cities')).json()) as {
      cities: { code: string }[];
    };
    expect(list.cities.map((c) => c.code)).toContain('RPR');
    const none = (await (await call('GET', ops, '/v1/admin/settings/cities')).json()) as {
      cities: unknown[];
    };
    expect(none.cities).toEqual([]);
    expect((await ctx.app.request('/v1/admin/settings/cities')).status).toBe(401);
  });
});

describe('cache refresh', () => {
  it('posts the tags with the shared secret, does nothing without one, and never throws', async () => {
    const calls: { url: string; secret: string | null; body: string }[] = [];
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        secret: new Headers(init?.headers).get('x-revalidate-secret'),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    const secret = 'x'.repeat(32);
    await createRevalidator(
      { webBaseUrl: 'https://mechdost.com', revalidateSecret: secret },
      fetchImpl,
    )(['content']);
    expect(calls).toEqual([
      { url: 'https://mechdost.com/api/revalidate', secret, body: '{"tags":["content"]}' },
    ]);
    await createRevalidator(
      { webBaseUrl: 'https://mechdost.com', revalidateSecret: null },
      fetchImpl,
    )(['content']);
    expect(calls).toHaveLength(1);
    const failing = (() => Promise.reject(new Error('down'))) as typeof fetch;
    await expect(
      createRevalidator(
        { webBaseUrl: 'https://mechdost.com', revalidateSecret: secret },
        failing,
      )(['company']),
    ).resolves.toBeUndefined();
  });
});
