/**
 * Catalogue API (spec 02): public, cacheable, localised; strict query validation; internal ids never leave
 * the API; unknown products and cities are 404, tampered cursors 422.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '@mechdost/db/schema';
import { buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  ctx = await buildApp();
  const db = ctx.db;
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: city!.id,
    centroid: { lng: 81.64, lat: 21.227 },
  });
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', nameHi: 'बैटरी' })
    .returning();
  const [brand] = await db.insert(s.brands).values({ slug: 'exide', name: 'Exide' }).returning();
  const [p] = await db
    .insert(s.products)
    .values({
      slug: 'exide-xltz4a',
      name: 'Exide Xplore XLTZ4A battery',
      nameHi: 'Exide Xplore XLTZ4A बैटरी',
      brandId: brand!.id,
      categoryId: cat!.id,
      hsn: '8507',
      gstRateBp: 1800,
      status: 'live',
    })
    .returning();
  const [v] = await db
    .insert(s.productVariants)
    .values({ productId: p!.id, sku: 'EXI-XLTZ4A', mrpPaise: 150000 })
    .returning();
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Sarona Auto Parts',
      phone: '+919800000001',
      addressLine: 'Sarona',
      pincode: '492001',
      cityId: city!.id,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  await db.insert(s.shopPincodes).values({ shopId: shop!.id, pincode: '492001', shippingPaise: 0 });
  await db
    .insert(s.shopInventory)
    .values({ shopId: shop!.id, variantId: v!.id, sellingPaise: 100000, onHand: 3 });
});

describe('catalogue API', () => {
  it('lists products for a PIN, cacheable, without internal ids', async () => {
    const res = await ctx.app.request('/v1/catalogue/products?pincode=492001&locale=hi');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as { place: unknown; items: Record<string, unknown>[]; nextCursor: null };
    expect(body.place).toEqual({ cityCode: 'RPR', pincode: '492001', pincodeKnown: true });
    expect(body.items[0]).toMatchObject({
      slug: 'exide-xltz4a',
      name: 'Exide Xplore XLTZ4A बैटरी',
      category: { slug: 'batteries', name: 'बैटरी' },
      offer: { pricePaise: 100000, mrpPaise: 150000, shippingPaise: 0 },
      vehicleTypes: [], // fitment not listed
    });
    expect(body.items[0]).not.toHaveProperty('id');
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no uuids at all
  });

  it('validates the query strictly', async () => {
    for (const bad of [
      'pincode=12345',
      'city=raipur',
      'limit=500',
      'sort=cheapest',
      `q=${'x'.repeat(81)}`,
      'vehicle=EV',
    ]) {
      const res = await ctx.app.request(`/v1/catalogue/products?${bad}`);
      expect(res.status, bad).toBe(400);
    }
    const cursor = await ctx.app.request('/v1/catalogue/products?cursor=abc');
    expect(cursor.status).toBe(422);
    expect(((await cursor.json()) as ErrorJson).error.code).toBe('INVALID_CURSOR');
    // Review B6: a well-formed cursor whose key does not fit the sort is a 422, never a cast error (500).
    const forge = (k: string) =>
      Buffer.from(JSON.stringify({ k, id: '01890000-0000-7000-8000-000000000000' })).toString('base64url');
    const cases: [sort: string, key: string][] = [
      ['price_asc', '2026-11-01 10:00:00+00'],
      ['newest', 'not-a-date'],
      ['relevance', 'abc'],
    ];
    for (const [sort, k] of cases) {
      const res = await ctx.app.request(`/v1/catalogue/products?sort=${sort}&cursor=${forge(k)}`);
      expect(res.status, sort).toBe(422);
      expect(((await res.json()) as ErrorJson).error.code, sort).toBe('INVALID_CURSOR');
    }
    expect((await ctx.app.request('/v1/catalogue/products?city=XYZ')).status).toBe(404);
  });

  it('serves a product page with the seller, and categories', async () => {
    const res = await ctx.app.request('/v1/catalogue/products/exide-xltz4a?pincode=492001');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: 'Exide Xplore XLTZ4A battery',
      variants: [{ sku: 'EXI-XLTZ4A', offer: { pricePaise: 100000, seller: 'Sarona Auto Parts' } }],
    });
    expect((await ctx.app.request('/v1/catalogue/products/unknown-thing')).status).toBe(404);
    expect((await ctx.app.request('/v1/catalogue/products/Bad_Slug')).status).toBe(400);
    const cats = (await (await ctx.app.request('/v1/catalogue/categories?locale=hi')).json()) as {
      categories: { slug: string; name: string; liveProducts: number }[];
    };
    expect(cats.categories).toEqual([
      expect.objectContaining({ slug: 'batteries', name: 'बैटरी', liveProducts: 1 }),
    ]);
  });
});
