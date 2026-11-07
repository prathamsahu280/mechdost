/**
 * Site content over HTTP (spec 08, hard rule 8): public `GET /v1/content` serves only published text (cacheable);
 * staff draft with `content:write` and publish with `content:publish`; a city manager drafts for their own city
 * but cannot publish or touch the global text; the per-user limit is counted once (L54).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let raipur = '';

async function person(
  n: string,
  role: 'marketing' | 'city_manager' | 'catalogue_manager',
  cityId: string | null,
) {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-content-00000${n}`, {
    firebaseUid: `ct-${n}`,
    phone,
    email: `ct-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `ct-${n}`,
    phone,
    email: `ct-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state not created');
  const [city] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  raipur = city?.id ?? '';
});

const put = (headers: Record<string, string>, path: string, body: unknown) =>
  ctx.app.request(path, { method: 'PUT', headers, body: JSON.stringify(body) });
const post = (headers: Record<string, string>, path: string, body: unknown) =>
  ctx.app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });

describe('site content API', () => {
  it('marketing drafts and publishes; the public endpoint serves only published text, cacheably', async () => {
    const marketing = await person('01', 'marketing', null);
    const url = '/v1/admin/content/hero.titleLine1/en';
    const draft = await put(marketing, url, { city: null, value: 'Parts for every ride', version: null });
    expect(draft.status).toBe(200);
    const { version } = (await draft.json()) as { version: number };

    const before = await ctx.app.request('/v1/content?locale=en');
    expect(before.headers.get('cache-control')).toContain('s-maxage=300');
    expect(((await before.json()) as { content: object }).content).toEqual({});

    expect((await post(marketing, `${url}/publish`, { city: null, version })).status).toBe(200);
    const after = (await (await ctx.app.request('/v1/content?locale=en&city=RPR')).json()) as {
      content: Record<string, string>;
    };
    expect(after.content['hero.titleLine1']).toBe('Parts for every ride');
    expect((await ctx.app.request('/v1/content?locale=hi')).status).toBe(200);
    expect((await ctx.app.request('/v1/content?locale=fr')).status).toBe(400);
    expect(
      (await put(marketing, '/v1/admin/content/hero.unknown/en', { city: null, value: 'x', version: null }))
        .status,
    ).toBe(400);
  });

  it('a city manager drafts for their city only and cannot publish; other roles are refused', async () => {
    const manager = await person('02', 'city_manager', raipur);
    const url = '/v1/admin/content/hero.eyebrow/hi';
    expect(
      (await put(manager, url, { city: 'RPR', value: 'रायपुर में आज डिलीवरी', version: null })).status,
    ).toBe(200);
    expect((await put(manager, url, { city: null, value: 'सब शहर', version: null })).status).toBe(404);
    const refused = await post(manager, `${url}/publish`, { city: 'RPR', version: 1 });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as ErrorJson).error.code).toBe('FORBIDDEN');

    const catalogue = await person('03', 'catalogue_manager', null);
    expect((await ctx.app.request('/v1/admin/content', { headers: catalogue })).status).toBe(403);
    expect((await ctx.app.request('/v1/admin/content')).status).toBe(401);
  });

  it('policy pages: draft and publish a structured document; the public endpoint serves it', async () => {
    const marketing = await person('05', 'marketing', null);
    const url = '/v1/admin/content/policy.returns/en';
    const doc = {
      title: 'Cancellations & returns',
      lead: 'No returns or exchanges; faulty parts are replaced or refunded.',
      updatedOn: '2026-11-04',
      sections: [{ heading: 'Faulty or wrong part', body: 'Raise a support request. Call {phone}.' }],
    };
    const bad = await put(marketing, url, {
      city: null,
      value: { ...doc, updatedOn: '04/11/2026' },
      version: null,
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson & { error: { details: unknown } }).error).toMatchObject({
      code: 'POLICY_INVALID',
      details: { problem: 'date' },
    });
    const saved = await put(marketing, url, { city: null, value: doc, version: null });
    expect(saved.status).toBe(200);
    const { version } = (await saved.json()) as { version: number };
    expect((await post(marketing, `${url}/publish`, { city: null, version })).status).toBe(200);

    const res = await ctx.app.request('/v1/content/policies/policy.returns?locale=en&city=RPR');
    expect(res.headers.get('cache-control')).toContain('s-maxage=300');
    expect(((await res.json()) as { policy: unknown }).policy).toEqual(doc);
    const hindi = (await (await ctx.app.request('/v1/content/policies/policy.returns?locale=hi')).json()) as {
      policy: unknown;
    };
    expect(hindi.policy).toBeNull(); // the Hindi page keeps its Hindi default
    expect((await ctx.app.request('/v1/content/policies/policy.secret?locale=en')).status).toBe(400);
  });

  it('counts the per-user rate limit once per request', async () => {
    const marketing = await person('04', 'marketing', null);
    const remaining = async () => {
      const res = await ctx.app.request('/v1/admin/content', { headers: marketing });
      expect(res.status).toBe(200); // the per-user limit applies to signed-in requests
      return Number(res.headers.get('RateLimit-Remaining'));
    };
    const first = await remaining();
    expect(first - (await remaining())).toBe(1);
  });
});
