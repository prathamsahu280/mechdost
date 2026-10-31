/**
 * Data-integrity acceptance tests (docs/specs/14-data-integrity.md) run against the real migrations on PGlite.
 * They prove the database itself refuses double assignment, oversell, stale updates, history rewrites,
 * non-compliant invoice numbers and inconsistent money — regardless of application bugs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  acceptAssignment,
  allocateInvoiceNumber,
  commitReservation,
  declineAssignment,
  expireAssignment,
  offerOrderToShop,
  pgCode,
  releaseExpiredReservations,
  reserveStock,
  transitionOrder,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;

async function expectPgError(p: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected SQLSTATE ${code}`).toBeDefined();
  expect(pgCode(caught)).toBe(code);
}

const F: Record<string, string> = {};
let orderSeq = 0;

async function newOrder() {
  orderSeq += 1;
  const code = `MD-RPR-2026-${String(orderSeq).padStart(6, '0').replace(/0/g, 'A')}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId: F.user!,
      cityId: F.city!,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 118000,
      totalPaise: 118000,
      idempotencyKey: `idem-key-${orderSeq}-xxxxxxxxxx`,
    })
    .returning();
  const [o] = await db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId: F.user!,
      cityId: F.city!,
      shippingAddress: { line1: 'Pachpedi Naka', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 118000,
      totalPaise: 118000,
    })
    .returning();
  return o!;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await db
    .insert(s.cities)
    .values({
      stateId: state!.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      status: 'live',
      centroid: { lng: 81.64, lat: 21.227 },
    })
    .returning();
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: city!.id,
    centroid: { lng: 81.64, lat: 21.227 },
  });
  const [user] = await db
    .insert(s.users)
    .values({ firebaseUid: 'fb-customer-1', name: 'Asha', phone: '+919876543210', email: 'Asha@Example.com' })
    .returning();
  const mkShop = async (name: string, lng: number, lat: number) =>
    (
      await db
        .insert(s.shops)
        .values({
          name,
          phone: '+919000000001',
          addressLine: 'Raipur',
          pincode: '492001',
          cityId: city!.id,
          stateId: state!.id,
          status: 'approved',
          location: { lng, lat },
        })
        .returning()
    )[0]!;
  const shopA = await mkShop('Shop A', 81.63, 21.22);
  const shopB = await mkShop('Shop B', 81.9, 21.5);
  const [brand] = await db
    .insert(s.brands)
    .values({ slug: 'castrol', name: 'Castrol', origin: 'oes' })
    .returning();
  const [cat] = await db.insert(s.categories).values({ slug: 'lubricants', name: 'Lubricants' }).returning();
  const [product] = await db
    .insert(s.products)
    .values({
      slug: 'activ-4t',
      name: 'ACTIV 4T 20W40 900ML',
      brandId: brand!.id,
      categoryId: cat!.id,
      hsn: '27101980',
      gstRateBp: 1800,
      status: 'live',
    })
    .returning();
  const [variant] = await db
    .insert(s.productVariants)
    .values({ productId: product!.id, sku: 'CAS-ACT-900', mrpPaise: 44000 })
    .returning();
  const [inv] = await db
    .insert(s.shopInventory)
    .values({ shopId: shopA.id, variantId: variant!.id, sellingPaise: 42000, onHand: 5 })
    .returning();
  Object.assign(F, {
    state: state!.id,
    city: city!.id,
    user: user!.id,
    shopA: shopA.id,
    shopB: shopB.id,
    inv: inv!.id,
    variant: variant!.id,
  });
}, 120_000);

afterAll(async () => {
  await client.close();
});

describe('migrations', () => {
  it('apply cleanly with RLS enabled on every public table', async () => {
    const res = await client.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public'",
    );
    expect(res.rows.length).toBeGreaterThan(40);
    const withoutRls = res.rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
    expect(withoutRls).toEqual([]);
  });
});

describe('orders: compare-and-set transitions', () => {
  it('rejects a stale version and bumps version on every write', async () => {
    const o = await newOrder();
    expect(o.version).toBe(1);
    await expect(
      transitionOrder(t(), {
        orderId: o.id,
        from: 'placed',
        to: 'cancelled',
        expectedVersion: 99,
        actor: { type: 'customer' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_ORDER' });
    const ok = await transitionOrder(t(), {
      orderId: o.id,
      from: 'placed',
      to: 'cancelled',
      expectedVersion: 1,
      actor: { type: 'customer' },
    });
    expect(ok.version).toBe(2);
    await expect(
      transitionOrder(t(), {
        orderId: o.id,
        from: 'placed',
        to: 'cancelled',
        expectedVersion: 2,
        actor: { type: 'customer' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_ORDER' });
  });

  it('refuses illegal moves and wrong actors before touching the database', async () => {
    const o = await newOrder();
    await expect(
      transitionOrder(t(), {
        orderId: o.id,
        from: 'placed',
        to: 'delivered',
        expectedVersion: 1,
        actor: { type: 'admin' },
      }),
    ).rejects.toThrow(/illegal transition/);
    await expect(
      transitionOrder(t(), {
        orderId: o.id,
        from: 'placed',
        to: 'awaiting_shop',
        expectedVersion: 1,
        actor: { type: 'shop' },
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it('writes an order_events row per status change, with the acting user', async () => {
    const o = await newOrder();
    await db.transaction(async (tx) =>
      transitionOrder(tx as unknown as Tx, {
        orderId: o.id,
        from: 'placed',
        to: 'cancelled',
        expectedVersion: 1,
        actor: { type: 'customer', userId: F.user! },
      }),
    );
    const events = await db
      .select()
      .from(s.orderEvents)
      .where(eq(s.orderEvents.orderId, o.id))
      .orderBy(s.orderEvents.id);
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, 'placed'],
      ['placed', 'cancelled'],
    ]);
    expect(events[1]!.actorType).toBe('customer');
    expect(events[1]!.actorId).toBe(F.user);
  });

  it('keeps order_events append-only', async () => {
    const [e] = await db.select().from(s.orderEvents).limit(1);
    await expectPgError(
      db.update(s.orderEvents).set({ toStatus: 'delivered' }).where(eq(s.orderEvents.id, e!.id)),
      '23001',
    );
    await expectPgError(db.delete(s.orderEvents).where(eq(s.orderEvents.id, e!.id)), '23001');
  });
});

describe('routing: one shop at a time', () => {
  it('never lets an order be offered to two shops at once (partial unique index)', async () => {
    const o = await newOrder();
    await db.transaction((tx) =>
      offerOrderToShop(tx as unknown as Tx, {
        orderId: o.id,
        shopId: F.shopA!,
        expectedOrderVersion: 1,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      }),
    );
    // Bypass the repository: even a buggy direct insert is refused by the database.
    await expectPgError(
      db
        .insert(s.orderAssignments)
        .values({ orderId: o.id, shopId: F.shopB!, expiresAt: new Date(Date.now() + 60_000) }),
      '23505',
    );
  });

  it('accept wins once; a second accept or a late decline conflicts', async () => {
    const o = await newOrder();
    const a = await db.transaction((tx) =>
      offerOrderToShop(tx as unknown as Tx, {
        orderId: o.id,
        shopId: F.shopA!,
        expectedOrderVersion: 1,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      }),
    );
    const accepted = await db.transaction((tx) =>
      acceptAssignment(tx as unknown as Tx, {
        assignmentId: a.id,
        shopId: F.shopA!,
        actor: { type: 'shop' },
      }),
    );
    expect(accepted.status).toBe('confirmed');
    expect(accepted.shopId).toBe(F.shopA);
    await expect(
      db.transaction((tx) =>
        acceptAssignment(tx as unknown as Tx, {
          assignmentId: a.id,
          shopId: F.shopA!,
          actor: { type: 'shop' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_UNAVAILABLE' });
    await expect(
      db.transaction((tx) =>
        declineAssignment(tx as unknown as Tx, {
          assignmentId: a.id,
          shopId: F.shopA!,
          reason: 'out of stock',
          actor: { type: 'shop' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_UNAVAILABLE' });
  });

  it('another shop cannot accept an offer made to a different shop', async () => {
    const o = await newOrder();
    const a = await db.transaction((tx) =>
      offerOrderToShop(tx as unknown as Tx, {
        orderId: o.id,
        shopId: F.shopA!,
        expectedOrderVersion: 1,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      }),
    );
    await expect(
      db.transaction((tx) =>
        acceptAssignment(tx as unknown as Tx, {
          assignmentId: a.id,
          shopId: F.shopB!,
          actor: { type: 'shop' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_UNAVAILABLE' });
  });

  it('decline sends the order back to admin, who can reroute to another shop', async () => {
    const o = await newOrder();
    const a = await db.transaction((tx) =>
      offerOrderToShop(tx as unknown as Tx, {
        orderId: o.id,
        shopId: F.shopA!,
        expectedOrderVersion: 1,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      }),
    );
    const declined = await db.transaction((tx) =>
      declineAssignment(tx as unknown as Tx, {
        assignmentId: a.id,
        shopId: F.shopA!,
        reason: 'Out of stock',
        actor: { type: 'shop' },
      }),
    );
    expect(declined.status).toBe('needs_rerouting');
    const b = await db.transaction((tx) =>
      offerOrderToShop(tx as unknown as Tx, {
        orderId: o.id,
        shopId: F.shopB!,
        expectedOrderVersion: declined.version,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      }),
    );
    expect(b.shopId).toBe(F.shopB);
  });

  it('expiry and a late accept cannot both win (DB clock decides)', async () => {
    const o = await newOrder();
    const a = await db.transaction((tx) =>
      offerOrderToShop(tx as unknown as Tx, {
        orderId: o.id,
        shopId: F.shopA!,
        expectedOrderVersion: 1,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      }),
    );
    // Not expired yet: the timer job is a no-op (safe to run early or twice).
    expect(
      await db.transaction((tx) => expireAssignment(tx as unknown as Tx, { assignmentId: a.id })),
    ).toBeNull();
    // Move the deadline into the past.
    await db.execute(
      sql`update order_assignments set offered_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = ${a.id}`,
    );
    await expect(
      db.transaction((tx) =>
        acceptAssignment(tx as unknown as Tx, {
          assignmentId: a.id,
          shopId: F.shopA!,
          actor: { type: 'shop' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_UNAVAILABLE' });
    const expired = await db.transaction((tx) =>
      expireAssignment(tx as unknown as Tx, { assignmentId: a.id }),
    );
    expect(expired!.status).toBe('needs_rerouting');
    expect(
      await db.transaction((tx) => expireAssignment(tx as unknown as Tx, { assignmentId: a.id })),
    ).toBeNull();
  });
});

describe('stock: no oversell', () => {
  it('reserves only what is available and the CHECK blocks negative stock', async () => {
    const o = await newOrder();
    const r1 = await db.transaction((tx) =>
      reserveStock(tx as unknown as Tx, { inventoryId: F.inv!, orderId: o.id, qty: 3 }),
    );
    expect(r1).not.toBeNull();
    const r2 = await db.transaction((tx) =>
      reserveStock(tx as unknown as Tx, { inventoryId: F.inv!, orderId: o.id, qty: 3 }),
    );
    expect(r2).toBeNull(); // only 2 left
    await expectPgError(
      db.update(s.shopInventory).set({ reserved: 99 }).where(eq(s.shopInventory.id, F.inv!)),
      '23514',
    );
    expect(await db.transaction((tx) => commitReservation(tx as unknown as Tx, r1!.id))).toBe(true);
    expect(await db.transaction((tx) => commitReservation(tx as unknown as Tx, r1!.id))).toBe(false); // idempotent
    const [inv] = await db.select().from(s.shopInventory).where(eq(s.shopInventory.id, F.inv!));
    expect([inv!.onHand, inv!.reserved]).toEqual([2, 0]);
  });

  it('expired reservations are released exactly once', async () => {
    const o = await newOrder();
    const r = await db.transaction((tx) =>
      reserveStock(tx as unknown as Tx, { inventoryId: F.inv!, orderId: o.id, qty: 1 }),
    );
    await db.execute(
      sql`update reservations set created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' where id = ${r!.id}`,
    );
    expect(await db.transaction((tx) => releaseExpiredReservations(tx as unknown as Tx))).toBe(1);
    expect(await db.transaction((tx) => releaseExpiredReservations(tx as unknown as Tx))).toBe(0);
    const [inv] = await db.select().from(s.shopInventory).where(eq(s.shopInventory.id, F.inv!));
    expect(inv!.reserved).toBe(0);
  });
});

describe('GST invoice numbers', () => {
  it('are gapless: a rolled-back allocation releases its number', async () => {
    const at = new Date('2026-10-31T10:00:00Z');
    const first = await db.transaction((tx) => allocateInvoiceNumber(tx as unknown as Tx, 'MDR', at));
    await expect(
      db.transaction(async (tx) => {
        await allocateInvoiceNumber(tx, 'MDR', at);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const second = await db.transaction((tx) => allocateInvoiceNumber(tx as unknown as Tx, 'MDR', at));
    expect(first.number).toBe('MDR/2627/000001');
    expect(second.number).toBe('MDR/2627/000002');
  });

  it('the database rejects invoice numbers that break Rule 46', async () => {
    await expectPgError(
      db.insert(s.invoices).values({
        kind: 'tax_invoice',
        series: 'X',
        fy: '2627',
        seq: 1,
        number: 'MDR/2627/0000000001',
        taxablePaise: 1,
        totalPaise: 1,
      }),
      '23514',
    );
  });
});

describe('money and identity constraints', () => {
  it('order lines must have CGST = SGST and consistent totals', async () => {
    const o = await newOrder();
    const base = {
      orderId: o.id,
      variantId: F.variant!,
      title: 'x',
      sku: 'x',
      hsn: '27101980',
      gstRateBp: 1800,
      unitPaise: 118000,
      qty: 1,
      taxablePaise: 100000,
    };
    await expectPgError(
      db.insert(s.orderItems).values({ ...base, cgstPaise: 9000, sgstPaise: 8999, totalPaise: 117999 }),
      '23514',
    );
    await expectPgError(
      db.insert(s.orderItems).values({ ...base, cgstPaise: 9000, sgstPaise: 9000, totalPaise: 120000 }),
      '23514',
    );
    await db.insert(s.orderItems).values({ ...base, cgstPaise: 9000, sgstPaise: 9000, totalPaise: 118000 });
  });

  it('order group totals must add up', async () => {
    await expectPgError(
      db.insert(s.orderGroups).values({
        code: 'MD-RPR-2026-ZZZZZZ',
        userId: F.user!,
        cityId: F.city!,
        paymentMethod: 'online',
        subtotalPaise: 1000,
        discountPaise: 0,
        shippingPaise: 0,
        totalPaise: 999,
        idempotencyKey: 'idem-total-check-xxxx',
      }),
      '23514',
    );
  });

  it('a soft-deleted account releases its phone number; a live duplicate is refused; email is case-insensitive', async () => {
    await expectPgError(db.insert(s.users).values({ firebaseUid: 'dup', phone: '+919876543210' }), '23505');
    await expectPgError(
      db.insert(s.users).values({ firebaseUid: 'dup2', email: 'asha@example.COM' }),
      '23505',
    );
    await db.update(s.users).set({ deletedAt: new Date(), status: 'deleted' }).where(eq(s.users.id, F.user!));
    await db.insert(s.users).values({ firebaseUid: 'fb-new-owner', phone: '+919876543210' });
  });

  it('webhook events and outbox rows are deduplicated by key', async () => {
    await db
      .insert(s.webhookEvents)
      .values({ id: 'evt_1', provider: 'razorpay', type: 'payment.captured', payload: {} });
    const again = await db
      .insert(s.webhookEvents)
      .values({ id: 'evt_1', provider: 'razorpay', type: 'payment.captured', payload: {} })
      .onConflictDoNothing()
      .returning();
    expect(again).toHaveLength(0);
    await db
      .insert(s.notificationOutbox)
      .values({ dedupeKey: 'order_confirmed:abc:inapp', channel: 'inapp', templateKey: 'order_confirmed' });
    await expectPgError(
      db
        .insert(s.notificationOutbox)
        .values({ dedupeKey: 'order_confirmed:abc:inapp', channel: 'inapp', templateKey: 'order_confirmed' }),
      '23505',
    );
  });
});

describe('geo', () => {
  it('finds shops within a radius using PostGIS (metres)', async () => {
    const res = await db.execute(
      sql`select name from shops where ST_DWithin(location, ST_SetSRID(ST_MakePoint(81.64, 21.227), 4326)::geography, 5000) order by name`,
    );
    const rows = (Array.isArray(res) ? res : (res as unknown as { rows: { name: string }[] }).rows) as {
      name: string;
    }[];
    expect(rows.map((r) => r.name)).toEqual(['Shop A']);
  });
});
