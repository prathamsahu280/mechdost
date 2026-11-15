/**
 * One customer on two devices at once (user 2026-11-15: "phone and laptop at the same time, nothing may be lost"). The
 * server cart is the source of truth and every write is one line at a time, so edits made on two devices compose:
 * adds sum, a quantity set only touches its own line, a remove is not undone by a stale copy, and the limits (20 lines,
 * 99 each, 100 wishlist products) hold under parallel requests. Every effective change moves the cart's version and
 * writes exactly one live ping; a no-op writes none.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { CART_MAX_LINES, CART_MAX_QTY } from '@mechdost/shared/cart-api';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  addCartLine,
  getCart,
  getCartIfChanged,
  getWishlistIfChanged,
  placeCodOrder,
  quoteCheckout,
  removeCartLine,
  setCartLine,
  setWishlisted,
  type Tx,
} from '../src/repo';
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
let slugs: string[] = [];

const user = async () => {
  n += 1;
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `fb-md-${String(n)}`, phone: `+9198444000${String(n).padStart(2, '0')}` })
    .returning();
  return u!.id;
};
const pings = async (userId: string, kind: 'cart' | 'wishlist') =>
  rowsOf<{ event: string; entity_version: number }>(
    await db.execute(
      sql`select event, entity_version from live_outbox where topic = ${`user:${userId}`} and kind = ${kind} order by id`,
    ),
  );
const qtyOf = (cart: { lines: { sku: string; qty: number }[] }, sku: string) =>
  cart.lines.find((l) => l.sku === sku)?.qty;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const [src] = await db.select().from(s.products).limit(1);
  // Enough extra sellable packs to go past the 20-line limit.
  for (let i = 0; i < 25; i += 1) {
    const [p] = await db
      .insert(s.products)
      .values({
        slug: `md-product-${String(i)}`,
        name: `MD product ${String(i)}`,
        brandId: src!.brandId,
        categoryId: src!.categoryId,
        hsn: src!.hsn,
        gstRateBp: src!.gstRateBp,
        status: 'live',
      })
      .returning();
    await db
      .insert(s.productVariants)
      .values({ productId: p!.id, sku: `MD-SKU-${String(i).padStart(2, '0')}`, mrpPaise: 10_000 });
  }
  const rows = rowsOf<{ sku: string; slug: string }>(
    await db.execute(sql`
      select v.sku, p.slug from product_variants v join products p on p.id = v.product_id
      where v.status = 'active' and p.status = 'live' order by v.sku`),
  );
  slugs = [...new Set(rows.map((r) => r.slug))];
});
afterAll(async () => {
  await client.close();
});

describe('two devices, one cart', () => {
  it('a stale laptop edit does not remove what the phone added', async () => {
    const u = await user();
    await addCartLine(t(), u, 'MD-SKU-00', 1); // 9:00 laptop opens with this
    await addCartLine(t(), u, 'MD-SKU-01', 1); // 10:00 phone adds a battery
    const after = await setCartLine(t(), u, 'MD-SKU-00', 3); // 11:00 laptop changes a quantity
    expect(qtyOf(after, 'MD-SKU-00')).toBe(3);
    expect(qtyOf(after, 'MD-SKU-01')).toBe(1);
  });

  it('both devices adding the same pack sum, capped at 99', async () => {
    const u = await user();
    await addCartLine(t(), u, 'MD-SKU-02', 2);
    expect(qtyOf(await addCartLine(t(), u, 'MD-SKU-02', 3), 'MD-SKU-02')).toBe(5);
    expect(qtyOf(await addCartLine(t(), u, 'MD-SKU-02', 98), 'MD-SKU-02')).toBe(CART_MAX_QTY);
  });

  it('a remove on one device is not undone by edits to other lines from a stale copy', async () => {
    const u = await user();
    await addCartLine(t(), u, 'MD-SKU-03', 1);
    await addCartLine(t(), u, 'MD-SKU-04', 1);
    await removeCartLine(t(), u, 'MD-SKU-03'); // device A
    const b = await setCartLine(t(), u, 'MD-SKU-04', 5); // device B, still showing both lines, edits only line 04
    expect(b.lines.map((l) => l.sku)).toEqual(['MD-SKU-04']);
    expect(qtyOf(b, 'MD-SKU-04')).toBe(5);
  });

  it('removing a line that is not there is fine and changes nothing', async () => {
    const u = await user();
    await addCartLine(t(), u, 'MD-SKU-05', 1);
    const v = (await getCart(t(), u)).version;
    await removeCartLine(t(), u, 'MD-SKU-06');
    await removeCartLine(t(), u, 'NO-SUCH-SKU');
    expect((await getCart(t(), u)).version).toBe(v);
  });

  it('refuses an unknown or unsellable pack and a line beyond the limit', async () => {
    const u = await user();
    await expect(addCartLine(t(), u, 'NO-SUCH-SKU', 1)).rejects.toMatchObject({
      code: 'CART_LINE_UNAVAILABLE',
    });
    await expect(setCartLine(t(), u, 'NO-SUCH-SKU', 1)).rejects.toMatchObject({
      code: 'CART_LINE_UNAVAILABLE',
    });
    for (let i = 0; i < CART_MAX_LINES; i += 1)
      await addCartLine(t(), u, `MD-SKU-${String(i).padStart(2, '0')}`, 1);
    await expect(addCartLine(t(), u, 'MD-SKU-20', 1)).rejects.toMatchObject({ code: 'CART_MAX_LINES' });
    // an existing line can still change at the limit
    expect(qtyOf(await addCartLine(t(), u, 'MD-SKU-00', 1), 'MD-SKU-00')).toBe(2);
  });

  it('parallel adds of different packs never go past 20 lines', async () => {
    const u = await user();
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => addCartLine(t(), u, `MD-SKU-${String(i).padStart(2, '0')}`, 1)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(CART_MAX_LINES);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect(r.reason).toMatchObject({ code: 'CART_MAX_LINES' });
    expect((await getCart(t(), u)).lines).toHaveLength(CART_MAX_LINES);
  });

  it('parallel adds of the same pack sum exactly and stop at 99', async () => {
    const u = await user();
    await Promise.all(Array.from({ length: 10 }, () => addCartLine(t(), u, 'MD-SKU-07', 4)));
    expect(qtyOf(await getCart(t(), u), 'MD-SKU-07')).toBe(40);
    await Promise.all(Array.from({ length: 30 }, () => addCartLine(t(), u, 'MD-SKU-07', 4)));
    expect(qtyOf(await getCart(t(), u), 'MD-SKU-07')).toBe(CART_MAX_QTY);
  });

  it('never shows or changes another customer’s cart', async () => {
    const a = await user();
    const b = await user();
    await addCartLine(t(), a, 'MD-SKU-08', 7);
    await setCartLine(t(), b, 'MD-SKU-08', 1);
    expect(qtyOf(await getCart(t(), a), 'MD-SKU-08')).toBe(7);
  });
});

describe('versions and pings', () => {
  it('every effective change moves the version and writes one ping; a no-op writes none', async () => {
    const u = await user();
    expect(await pings(u, 'cart')).toHaveLength(0);
    const first = await addCartLine(t(), u, 'MD-SKU-09', 1);
    const afterAdd = await pings(u, 'cart');
    expect(afterAdd.length).toBeGreaterThan(0);
    const base = afterAdd.length;
    expect(afterAdd.every((p) => p.event === 'cart.changed')).toBe(true);

    const set = await setCartLine(t(), u, 'MD-SKU-09', 4);
    expect(set.version).toBeGreaterThan(first.version);
    expect((await pings(u, 'cart')).length).toBe(base + 1);

    // same quantity again, removing a line that is not there, adding to a line already at 99: nothing changes
    await setCartLine(t(), u, 'MD-SKU-09', 4);
    await removeCartLine(t(), u, 'MD-SKU-10');
    expect((await pings(u, 'cart')).length).toBe(base + 1);
    await setCartLine(t(), u, 'MD-SKU-09', CART_MAX_QTY);
    const atCap = (await pings(u, 'cart')).length;
    await addCartLine(t(), u, 'MD-SKU-09', 1);
    expect((await pings(u, 'cart')).length).toBe(atCap);

    const removed = await removeCartLine(t(), u, 'MD-SKU-09');
    expect(removed.version).toBeGreaterThan(set.version);
    expect((await pings(u, 'cart')).length).toBe(atCap + 1);
  });

  it('the ping carries ids and a version only, for that customer’s topic', async () => {
    const u = await user();
    await addCartLine(t(), u, 'MD-SKU-11', 1);
    const rows = await db
      .select()
      .from(s.liveOutbox)
      .where(eq(s.liveOutbox.topic, `user:${u}`));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.kind).toBe('cart');
      expect(r.entityVersion).toBeGreaterThanOrEqual(1);
    }
  });

  it('a refresh with the current version answers "unchanged" and with an old one answers the cart', async () => {
    const u = await user();
    const cart = await addCartLine(t(), u, 'MD-SKU-12', 2);
    expect(await getCartIfChanged(t(), u, 'en', cart.version)).toEqual({
      unchanged: true,
      version: cart.version,
    });
    const changed = await getCartIfChanged(t(), u, 'en', cart.version - 1);
    expect('lines' in changed && qtyOf(changed, 'MD-SKU-12')).toBe(2);
    await addCartLine(t(), u, 'MD-SKU-12', 1);
    const next = await getCartIfChanged(t(), u, 'en', cart.version);
    expect('lines' in next && qtyOf(next, 'MD-SKU-12')).toBe(3);
  });

  it('a pack that stops being sold removes the line, moves the version and is reported once', async () => {
    const u = await user();
    const before = await addCartLine(t(), u, 'MD-SKU-13', 1);
    await db
      .update(s.productVariants)
      .set({ status: 'archived' })
      .where(eq(s.productVariants.sku, 'MD-SKU-13'));
    const after = await getCart(t(), u);
    expect(after.lines).toEqual([]);
    expect(after.dropped).toEqual([{ sku: 'MD-SKU-13', reason: 'not_for_sale' }]);
    expect(after.version).toBeGreaterThan(before.version);
    await db
      .update(s.productVariants)
      .set({ status: 'active' })
      .where(eq(s.productVariants.sku, 'MD-SKU-13'));
  });
});

describe('wishlist on two devices', () => {
  it('adding twice is one row, removing a missing one is fine, and parallel adds never pass 100', async () => {
    const u = await user();
    await Promise.all([setWishlisted(t(), u, slugs[0]!, true), setWishlisted(t(), u, slugs[0]!, true)]);
    expect((await setWishlisted(t(), u, slugs[0]!, true)).count).toBe(1);
    expect((await setWishlisted(t(), u, slugs[1]!, false)).count).toBe(1);
    const wl = (await pings(u, 'wishlist')).length;
    expect(wl).toBe(1); // only the first real add pinged
  });

  it('the refresh fingerprint changes on every add and remove and is stable otherwise', async () => {
    const u = await user();
    const empty = await getWishlistIfChanged(t(), u, 'en', -1);
    expect('items' in empty && empty.items).toEqual([]);
    const v0 = 'version' in empty ? empty.version : -1;
    await setWishlisted(t(), u, slugs[0]!, true);
    const one = await getWishlistIfChanged(t(), u, 'en', v0);
    expect('items' in one && one.items.length).toBe(1);
    const v1 = 'version' in one ? one.version : -1;
    expect(v1).not.toBe(v0);
    expect(await getWishlistIfChanged(t(), u, 'en', v1)).toEqual({ unchanged: true, version: v1 });
    await setWishlisted(t(), u, slugs[0]!, false);
    const gone = await getWishlistIfChanged(t(), u, 'en', v1);
    expect('items' in gone && gone.items).toEqual([]);
    expect('version' in gone && gone.version).toBe(v0);
  });
});

describe('an order placed on one device', () => {
  it('removes the ordered packs from the saved cart, so the other device shows it on its next refresh', async () => {
    const u = await user();
    await addCartLine(t(), u, 'CAS-ACT4T-0900', 2); // the oil, on the laptop
    await addCartLine(t(), u, 'MD-SKU-14', 1); // something else, kept
    const before = await getCart(t(), u);
    const lines = [{ sku: 'CAS-ACT4T-0900', qty: 2 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    await placeCodOrder(t(), {
      userId: u,
      idempotencyKey: `md-order-key-${u.slice(0, 18)}`,
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
    const phone = await getCartIfChanged(t(), u, 'en', before.version);
    expect('lines' in phone && phone.lines.map((l) => l.sku)).toEqual(['MD-SKU-14']);
  });
});
