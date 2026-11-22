/**
 * Brands and ranges, bulk status and MRPs over the API (design 2026-11-22): permissions are checked in the API
 * (marketing refused, publish-level actions need products:publish), bodies are strict and capped, switches are
 * version-checked, and the public catalogue follows a switch at once.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function staff(n: string, role: string) {
  const phone = `+9198777777${n}`;
  const token = ctx.verifier.add(`token-catalogue-groups-00${n}`, {
    firebaseUid: `cg-${n}`,
    phone,
    email: `cg-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `cg-${n}`,
    phone,
    email: `cg-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

interface Groups {
  brands: { slug: string; version: number; hidden: boolean; products: number; ranges: { slug: string }[] }[];
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

const publicSlugs = async () =>
  (
    (await (await ctx.app.request('/v1/catalogue/products?locale=en&limit=48')).json()) as {
      items: { slug: string; brand: { slug: string } }[];
    }
  ).items;

describe('brand switch over the API', () => {
  it('lists brands for catalogue staff only; hiding needs products:publish and a reason', async () => {
    const manager = await staff('01', 'catalogue_manager');
    const marketing = await staff('02', 'marketing');
    expect((await ctx.app.request('/v1/admin/catalogue/groups', { headers: marketing })).status).toBe(403);
    const groups = (await (
      await ctx.app.request('/v1/admin/catalogue/groups', { headers: manager })
    ).json()) as Groups;
    const castrol = groups.brands.find((b) => b.slug === 'castrol');
    expect(castrol?.products).toBeGreaterThan(0);

    const url = '/v1/admin/catalogue/brands/castrol/visibility';
    const body = (extra: object) => JSON.stringify({ hidden: true, version: castrol?.version, ...extra });
    expect(
      (
        await ctx.app.request(url, {
          method: 'POST',
          headers: marketing,
          body: body({ reasonCode: 'legal' }),
        })
      ).status,
    ).toBe(403);
    // No reason, an unknown reason and an extra field are all refused.
    expect((await ctx.app.request(url, { method: 'POST', headers: manager, body: body({}) })).status).toBe(
      422,
    );
    expect(
      (
        await ctx.app.request(url, {
          method: 'POST',
          headers: manager,
          body: body({ reasonCode: 'because' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.app.request(url, {
          method: 'POST',
          headers: manager,
          body: body({ reasonCode: 'legal', slug: 'x' }),
        })
      ).status,
    ).toBe(400);
  });

  it('hides every product of the brand on the public catalogue and restores it; stale versions lose; unknown is 404', async () => {
    const manager = await staff('03', 'catalogue_manager');
    expect((await publicSlugs()).some((p) => p.brand.slug === 'castrol')).toBe(true);
    const groups = (await (
      await ctx.app.request('/v1/admin/catalogue/groups', { headers: manager })
    ).json()) as Groups;
    const castrol = groups.brands.find((b) => b.slug === 'castrol');
    const hide = await ctx.app.request('/v1/admin/catalogue/brands/castrol/visibility', {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ hidden: true, reasonCode: 'supplier_issue', version: castrol?.version }),
    });
    expect(hide.status).toBe(200);
    const hidden = (await hide.json()) as { version: number; hidden: boolean; productsAffected: number };
    expect(hidden).toMatchObject({ hidden: true });
    expect(hidden.productsAffected).toBeGreaterThan(0);
    expect((await publicSlugs()).some((p) => p.brand.slug === 'castrol')).toBe(false);
    const page = await ctx.app.request('/v1/catalogue/products/castrol-activ-4t-20w40-900ml?locale=en');
    expect(page.status).toBe(404);

    const stale = await ctx.app.request('/v1/admin/catalogue/brands/castrol/visibility', {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ hidden: false, version: castrol?.version }),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_GROUP');
    const show = await ctx.app.request('/v1/admin/catalogue/brands/castrol/visibility', {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ hidden: false, version: hidden.version }),
    });
    expect(show.status).toBe(200);
    expect((await publicSlugs()).some((p) => p.brand.slug === 'castrol')).toBe(true);

    const none = await ctx.app.request('/v1/admin/catalogue/brands/no-such-brand/visibility', {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ hidden: true, reasonCode: 'legal', version: 1 }),
    });
    expect(none.status).toBe(404);
  });
});

describe('import status', () => {
  it('shows the last real run (none yet) to catalogue staff only', async () => {
    const manager = await staff('07', 'catalogue_manager');
    const marketing = await staff('08', 'marketing');
    expect((await ctx.app.request('/v1/admin/catalogue/import-status', { headers: marketing })).status).toBe(
      403,
    );
    const res = await ctx.app.request('/v1/admin/catalogue/import-status', { headers: manager });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: null });
  });
});

describe('bulk actions over the API', () => {
  it('bulk unpublish needs products:publish and caps the list at 500', async () => {
    const manager = await staff('04', 'catalogue_manager');
    const url = '/v1/admin/catalogue/products/bulk-status';
    const many = Array.from({ length: 501 }, (_, i) => `p-${String(i)}`);
    expect(
      (
        await ctx.app.request(url, {
          method: 'POST',
          headers: manager,
          body: JSON.stringify({ slugs: many, action: 'publish' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.app.request(url, {
          method: 'POST',
          headers: manager,
          body: JSON.stringify({ slugs: [], action: 'publish' }),
        })
      ).status,
    ).toBe(400);
    const res = await ctx.app.request(url, {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({
        slugs: ['castrol-activ-4t-20w40-900ml', 'no-such-product'],
        action: 'unpublish',
      }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { changed: string[]; skipped: { slug: string; reason: string }[] };
    expect(out.changed).toEqual(['castrol-activ-4t-20w40-900ml']);
    expect(out.skipped).toEqual([{ slug: 'no-such-product', reason: 'NOT_FOUND' }]);
    const back = await ctx.app.request(url, {
      method: 'POST',
      headers: manager,
      body: JSON.stringify({ slugs: ['castrol-activ-4t-20w40-900ml'], action: 'publish' }),
    });
    // Archived goes back through draft (the product machine), never straight to live.
    expect(await back.json()).toEqual({
      changed: [],
      skipped: [{ slug: 'castrol-activ-4t-20w40-900ml', reason: 'WRONG_STATE' }],
    });
  });

  it('sets MRPs in bulk (integer paise), refusing bad values and other roles', async () => {
    const manager = await staff('05', 'catalogue_manager');
    const marketing = await staff('06', 'marketing');
    const url = '/v1/admin/catalogue/mrps';
    const put = (headers: Record<string, string>, items: unknown) =>
      ctx.app.request(url, { method: 'PUT', headers, body: JSON.stringify({ items }) });
    expect((await put(marketing, [{ sku: 'X', mrpPaise: 100 }])).status).toBe(403);
    expect((await put(manager, [{ sku: 'X', mrpPaise: 0 }])).status).toBe(400);
    expect((await put(manager, [{ sku: 'X', mrpPaise: 10.5 }])).status).toBe(400);
    expect((await put(manager, [{ sku: 'X', mrpPaise: 100, extra: 1 }])).status).toBe(400);
    const res = await put(manager, [{ sku: 'NO-SUCH-SKU', mrpPaise: 100 }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: [], skipped: [{ sku: 'NO-SUCH-SKU', reason: 'NOT_FOUND' }] });
  });
});
