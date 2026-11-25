/**
 * Vehicle segments over the API (design 2026-11-25, spec 02): the public listing filters by `segment` (several, any of),
 * returns each card's segments and the facet counts, the public segment list feeds the home tiles; a staff member with
 * `products:write` renames and sets segments (compare-and-set, 409 when stale); everyone else is refused.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let staff: Record<string, string>;
let customer: Record<string, string>;

async function person(n: string, role: string | null): Promise<Record<string, string>> {
  const phone = `+9198444444${n}`;
  const token = ctx.verifier.add(`token-segments-staff-test-00${n}`, {
    firebaseUid: `seg-${n}`,
    phone,
    email: `seg-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `seg-${n}`,
    phone,
    email: `seg-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const get = async (path: string): Promise<{ status: number; body: Page }> => {
  const res = await ctx.app.request(`/v1${path}`);
  return { status: res.status, body: (await res.json()) as Page };
};

interface Card {
  slug: string;
  segments: { code: string; name: string }[];
}
interface Page {
  items: Card[];
  facets: { segments: { code: string; name: string; count: number }[] };
}

beforeAll(async () => {
  ctx = await buildApp();
  const db = ctx.db;
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  await db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' });
  const [brand] = await db.insert(s.brands).values({ slug: 'mrf', name: 'MRF' }).returning();
  const cats = await db
    .insert(s.categories)
    .values([
      { slug: 'truck-bus-tyres', name: 'Truck & bus tyres', nameHi: 'ट्रक और बस टायर' },
      { slug: 'two-wheeler-batteries', name: '2W batteries', nameHi: '2W बैटरी' },
      { slug: 'greases', name: 'Greases', nameHi: 'ग्रीस' },
    ])
    .returning();
  const cat = (slug: string) => cats.find((c) => c.slug === slug)!.id;
  for (const [slug, category] of [
    ['truck-tyre-a', 'truck-bus-tyres'],
    ['truck-tyre-b', 'truck-bus-tyres'],
    ['bike-battery', 'two-wheeler-batteries'],
    ['plain-grease', 'greases'],
  ] as const) {
    const [p] = await db
      .insert(s.products)
      .values({
        slug,
        name: slug,
        brandId: brand!.id,
        categoryId: cat(category),
        hsn: '4011',
        gstRateBp: 2800,
        status: 'live',
      })
      .returning();
    await db.insert(s.productVariants).values({ productId: p!.id, sku: `SKU-${slug}`, mrpPaise: 100000 });
  }
  staff = await person('01', 'catalogue_manager');
  customer = await person('02', null);
});

describe('public listing', () => {
  it('filters by one or several segments and tags each card', async () => {
    const truck = await get('/catalogue/products?segment=truck_bus');
    expect(truck.status).toBe(200);
    expect(truck.body.items.map((i) => i.slug).sort()).toEqual(['truck-tyre-a', 'truck-tyre-b']);
    expect(truck.body.items[0]?.segments).toEqual([{ code: 'truck_bus', name: 'Truck & bus' }]);
    const both = await get('/catalogue/products?segment=truck_bus,two_wheeler');
    expect(both.body.items.map((i) => i.slug)).toContain('bike-battery');
    expect(both.body.items).toHaveLength(3);
  });

  it('returns facet counts that ignore the segment filter, in the page language', async () => {
    const hi = await get('/catalogue/products?segment=two_wheeler&locale=hi');
    const byCode = Object.fromEntries(hi.body.facets.segments.map((f) => [f.code, f]));
    expect(byCode.truck_bus).toMatchObject({ count: 2, name: 'ट्रक और बस' });
    expect(byCode.two_wheeler?.count).toBe(1);
    expect(byCode.tractor_farm?.count).toBe(0);
    expect(hi.body.items.map((i) => i.slug)).toEqual(['bike-battery']);
  });

  it('refuses an unknown segment code', async () => {
    for (const bad of ['segment=hovercraft', 'segment=truck_bus,nope']) {
      expect((await get(`/catalogue/products?${bad}`)).status, bad).toBe(400);
    }
  });

  it('lists the active segments for the home tiles, cacheable', async () => {
    const res = await ctx.app.request('/v1/catalogue/segments?locale=hi');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as { segments: { code: string; name: string; count: number }[] };
    expect(body.segments.map((x) => x.code)).toContain('truck_bus');
    expect(body.segments.find((x) => x.code === 'truck_bus')).toMatchObject({ name: 'ट्रक और बस', count: 2 });
  });
});

describe('admin edits', () => {
  it('lists, renames and reorders a segment; a stale version is a 409', async () => {
    const list = await ctx.app.request('/v1/admin/catalogue/segments', { headers: staff });
    expect(list.status).toBe(200);
    const segments = ((await list.json()) as { segments: { code: string; version: number }[] }).segments;
    const truck = segments.find((x) => x.code === 'truck_bus')!;
    const ok = await ctx.app.request('/v1/admin/catalogue/segments/truck_bus', {
      method: 'PATCH',
      headers: staff,
      body: JSON.stringify({ version: truck.version, nameEn: 'Truck, bus & tipper', sort: 5 }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ nameEn: 'Truck, bus & tipper', sort: 5 });
    const stale = await ctx.app.request('/v1/admin/catalogue/segments/truck_bus', {
      method: 'PATCH',
      headers: staff,
      body: JSON.stringify({ version: truck.version, sort: 6 }),
    });
    expect(stale.status).toBe(409);
    const first = await get('/catalogue/products');
    expect(first.body.facets.segments[0]?.code).toBe('truck_bus'); // sort 5 is first now
    expect(first.body.facets.segments[0]?.name).toBe('Truck, bus & tipper');
  });

  it("sets a product's segments with compare-and-set, strict body, unknown product 404", async () => {
    const detail = await ctx.app.request('/v1/admin/catalogue/products/plain-grease', { headers: staff });
    const product = (await detail.json()) as { version: number; segments: string[] };
    expect(product.segments).toEqual([]);
    const put = (body: unknown, slug = 'plain-grease') =>
      ctx.app.request(`/v1/admin/catalogue/products/${slug}/segments`, {
        method: 'PUT',
        headers: staff,
        body: JSON.stringify(body),
      });
    const saved = await put({ version: product.version, segments: ['tractor_farm', 'truck_bus'] });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { segments: string[] }).segments).toEqual(['truck_bus', 'tractor_farm']);
    expect((await put({ version: product.version, segments: [] })).status).toBe(409);
    expect((await put({ version: 99, segments: ['nope'] })).status).toBe(400);
    expect((await put({ version: 99, segments: [], role: 'admin' })).status).toBe(400);
    expect((await put({ version: 1, segments: [] }, 'no-such-product')).status).toBe(404);
    const tagged = await get('/catalogue/products?segment=tractor_farm');
    expect(tagged.body.items.map((i) => i.slug)).toEqual(['plain-grease']);
  });

  it('refuses a customer and a signed-out caller', async () => {
    for (const headers of [customer, { 'content-type': 'application/json' }]) {
      const want = headers === customer ? 403 : 401;
      expect((await ctx.app.request('/v1/admin/catalogue/segments', { headers })).status).toBe(want);
      const patch = await ctx.app.request('/v1/admin/catalogue/segments/truck_bus', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ version: 1, sort: 1 }),
      });
      expect(patch.status).toBe(want);
    }
  });
});
