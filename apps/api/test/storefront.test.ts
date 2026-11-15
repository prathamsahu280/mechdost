/**
 * The server cart and the wishlist over HTTP (design 2026-11-15 items 3 and 5): sign-in required, strict bodies (a
 * client price is a 400), SKU and quantity limits, an idempotent merge, one customer never sees another's cart or
 * list, the wishlist limit of 100 as a clear 422, per-user write limits, and answers that match the shared schemas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { CartDto, CART_MAX_LINES } from '@mechdost/shared/cart-api';
import { WishlistChangeDto, WishlistDto, WISHLIST_MAX } from '@mechdost/shared/wishlist-api';
import { CART_MERGE_RATE } from '../src/routes/storefront';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
let skus: string[] = [];
let slugs: string[] = [];

interface Person {
  id: string;
  headers: Record<string, string>;
}
async function person(n: string): Promise<Person> {
  const identity = {
    firebaseUid: `store-${n}`,
    phone: `+9198777000${n}`,
    email: `store-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-storefront-000${n}`, identity);
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
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  const variants = await ctx.db.select().from(s.productVariants);
  const productRows = await ctx.db.select().from(s.products);
  const live = new Map(productRows.filter((p) => p.status === 'live').map((p) => [p.id, p.slug]));
  const sellable = variants.filter((v) => v.status === 'active' && live.has(v.productId));
  skus = sellable.map((v) => v.sku).sort();
  slugs = [...new Set(sellable.map((v) => live.get(v.productId)!))];
});

describe('server cart', () => {
  it('needs sign-in', async () => {
    expect((await call(null, 'GET', '/me/cart')).status).toBe(401);
    expect((await call(null, 'PUT', '/me/cart', { lines: [] })).status).toBe(401);
    expect((await call(null, 'POST', '/me/cart/merge', { lines: [] })).status).toBe(401);
  });

  it('saves SKU and quantity only, and answers with names, never prices', async () => {
    const a = await person('01');
    const put = await call(a, 'PUT', '/me/cart', { lines: [{ sku: skus[0], qty: 2 }] });
    expect(put.status).toBe(200);
    const cart = CartDto.parse(put.body);
    expect(cart.lines).toHaveLength(1);
    expect(JSON.stringify(put.body)).not.toMatch(/paise|price|mrp/i);
    expect(CartDto.parse((await call(a, 'GET', '/me/cart')).body).lines[0]?.qty).toBe(2);
  });

  it('refuses a client price, an unknown field, a bad quantity and too many lines (400)', async () => {
    const a = await person('02');
    const bad = (lines: unknown) => call(a, 'PUT', '/me/cart', { lines }).then((r) => r.status);
    expect(await bad([{ sku: skus[0], qty: 1, pricePaise: 1 }])).toBe(400);
    expect(await bad([{ sku: skus[0], qty: 0 }])).toBe(400);
    expect(await bad([{ sku: skus[0], qty: 100 }])).toBe(400);
    expect(await bad([{ sku: skus[0], qty: 1.5 }])).toBe(400);
    expect(await bad([{ sku: 'lower-case', qty: 1 }])).toBe(400);
    const many = Array.from({ length: CART_MAX_LINES + 1 }, (_, i) => ({ sku: `SKU-${String(i)}X`, qty: 1 }));
    expect(await bad(many)).toBe(400);
    expect((await call(a, 'PUT', '/me/cart', { lines: [], extra: 1 })).status).toBe(400);
  });

  it('merges idempotently and reports what it dropped', async () => {
    const a = await person('03');
    await call(a, 'PUT', '/me/cart', { lines: [{ sku: skus[0], qty: 5 }] });
    const guest = {
      lines: [
        { sku: skus[0], qty: 2 },
        { sku: skus[1], qty: 3 },
        { sku: 'GONE-SKU-1', qty: 1 },
      ],
    };
    const first = await call(a, 'POST', '/me/cart/merge?locale=hi', guest);
    expect(first.status).toBe(200);
    const once = CartDto.parse(first.body);
    expect(once.lines.map((l) => [l.sku, l.qty])).toEqual([
      [skus[0], 5],
      [skus[1], 3],
    ]);
    expect(once.dropped).toEqual([{ sku: 'GONE-SKU-1', reason: 'unknown_sku' }]);
    const twice = CartDto.parse((await call(a, 'POST', '/me/cart/merge', guest)).body);
    expect(twice.lines.map((l) => [l.sku, l.qty])).toEqual(once.lines.map((l) => [l.sku, l.qty]));
  });

  it('keeps one customer’s cart away from another’s', async () => {
    const a = await person('04');
    const b = await person('05');
    await call(a, 'PUT', '/me/cart', { lines: [{ sku: skus[0], qty: 9 }] });
    expect(CartDto.parse((await call(b, 'GET', '/me/cart')).body).lines).toEqual([]);
    await call(b, 'PUT', '/me/cart', { lines: [{ sku: skus[1], qty: 1 }] });
    const mine = CartDto.parse((await call(a, 'GET', '/me/cart')).body);
    expect(mine.lines.map((l) => l.sku)).toEqual([skus[0]]);
    expect(JSON.stringify(mine)).not.toContain(b.id);
  });

  it('limits merges per customer (20 an hour)', async () => {
    const a = await person('06');
    let last = 0;
    for (let i = 0; i < CART_MERGE_RATE.limit + 1; i += 1)
      last = (await call(a, 'POST', '/me/cart/merge', { lines: [] })).status;
    expect(last).toBe(429);
  });
});

describe('wishlist', () => {
  it('needs sign-in', async () => {
    expect((await call(null, 'GET', '/me/wishlist')).status).toBe(401);
    expect((await call(null, 'PUT', `/me/wishlist/${slugs[0]}`)).status).toBe(401);
    expect((await call(null, 'DELETE', `/me/wishlist/${slugs[0]}`)).status).toBe(401);
  });

  it('adds, lists in the locale and removes, repeating safely', async () => {
    const a = await person('07');
    const add = await call(a, 'PUT', `/me/wishlist/${slugs[0]}`);
    expect(WishlistChangeDto.parse(add.body)).toEqual({ slug: slugs[0], on: true, count: 1 });
    expect(WishlistChangeDto.parse((await call(a, 'PUT', `/me/wishlist/${slugs[0]}`)).body).count).toBe(1);
    const list = WishlistDto.parse((await call(a, 'GET', '/me/wishlist?locale=hi')).body);
    expect(list.items).toHaveLength(1);
    expect(list.max).toBe(WISHLIST_MAX);
    const del = await call(a, 'DELETE', `/me/wishlist/${slugs[0]}`);
    expect(WishlistChangeDto.parse(del.body)).toEqual({ slug: slugs[0], on: false, count: 0 });
    expect(WishlistChangeDto.parse((await call(a, 'DELETE', `/me/wishlist/${slugs[0]}`)).body).count).toBe(0);
  });

  it('is 404 for an unknown product, 400 for a malformed slug, and private to each customer', async () => {
    const a = await person('08');
    const b = await person('09');
    expect((await call(a, 'PUT', '/me/wishlist/no-such-product')).status).toBe(404);
    expect((await call(a, 'PUT', '/me/wishlist/Not_A_Slug')).status).toBe(400);
    await call(a, 'PUT', `/me/wishlist/${slugs[0]}`);
    expect(WishlistDto.parse((await call(b, 'GET', '/me/wishlist')).body).items).toEqual([]);
  });

  it('says clearly when the list is full (422 WISHLIST_FULL)', async () => {
    const a = await person('10');
    const [src] = await ctx.db.select().from(s.products).limit(1);
    const extra: string[] = [];
    for (let i = 0; i < WISHLIST_MAX; i += 1) {
      const [p] = await ctx.db
        .insert(s.products)
        .values({
          slug: `api-wish-${String(i)}`,
          name: `Wish ${String(i)}`,
          brandId: src!.brandId,
          categoryId: src!.categoryId,
          hsn: src!.hsn,
          gstRateBp: src!.gstRateBp,
          status: 'live',
        })
        .returning();
      extra.push(p!.slug);
    }
    for (const slug of extra.slice(0, WISHLIST_MAX))
      await ctx.db.insert(s.wishlistItems).values({
        userId: a.id,
        productId: (await ctx.db.select().from(s.products)).find((p) => p.slug === slug)!.id,
      });
    const full = await call(a, 'PUT', `/me/wishlist/${slugs[0]}`);
    expect(full.status).toBe(422);
    expect(full.body.error.code).toBe('WISHLIST_FULL');
  });
});
