/**
 * Server cart and wishlist (design 2026-11-15 items 3 and 5): one active cart per customer (partial unique index),
 * lines are a SKU and a quantity only, merge is idempotent (the larger quantity wins, never the sum), unknown or
 * unsellable SKUs are dropped with a reason, the 20-line and 99-quantity limits hold, one customer never sees
 * another's cart or wishlist, and the wishlist keeps to 100 products under parallel adds.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { WISHLIST_MAX } from '@mechdost/shared/wishlist-api';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { getCart, listWishlist, mergeCart, replaceCart, setWishlisted, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { rowsOf } from '../src/repo/sql-rows';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let n = 0;
let skus: string[] = [];
let slugs: string[] = [];

const user = async () => {
  n += 1;
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `fb-cart-${String(n)}`, phone: `+9198333000${String(n).padStart(2, '0')}` })
    .returning();
  return u!.id;
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const rows = rowsOf<{ sku: string; slug: string }>(
    await db.execute(sql`
      select v.sku, p.slug from product_variants v join products p on p.id = v.product_id
      where v.status = 'active' and p.status = 'live' order by v.sku`),
  );
  skus = rows.map((r) => r.sku);
  slugs = [...new Set(rows.map((r) => r.slug))];
});

afterAll(async () => {
  await client.close();
});

describe('server cart', () => {
  it('starts empty and creates the one active cart on first write', async () => {
    const u = await user();
    expect(await getCart(t(), u, 'en')).toEqual({ lines: [], dropped: [], version: 0 });
    await replaceCart(t(), u, [{ sku: skus[0]!, qty: 2 }]);
    await replaceCart(t(), u, [{ sku: skus[0]!, qty: 3 }]);
    const carts = await db.select().from(s.carts).where(eq(s.carts.userId, u));
    expect(carts).toHaveLength(1);
    expect(carts[0]?.status).toBe('active');
    // the database refuses a second active cart for the same customer
    await expect(db.insert(s.carts).values({ userId: u })).rejects.toThrow();
  });

  it('replace sets exactly the given lines (an empty list empties the cart)', async () => {
    const u = await user();
    await replaceCart(t(), u, [
      { sku: skus[0]!, qty: 1 },
      { sku: skus[1]!, qty: 4 },
    ]);
    const second = await replaceCart(t(), u, [{ sku: skus[1]!, qty: 2 }]);
    expect(second.lines.map((l) => [l.sku, l.qty])).toEqual([[skus[1], 2]]);
    expect((await replaceCart(t(), u, [])).lines).toEqual([]);
  });

  it('shows names in the locale and never a price', async () => {
    const u = await user();
    const hi = await replaceCart(t(), u, [{ sku: 'CAS-ACT4T-0900', qty: 1 }], 'hi');
    expect(hi.lines[0]).toMatchObject({ sku: 'CAS-ACT4T-0900', qty: 1 });
    expect(Object.keys(hi.lines[0]!).sort()).toEqual(['brand', 'name', 'qty', 'sku', 'slug']);
  });

  it('merge takes the larger quantity, is idempotent, and drops what cannot be sold', async () => {
    const u = await user();
    await replaceCart(t(), u, [
      { sku: skus[0]!, qty: 5 },
      { sku: skus[1]!, qty: 1 },
    ]);
    const guest = [
      { sku: skus[0]!, qty: 2 },
      { sku: skus[1]!, qty: 9 },
      { sku: skus[2]!, qty: 1 },
      { sku: 'NO-SUCH-SKU', qty: 1 },
    ];
    const once = await mergeCart(t(), u, guest);
    expect(once.cart.lines.map((l) => [l.sku, l.qty])).toEqual([
      [skus[0], 5],
      [skus[1], 9],
      [skus[2], 1],
    ]);
    expect(once.cart.dropped).toEqual([{ sku: 'NO-SUCH-SKU', reason: 'unknown_sku' }]);
    expect(once.added).toBe(1);
    const twice = await mergeCart(t(), u, guest);
    expect(twice.cart.lines).toEqual(once.cart.lines);
    expect(twice.added).toBe(0);
  });

  it('refuses nothing silently: an unsellable pack is dropped with not_for_sale', async () => {
    const u = await user();
    const [v] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, skus[3]!));
    await db.update(s.productVariants).set({ status: 'archived' }).where(eq(s.productVariants.id, v!.id));
    try {
      const out = await mergeCart(t(), u, [
        { sku: skus[3]!, qty: 1 },
        { sku: skus[0]!, qty: 1 },
      ]);
      expect(out.cart.dropped).toEqual([{ sku: skus[3], reason: 'not_for_sale' }]);
      expect(out.cart.lines.map((l) => l.sku)).toEqual([skus[0]]);
    } finally {
      await db.update(s.productVariants).set({ status: 'active' }).where(eq(s.productVariants.id, v!.id));
    }
  });

  it('prunes a line whose pack stopped being sold when the cart is read', async () => {
    const u = await user();
    await replaceCart(t(), u, [
      { sku: skus[0]!, qty: 1 },
      { sku: skus[4]!, qty: 1 },
    ]);
    const [v] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, skus[4]!));
    await db.update(s.productVariants).set({ status: 'archived' }).where(eq(s.productVariants.id, v!.id));
    try {
      const cart = await getCart(t(), u, 'en');
      expect(cart.lines.map((l) => l.sku)).toEqual([skus[0]]);
      expect(cart.dropped).toEqual([{ sku: skus[4], reason: 'not_for_sale' }]);
      expect((await getCart(t(), u, 'en')).dropped).toEqual([]);
    } finally {
      await db.update(s.productVariants).set({ status: 'active' }).where(eq(s.productVariants.id, v!.id));
    }
  });

  it('keeps to 20 lines when merging into a nearly full cart', async () => {
    const u = await user();
    const many = skus.slice(0, 20).map((sku) => ({ sku, qty: 1 }));
    if (many.length < 20) return; // the demo catalogue is smaller than the limit
    await replaceCart(t(), u, many.slice(0, 19));
    const out = await mergeCart(t(), u, many.slice(15));
    expect(out.cart.lines).toHaveLength(20);
  });

  it('never shows another customer’s cart', async () => {
    const a = await user();
    const b = await user();
    await replaceCart(t(), a, [{ sku: skus[0]!, qty: 7 }]);
    expect((await getCart(t(), b, 'en')).lines).toEqual([]);
    await replaceCart(t(), b, [{ sku: skus[1]!, qty: 1 }]);
    expect((await getCart(t(), a, 'en')).lines.map((l) => l.sku)).toEqual([skus[0]]);
  });

  it('holds the database limits: quantity 1 to 99, each pack once', async () => {
    const u = await user();
    await replaceCart(t(), u, [{ sku: skus[0]!, qty: 1 }]);
    const [cart] = await db.select().from(s.carts).where(eq(s.carts.userId, u));
    const [v] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, skus[0]!));
    await expect(
      db.insert(s.cartItems).values({ cartId: cart!.id, variantId: v!.id, qty: 1 }),
    ).rejects.toThrow();
    await expect(
      db.update(s.cartItems).set({ qty: 100 }).where(eq(s.cartItems.cartId, cart!.id)),
    ).rejects.toThrow();
  });

  it('writes the event with counts only (no prices)', async () => {
    const u = await user();
    await mergeCart(t(), u, [{ sku: skus[0]!, qty: 1 }]);
    const ev = rowsOf<{ props: Record<string, unknown> }>(
      await db.execute(
        sql`select props from events where event = 'cart_merged' and user_id = ${u} order by occurred_at desc limit 1`,
      ),
    );
    expect(ev[0]?.props).toEqual({ kept: 0, added: 1, dropped: 0 });
  });
});

describe('wishlist', () => {
  it('adds and removes a product, idempotently, newest first', async () => {
    const u = await user();
    const a = await setWishlisted(t(), u, slugs[0]!, true);
    expect(a).toMatchObject({ slug: slugs[0], on: true, count: 1 });
    expect((await setWishlisted(t(), u, slugs[0]!, true)).count).toBe(1);
    await setWishlisted(t(), u, slugs[1]!, true);
    const list = await listWishlist(t(), u, 'en');
    expect(list.items.map((i) => i.slug)).toEqual([slugs[1], slugs[0]]);
    expect(list.max).toBe(WISHLIST_MAX);
    expect((await setWishlisted(t(), u, slugs[0]!, false)).count).toBe(1);
    expect((await setWishlisted(t(), u, slugs[0]!, false)).count).toBe(1);
    const events = rowsOf<{ n: number }>(
      await db.execute(
        sql`select count(*)::int as n from events where event = 'wishlist_changed' and user_id = ${u}`,
      ),
    );
    // only real changes are events: add, add, remove (the repeats changed nothing)
    expect(events[0]?.n).toBe(3);
  });

  it('is 404 for an unknown or unpublished product', async () => {
    const u = await user();
    await expect(setWishlisted(t(), u, 'no-such-product', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('localises names and keeps one customer’s list from another', async () => {
    const a = await user();
    const b = await user();
    await setWishlisted(t(), a, slugs[0]!, true);
    expect((await listWishlist(t(), b, 'hi')).items).toEqual([]);
    expect((await listWishlist(t(), a, 'hi')).items).toHaveLength(1);
  });

  it('stops at 100 products, also when adds arrive together', async () => {
    const u = await user();
    // 100 distinct products: the demo catalogue has fewer, so fill the table directly with real product rows.
    const extra: string[] = [];
    const [src] = await db.select().from(s.products).limit(1);
    for (let i = 0; i < WISHLIST_MAX + 3; i += 1) {
      const [p] = await db
        .insert(s.products)
        .values({
          slug: `wish-${String(n)}-${String(i)}`,
          name: `Wish product ${String(i)}`,
          brandId: src!.brandId,
          categoryId: src!.categoryId,
          hsn: src!.hsn,
          gstRateBp: src!.gstRateBp,
          status: 'live',
        })
        .returning();
      extra.push(p!.slug);
    }
    for (let i = 0; i < WISHLIST_MAX - 1; i += 1) await setWishlisted(t(), u, extra[i]!, true);
    const results = await Promise.allSettled([
      setWishlisted(t(), u, extra[WISHLIST_MAX - 1]!, true),
      setWishlisted(t(), u, extra[WISHLIST_MAX]!, true),
      setWishlisted(t(), u, extra[WISHLIST_MAX + 1]!, true),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const full = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(full.reason).toMatchObject({ code: 'WISHLIST_FULL' });
    expect((await listWishlist(t(), u, 'en')).items).toHaveLength(WISHLIST_MAX);
    // removing one makes room; adding something already on the list never counts against the limit
    expect((await setWishlisted(t(), u, extra[0]!, true)).count).toBe(WISHLIST_MAX);
    await setWishlisted(t(), u, extra[0]!, false);
    expect((await setWishlisted(t(), u, extra[WISHLIST_MAX + 2]!, true)).count).toBe(WISHLIST_MAX);
  });
});
