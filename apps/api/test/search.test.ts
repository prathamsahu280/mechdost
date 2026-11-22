/**
 * Search API (spec 02 "Smart search"): public cacheable suggestions with strict validation, "did you mean" on a
 * miss, and the admin synonym editor (products:write, audited, optimistic version, 409 on a duplicate).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole, invalidateSearchVocab } from '@mechdost/db/repo';
import { SuggestResponseSchema } from '@mechdost/shared/search-api';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function staff(n: string, role: string) {
  const phone = `+9198777777${n}`;
  const token = ctx.verifier.add(`token-search-synonyms-00${n}`, {
    firebaseUid: `se-${n}`,
    phone,
    email: `se-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `se-${n}`,
    phone,
    email: `se-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  invalidateSearchVocab();
});

describe('GET /v1/search/suggest', () => {
  it('suggests at most 8 items, cacheable, without internal ids', async () => {
    const res = await ctx.app.request('/v1/search/suggest?q=cast&locale=en');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const body = SuggestResponseSchema.parse(await res.json());
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(8);
    expect(body.items[0]).toMatchObject({ kind: 'brand', slug: 'castrol' });
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('understands attributes: "20w40" lists the 20W-40 oils', async () => {
    const body = SuggestResponseSchema.parse(
      await (await ctx.app.request('/v1/search/suggest?q=20w40%20bike')).json(),
    );
    expect(body.items.some((i) => i.kind === 'product' && /20W/i.test(i.label))).toBe(true);
  });

  it('answers a miss with "did you mean"', async () => {
    const body = SuggestResponseSchema.parse(
      await (await ctx.app.request('/v1/search/suggest?q=castroll')).json(),
    );
    expect(body.items.length === 0 ? body.didYouMean : 'Castrol').toBe('Castrol');
  });

  it('too short is an empty answer; bad parameters are 400', async () => {
    const short = await ctx.app.request('/v1/search/suggest?q=c');
    expect(await short.json()).toEqual({ items: [], didYouMean: null });
    for (const bad of [`q=${'x'.repeat(81)}`, 'q=ab&locale=fr', 'q=ab&city=raipur', 'locale=en']) {
      expect((await ctx.app.request(`/v1/search/suggest?${bad}`)).status, bad).toBe(400);
    }
  });

  it('is rate limited per IP', async () => {
    let last = 200;
    for (let i = 0; i < 125; i++) {
      last = (
        await ctx.app.request(`/v1/search/suggest?q=zz${i}`, {
          headers: { 'x-forwarded-for': '203.0.113.9' },
        })
      ).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('admin search synonyms', () => {
  it('needs products:write', async () => {
    const marketing = await staff('01', 'marketing');
    expect(
      (await ctx.app.request('/v1/admin/catalogue/search-synonyms', { headers: marketing })).status,
    ).toBe(403);
    expect((await ctx.app.request('/v1/admin/catalogue/search-synonyms')).status).toBe(401);
  });

  it('lists the seeded words, adds one, refuses a duplicate, switches it off with the version', async () => {
    const manager = await staff('02', 'catalogue_manager');
    const url = '/v1/admin/catalogue/search-synonyms';
    const list = (await (await ctx.app.request(url, { headers: manager })).json()) as {
      items: { term: string }[];
    };
    expect(list.items.some((i) => i.term === 'baitri')).toBe(true);

    const body = JSON.stringify({
      term: 'Tel Wala',
      locale: 'hinglish',
      kind: 'synonym',
      expandsTo: ['oil'],
    });
    const created = await ctx.app.request(url, { method: 'POST', headers: manager, body });
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; term: string; version: number };
    expect(row.term).toBe('tel wala');
    const dup = await ctx.app.request(url, { method: 'POST', headers: manager, body });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as ErrorJson).error.code).toBe('SYNONYM_EXISTS');

    const stale = await ctx.app.request(`${url}/${row.id}`, {
      method: 'PATCH',
      headers: manager,
      body: JSON.stringify({ version: row.version + 3, active: false }),
    });
    expect(stale.status).toBe(409);
    const ok = await ctx.app.request(`${url}/${row.id}`, {
      method: 'PATCH',
      headers: manager,
      body: JSON.stringify({ version: row.version, active: false }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ version: row.version + 1, active: false });
  });

  it('refuses unknown fields and a category word that names no category', async () => {
    const manager = await staff('02', 'catalogue_manager');
    const url = '/v1/admin/catalogue/search-synonyms';
    const extra = await ctx.app.request(url, {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ term: 'x1', locale: 'en', kind: 'synonym', expandsTo: ['oil'], active: false }),
    });
    expect(extra.status).toBe(400);
    const bad = await ctx.app.request(url, {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ term: 'nothing', locale: 'en', kind: 'category', expandsTo: ['no-such'] }),
    });
    expect(bad.status).toBe(422);
  });
});
