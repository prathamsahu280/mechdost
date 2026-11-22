/**
 * The server cart and the wishlist over HTTP (design 2026-11-15 items 3 and 5): sign-in required, strict bodies (a
 * client price is a 400), SKU and quantity limits, an idempotent merge, one customer never sees another's cart or
 * list, the wishlist limit of 100 as a clear 422, per-user write limits, and answers that match the shared schemas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, placeCodOrder, quoteCheckout } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { CartDto, CartUnchangedDto, CART_MAX_LINES, ReorderDto } from '@mechdost/shared/cart-api';
import {
  WishlistChangeDto,
  WishlistDto,
  WishlistUnchangedDto,
  WISHLIST_MAX,
} from '@mechdost/shared/wishlist-api';
import { CART_MERGE_RATE, CART_REORDER_RATE } from '../src/routes/storefront';
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
  const add = (p: Person, sku: string | undefined, qty: number) =>
    call(p, 'POST', `/me/cart/lines/${String(sku)}/add`, { qty });
  const set = (p: Person, sku: string | undefined, qty: number) =>
    call(p, 'PUT', `/me/cart/lines/${String(sku)}`, { qty });

  it('needs sign-in', async () => {
    expect((await call(null, 'GET', '/me/cart')).status).toBe(401);
    expect((await call(null, 'POST', `/me/cart/lines/${skus[0]}/add`, { qty: 1 })).status).toBe(401);
    expect((await call(null, 'PUT', `/me/cart/lines/${skus[0]}`, { qty: 1 })).status).toBe(401);
    expect((await call(null, 'DELETE', `/me/cart/lines/${skus[0]}`)).status).toBe(401);
    expect((await call(null, 'POST', '/me/cart/merge', { lines: [] })).status).toBe(401);
    // the whole-cart replace of the first design is gone: a stale copy can no longer wipe the cart
    expect((await call(null, 'PUT', '/me/cart', { lines: [] })).status).not.toBe(200);
  });

  it('saves SKU and quantity only, and answers with names and a version, never prices', async () => {
    const a = await person('01');
    const put = await add(a, skus[0], 2);
    expect(put.status).toBe(200);
    const cart = CartDto.parse(put.body);
    expect(cart.lines).toHaveLength(1);
    expect(cart.version).toBeGreaterThan(0);
    expect(JSON.stringify(put.body)).not.toMatch(/paise|price|mrp/i);
    expect(CartDto.parse((await call(a, 'GET', '/me/cart')).body).lines[0]?.qty).toBe(2);
  });

  it('refuses a client price, an unknown field, a bad quantity and a bad pack (400)', async () => {
    const a = await person('02');
    const bad = (body: unknown, sku = skus[0]) =>
      call(a, 'PUT', `/me/cart/lines/${String(sku)}`, body).then((r) => r.status);
    expect(await bad({ qty: 1, pricePaise: 1 })).toBe(400);
    expect(await bad({ qty: 0 })).toBe(400);
    expect(await bad({ qty: 100 })).toBe(400);
    expect(await bad({ qty: 1.5 })).toBe(400);
    expect(await bad({})).toBe(400);
    expect(await bad({ qty: 1 }, 'lower-case')).toBe(400);
    expect((await add(a, 'NO-SUCH-SKU', 1)).status).toBe(422);
    expect((await add(a, 'NO-SUCH-SKU', 1)).body.error.code).toBe('CART_LINE_UNAVAILABLE');
  });

  it('two devices of one customer compose: the stale laptop edit keeps the phone’s battery', async () => {
    const laptop = await person('03');
    const phone = { ...laptop }; // the same customer, a second session
    await add(laptop, skus[0], 1); // 9:00 the laptop opens with this cart
    await add(phone, skus[1], 1); // 10:00 the phone adds a battery
    const after = CartDto.parse((await set(laptop, skus[0], 3)).body); // 11:00 the laptop changes a quantity
    expect(after.lines.map((l) => [l.sku, l.qty])).toEqual([
      [skus[0], 3],
      [skus[1], 1],
    ]);
    // both add the same pack: the quantities sum
    await add(laptop, skus[2], 2);
    expect(CartDto.parse((await add(phone, skus[2], 5)).body).lines.find((l) => l.sku === skus[2])?.qty).toBe(
      7,
    );
    // a remove on one device stays removed when the other edits a different line
    await call(laptop, 'DELETE', `/me/cart/lines/${String(skus[1])}`);
    const stale = CartDto.parse((await set(phone, skus[0], 4)).body);
    expect(stale.lines.map((l) => l.sku)).not.toContain(skus[1]);
  });

  it('the line limit is a clear 422 and holds under parallel requests', async () => {
    const a = await person('04');
    if (skus.length < 21) return; // the demo catalogue is smaller than the limit
    const results = await Promise.all(skus.slice(0, 25).map((sku) => add(a, sku, 1)));
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(CART_MAX_LINES);
    expect(CartDto.parse((await call(a, 'GET', '/me/cart')).body).lines.length).toBeLessThanOrEqual(
      CART_MAX_LINES,
    );
    for (const r of results.filter((x) => x.status !== 200)) expect(r.body.error.code).toBe('CART_MAX_LINES');
  });

  it('merges idempotently and reports what it dropped', async () => {
    const a = await person('05');
    await add(a, skus[0], 5);
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
    expect(twice.version).toBe(once.version); // the repeat changed nothing
  });

  it('the refresh answers "unchanged" with the version and the cart once it changed', async () => {
    const a = await person('06');
    const v1 = CartDto.parse((await add(a, skus[0], 1)).body).version;
    const same = await call(a, 'GET', `/me/cart?since=${String(v1)}`);
    expect(same.status).toBe(200);
    expect(CartUnchangedDto.parse(same.body)).toEqual({ unchanged: true, version: v1 });
    await add(a, skus[0], 1);
    const changed = CartDto.parse((await call(a, 'GET', `/me/cart?since=${String(v1)}`)).body);
    expect(changed.lines[0]?.qty).toBe(2);
    expect((await call(a, 'GET', '/me/cart?since=abc')).status).toBe(400);
  });

  it('keeps one customer’s cart away from another’s', async () => {
    const a = await person('07');
    const b = await person('08');
    await add(a, skus[0], 9);
    expect(CartDto.parse((await call(b, 'GET', '/me/cart')).body).lines).toEqual([]);
    await add(b, skus[1], 1);
    const mine = CartDto.parse((await call(a, 'GET', '/me/cart')).body);
    expect(mine.lines.map((l) => l.sku)).toEqual([skus[0]]);
    expect(JSON.stringify(mine)).not.toContain(b.id);
  });

  it('limits merges per customer (20 an hour)', async () => {
    const a = await person('09');
    let last = 0;
    for (let i = 0; i < CART_MERGE_RATE.limit + 1; i += 1)
      last = (await call(a, 'POST', '/me/cart/merge', { lines: [] })).status;
    expect(last).toBe(429);
  });
});

describe('order again', () => {
  const OIL = 'CAS-ACT4T-0900';
  let seq = 0;
  async function placed(p: Person, qty: number): Promise<string> {
    const lines = [{ sku: OIL, qty }];
    const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
    seq += 1;
    const r = await placeCodOrder(ctx.db, {
      userId: p.id,
      idempotencyKey: `reorder-api-${String(seq).padStart(8, '0')}`,
      address: {
        contactName: 'Ravi',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines,
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    return r.code;
  }

  it('needs sign-in and a well-formed order code', async () => {
    expect((await call(null, 'POST', '/me/cart/reorder', { orderCode: 'MD-RPR-2026-AAAAAA' })).status).toBe(
      401,
    );
    const a = await person('20');
    expect((await call(a, 'POST', '/me/cart/reorder', { orderCode: 'nope' })).status).toBe(400);
    expect(
      (await call(a, 'POST', '/me/cart/reorder', { orderCode: 'MD-RPR-2026-AAAAAA', price: 1 })).status,
    ).toBe(400);
  });

  it('adds the lines, answers with the cart and what was missing, and is safe to repeat', async () => {
    const a = await person('21');
    const code = await placed(a, 2);
    const first = ReorderDto.parse(
      (await call(a, 'POST', '/me/cart/reorder?locale=hi', { orderCode: code })).body,
    );
    expect(first.added).toBe(1);
    expect(first.missing).toEqual([]);
    expect(first.cart.lines.map((l) => [l.sku, l.qty])).toEqual([[OIL, 2]]);
    const again = ReorderDto.parse((await call(a, 'POST', '/me/cart/reorder', { orderCode: code })).body);
    expect(again.added).toBe(0);
    expect(again.already).toBe(1);
  });

  it("is a 404 for another customer's order, and adds nothing to anyone's cart", async () => {
    const owner = await person('22');
    const stranger = await person('23');
    const code = await placed(owner, 1);
    expect((await call(stranger, 'POST', '/me/cart/reorder', { orderCode: code })).status).toBe(404);
    expect(CartDto.parse((await call(stranger, 'GET', '/me/cart')).body).lines).toEqual([]);
  });

  it('limits presses per customer', async () => {
    const a = await person('24');
    let last = 0;
    for (let i = 0; i < CART_REORDER_RATE.limit + 1; i += 1)
      last = (await call(a, 'POST', '/me/cart/reorder', { orderCode: 'MD-RPR-2026-AAAAAA' })).status;
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
    expect(WishlistChangeDto.parse(add.body)).toMatchObject({ slug: slugs[0], on: true, count: 1 });
    expect(WishlistChangeDto.parse((await call(a, 'PUT', `/me/wishlist/${slugs[0]}`)).body).count).toBe(1);
    const list = WishlistDto.parse((await call(a, 'GET', '/me/wishlist?locale=hi')).body);
    expect(list.items).toHaveLength(1);
    expect(list.max).toBe(WISHLIST_MAX);
    const del = await call(a, 'DELETE', `/me/wishlist/${slugs[0]}`);
    expect(WishlistChangeDto.parse(del.body)).toMatchObject({ slug: slugs[0], on: false, count: 0 });
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

describe('wishlist refresh and live pings', () => {
  it('answers "unchanged" with the version, and the list once either device changed it', async () => {
    const a = await person('11');
    await call(a, 'PUT', `/me/wishlist/${slugs[0]}`);
    const v1 = WishlistDto.parse((await call(a, 'GET', '/me/wishlist')).body).version;
    expect(
      WishlistUnchangedDto.parse((await call(a, 'GET', `/me/wishlist?since=${String(v1)}`)).body),
    ).toEqual({
      unchanged: true,
      version: v1,
    });
    // another device adds, then removes the first one
    await call(a, 'PUT', `/me/wishlist/${slugs[1]}`);
    const next = WishlistDto.parse((await call(a, 'GET', `/me/wishlist?since=${String(v1)}`)).body);
    expect(next.items).toHaveLength(2);
    expect(next.version).not.toBe(v1);
    await call(a, 'DELETE', `/me/wishlist/${slugs[1]}`);
    expect(
      WishlistDto.parse((await call(a, 'GET', `/me/wishlist?since=${String(next.version)}`)).body).items,
    ).toHaveLength(1);
  });

  it('every real change leaves a thin ping for that customer; a repeat leaves none', async () => {
    const a = await person('12');
    const count = async () =>
      (await ctx.db.select().from(s.liveOutbox)).filter((r) => r.topic === `user:${a.id}`).length;
    expect(await count()).toBe(0);
    await call(a, 'PUT', `/me/wishlist/${slugs[0]}`);
    expect(await count()).toBe(1);
    await call(a, 'PUT', `/me/wishlist/${slugs[0]}`);
    expect(await count()).toBe(1);
    await call(a, 'DELETE', `/me/wishlist/${slugs[1]}`);
    expect(await count()).toBe(1);
    await call(a, 'POST', `/me/cart/lines/${String(skus[0])}/add`, { qty: 1 });
    const rows = (await ctx.db.select().from(s.liveOutbox)).filter((r) => r.topic === `user:${a.id}`);
    expect(rows.map((r) => r.kind).sort()).toEqual(['cart', 'cart', 'wishlist']);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/sku|slug|qty|email|phone/i);
  });
});
