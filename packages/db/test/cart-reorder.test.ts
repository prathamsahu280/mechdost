/**
 * "Order again" (audience entry design 2026-11-22, item 4; spec 03/04): the SKUs and quantities of one of the
 * customer's own past orders go into the cart. Re-priced live (the cart holds no price), merged with the lines already
 * there (larger quantity wins, so a second press changes nothing), limits hold, packs no longer sold are reported with
 * their name, and another customer's order is a 404.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { CART_MAX_LINES } from '@mechdost/shared/cart-api';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { getCart, placeCodOrder, quoteCheckout, reorderCart, replaceCart, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { events } from '../src/repo/events';
import { rowsOf } from '../src/repo/sql-rows';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let n = 0;
let skus: string[] = [];

const user = async () => {
  n += 1;
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `fb-reorder-${String(n)}`, phone: `+9198444000${String(n).padStart(2, '0')}` })
    .returning();
  return u!.id;
};

async function placeFor(userId: string, qty: number): Promise<string> {
  const lines = [{ sku: OIL, qty }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  n += 1;
  const placed = await placeCodOrder(t(), {
    userId,
    idempotencyKey: `reorder-${String(n).padStart(8, '0')}`,
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
  return placed.code;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  skus = rowsOf<{ sku: string }>(
    await db.execute(sql`
      select v.sku from product_variants v join products p on p.id = v.product_id
      where v.status = 'active' and p.status = 'live' order by v.sku`),
  ).map((r) => r.sku);
});

afterAll(async () => {
  await client.close();
});

describe('order again', () => {
  it('puts the ordered packs and quantities in the cart, with no price in the answer', async () => {
    const u = await user();
    const code = await placeFor(u, 3);
    const r = await reorderCart(t(), u, code, 'en');
    expect(r.added).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.cart.lines.map((l) => [l.sku, l.qty])).toEqual([[OIL, 3]]);
    expect(JSON.stringify(r)).not.toMatch(/paise|price/i);
  });

  it('is re-priced live: the cart never carries the order price, so a later quote uses the current one', async () => {
    const u = await user();
    const code = await placeFor(u, 1);
    await reorderCart(t(), u, code, 'en');
    const lines = (await getCart(t(), u, 'en')).lines.map((l) => ({ sku: l.sku, qty: l.qty }));
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    expect(q.totalPaise).toBeGreaterThan(0);
  });

  it('merges with the cart: larger quantity wins, so pressing twice changes nothing', async () => {
    const u = await user();
    const code = await placeFor(u, 2);
    await replaceCart(t(), u, [{ sku: OIL, qty: 1 }]);
    const first = await reorderCart(t(), u, code, 'en');
    expect(first.cart.lines.map((l) => [l.sku, l.qty])).toEqual([[OIL, 2]]);
    expect(first.added).toBe(1);
    const second = await reorderCart(t(), u, code, 'en');
    expect(second.added).toBe(0);
    expect(second.already).toBe(1);
    expect(second.cart.version).toBe(first.cart.version);
  });

  it('reports a pack that is no longer sold, by name, and adds nothing for it', async () => {
    const u = await user();
    const code = await placeFor(u, 1);
    await db.update(s.productVariants).set({ status: 'archived' }).where(eq(s.productVariants.sku, OIL));
    try {
      const r = await reorderCart(t(), u, code, 'hi');
      expect(r.added).toBe(0);
      expect(r.cart.lines).toEqual([]);
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]).toMatchObject({ sku: OIL, reason: 'not_for_sale' });
      expect(r.missing[0]!.name.length).toBeGreaterThan(2);
    } finally {
      await db.update(s.productVariants).set({ status: 'active' }).where(eq(s.productVariants.sku, OIL));
    }
  });

  it('keeps to the 20-line limit and says which line did not fit', async () => {
    const u = await user();
    const code = await placeFor(u, 1);
    const others = skus.filter((k) => k !== OIL).slice(0, CART_MAX_LINES);
    expect(others.length).toBe(CART_MAX_LINES);
    await replaceCart(
      t(),
      u,
      others.map((sku) => ({ sku, qty: 1 })),
    );
    const r = await reorderCart(t(), u, code, 'en');
    expect(r.added).toBe(0);
    expect(r.missing.map((m) => [m.sku, m.reason])).toEqual([[OIL, 'too_many_lines']]);
    expect(r.cart.lines).toHaveLength(CART_MAX_LINES);
  });

  it("another customer's order is a 404 and an unknown code is a 404", async () => {
    const owner = await user();
    const stranger = await user();
    const code = await placeFor(owner, 1);
    await expect(reorderCart(t(), stranger, code, 'en')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(reorderCart(t(), owner, 'MD-RPR-2026-AAAAAA', 'en')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    expect((await getCart(t(), stranger, 'en')).lines).toEqual([]);
  });

  it('writes the server event with ids and counts only, and an audit row', async () => {
    const u = await user();
    const code = await placeFor(u, 1);
    await reorderCart(t(), u, code, 'en');
    const ev = await db.select().from(events).where(eq(events.event, 'order_again'));
    const mine = ev.filter((e) => e.userId === u);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.props).toMatchObject({ added: 1, missing: 0 });
    expect(Object.keys(mine[0]!.props as object).sort()).toEqual(['added', 'missing', 'orderId']);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'cart.reorder'));
    expect(audit.filter((a) => a.actorUserId === u)).toHaveLength(1);
  });

  it('is a constant number of round trips: ten lines cost the same as one', async () => {
    const counted: string[] = [];
    const cdb = drizzle(client, {
      schema: s,
      casing: 'snake_case',
      logger: { logQuery: (q) => void counted.push(q) },
    }) as unknown as Tx;
    const a = await user();
    const one = await placeFor(a, 1);
    const b = await user();
    const ten = await placeFor(b, 1);
    // Clone the order's one line into nine more packs, so the order has ten lines.
    const extra = skus.filter((k) => k !== OIL).slice(0, 9);
    await db.execute(sql`
      insert into order_items (id, order_id, variant_id, title, sku, hsn, gst_rate_bp, unit_paise, qty,
        taxable_paise, total_paise)
      select gen_random_uuid(), oi.order_id, v.id, oi.title, v.sku, oi.hsn, 0, 100, 2, 200, 200
      from order_items oi
      join orders o on o.id = oi.order_id join order_groups g on g.id = o.group_id,
        product_variants v
      where g.code = ${ten} and v.sku in (select jsonb_array_elements_text(${JSON.stringify(extra)}::jsonb))`);
    counted.length = 0;
    await reorderCart(cdb, a, one, 'en');
    const forOne = counted.length;
    counted.length = 0;
    const r = await reorderCart(cdb, b, ten, 'en');
    expect(r.cart.lines).toHaveLength(10);
    expect(counted.length).toBe(forOne);
    expect(forOne).toBeLessThanOrEqual(16);
  });

  it('bounds the wait for a cart another request holds (lock_timeout)', async () => {
    const seen: string[] = [];
    const cdb = drizzle(client, {
      schema: s,
      casing: 'snake_case',
      logger: { logQuery: (q) => void seen.push(q) },
    }) as unknown as Tx;
    const u = await user();
    const code = await placeFor(u, 1);
    seen.length = 0;
    await reorderCart(cdb, u, code, 'en');
    expect(seen.some((q) => /lock_timeout/i.test(q))).toBe(true);
  });

  it('answers 409 CART_BUSY when the lock wait runs out (SQLSTATE 55P03)', async () => {
    const u = await user();
    const code = await placeFor(u, 1);
    const failing = {
      transaction: () => Promise.reject(Object.assign(new Error('lock timeout'), { code: '55P03' })),
    } as unknown as Tx;
    await expect(reorderCart(failing, u, code, 'en')).rejects.toMatchObject({
      name: 'ConflictError',
      code: 'CART_BUSY',
      status: 409,
    });
  });
});
