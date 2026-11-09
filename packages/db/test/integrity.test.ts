/**
 * Data-integrity acceptance tests (docs/specs/14-data-integrity.md) run against the real migrations on PGlite.
 * They prove the database itself refuses double assignment, oversell, stale updates, history rewrites,
 * non-compliant invoice numbers and inconsistent money — regardless of application bugs.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { blindIndex, decryptField, encryptField, loadKeyring } from '../src/crypto';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  setShopStanding,
  deliveryCodeFor,
  issueDeliveryCode,
  overrideDelivery,
  verifyDeliveryCode,
  adjustCoins,
  coinBalance,
  earnCoins,
  redeemCoins,
  restoreCoinsForOrder,
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
        patch: { statusReasonCode: 'changed_mind' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_ORDER' });
    const ok = await transitionOrder(t(), {
      orderId: o.id,
      from: 'placed',
      to: 'cancelled',
      expectedVersion: 1,
      actor: { type: 'customer' },
      patch: { statusReasonCode: 'changed_mind' },
    });
    expect(ok.version).toBe(2);
    await expect(
      transitionOrder(t(), {
        orderId: o.id,
        from: 'placed',
        to: 'cancelled',
        expectedVersion: 2,
        actor: { type: 'customer' },
        patch: { statusReasonCode: 'changed_mind' },
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
        patch: { statusReasonCode: 'changed_mind' },
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
    expect(await releaseExpiredReservations(db as unknown as Tx)).toEqual({ released: 1, failed: [] });
    expect(await releaseExpiredReservations(db as unknown as Tx)).toEqual({ released: 0, failed: [] });
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

describe('encryption at the database boundary (spec 13)', () => {
  const ring = loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: randomBytes(32).toString('base64'),
  });

  it('refuses plain text in encrypted columns, whatever code writes it', async () => {
    await expectPgError(
      db.insert(s.staffSecurity).values({ userId: F.user!, totpSecretEnc: 'JBSWY3DPEHPK3PXP' }),
      '23514',
    );
    await expectPgError(
      db.update(s.shops).set({ panEnc: 'ABCDE1234F' }).where(eq(s.shops.id, F.shopA!)),
      '23514',
    );
  });

  it('stores and reads back an encrypted value; one shop per PAN via the blind index', async () => {
    const pan = 'ABCDE1234F';
    const panEnc = encryptField(pan, ring, 'shops.pan_enc');
    const panIndex = blindIndex(pan, ring, 'pan');
    await db.update(s.shops).set({ panEnc, panIndex }).where(eq(s.shops.id, F.shopA!));
    const [row] = await db.select({ panEnc: s.shops.panEnc }).from(s.shops).where(eq(s.shops.id, F.shopA!));
    expect(row?.panEnc).not.toContain(pan);
    expect(decryptField(row?.panEnc ?? '', ring, 'shops.pan_enc')).toBe(pan);
    await expectPgError(db.update(s.shops).set({ panIndex }).where(eq(s.shops.id, F.shopB!)), '23505');
  });
});

describe('MechDost Coins ledger (spec 20)', () => {
  const later = new Date('2027-11-01T00:00:00Z');

  it('earns and spends coins; spending more than the balance is refused', async () => {
    const order = await newOrder();
    const earned = await earnCoins(t(), {
      userId: F.user!,
      coins: 100,
      reason: 'Demo welcome coins',
      idemKey: 'earn:welcome:user-1',
      expiresAt: later,
    });
    expect(earned.balanceAfter).toBe(100);
    const spent = await redeemCoins(t(), {
      userId: F.user!,
      coins: 60,
      orderGroupId: order.groupId,
      idemKey: `redeem:${order.groupId}`,
    });
    expect(spent.balanceAfter).toBe(40);
    const other = await newOrder();
    await expect(
      redeemCoins(t(), {
        userId: F.user!,
        coins: 41,
        orderGroupId: other.groupId,
        idemKey: `redeem:${other.groupId}`,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await coinBalance(t(), F.user!)).toBe(40);
  });

  it('is idempotent: the same event twice changes the balance once', async () => {
    const before = await coinBalance(t(), F.user!);
    const input = {
      userId: F.user!,
      coins: 5,
      reason: 'Retry test',
      idemKey: 'earn:retry:user-1',
      expiresAt: later,
    };
    await earnCoins(t(), input);
    const again = await earnCoins(t(), input);
    expect(again.balanceAfter).toBe(before + 5);
  });

  it('two checkouts racing for the same coins: only one wins', async () => {
    const balance = await coinBalance(t(), F.user!);
    const a = await newOrder();
    const b = await newOrder();
    const results = await Promise.allSettled([
      redeemCoins(t(), {
        userId: F.user!,
        coins: balance,
        orderGroupId: a.groupId,
        idemKey: `redeem:${a.groupId}`,
      }),
      redeemCoins(t(), {
        userId: F.user!,
        coins: balance,
        orderGroupId: b.groupId,
        idemKey: `redeem:${b.groupId}`,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await coinBalance(t(), F.user!)).toBe(0);
    // The cancelled order gets its coins back exactly once.
    const winner = results[0].status === 'fulfilled' ? a : b;
    await restoreCoinsForOrder(t(), { userId: F.user!, orderGroupId: winner.groupId });
    await restoreCoinsForOrder(t(), { userId: F.user!, orderGroupId: winner.groupId });
    expect(await coinBalance(t(), F.user!)).toBe(balance);
  });

  it('manual adjustments need a reason, cannot overdraw, and are audited', async () => {
    const balance = await coinBalance(t(), F.user!);
    await expect(
      adjustCoins(t(), {
        userId: F.user!,
        delta: 10,
        reason: '',
        idemKey: 'adjust:x:000001',
        staffUserId: F.user!,
      }),
    ).rejects.toMatchObject({ code: 'COINS_REASON' });
    await expect(
      adjustCoins(t(), {
        userId: F.user!,
        delta: -(balance + 1),
        reason: 'Correction',
        idemKey: 'adjust:x:000002',
        staffUserId: F.user!,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    const entry = await adjustCoins(t(), {
      userId: F.user!,
      delta: 25,
      reason: 'Goodwill for a late delivery',
      idemKey: 'adjust:x:000003',
      staffUserId: F.user!,
    });
    expect(entry.balanceAfter).toBe(balance + 25);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'coins.adjusted'))).toBe(1);
    // A retried request (same key) changes nothing and is not audited twice; refused attempts leave no audit.
    const replay = await adjustCoins(t(), {
      userId: F.user!,
      delta: 25,
      reason: 'Goodwill for a late delivery',
      idemKey: 'adjust:x:000003',
      staffUserId: F.user!,
    });
    expect(replay.id).toBe(entry.id);
    expect(await coinBalance(t(), F.user!)).toBe(balance + 25);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'coins.adjusted'))).toBe(1);
  });

  it('keeps the ledger append-only and the balance non-negative in the database itself', async () => {
    const [row] = await db.select().from(s.coinLedger).limit(1);
    await expectPgError(
      db.update(s.coinLedger).set({ delta: 999 }).where(eq(s.coinLedger.id, row!.id)),
      '23001',
    );
    await expectPgError(db.delete(s.coinLedger).where(eq(s.coinLedger.id, row!.id)), '23001');
    await expectPgError(
      db.update(s.coinAccounts).set({ balance: -1 }).where(eq(s.coinAccounts.userId, F.user!)),
      '23514',
    );
  });

  it('an order cannot record a coin discount larger than its discount', async () => {
    const order = await newOrder();
    await expectPgError(
      db
        .update(s.orderGroups)
        .set({ coinsRedeemed: 10, coinDiscountPaise: 1_000, discountPaise: 0 })
        .where(eq(s.orderGroups.id, order.groupId)),
      '23514',
    );
  });
});

describe('proof of delivery (decision 2026-11-01)', () => {
  const ring = loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: randomBytes(32).toString('base64'),
  });
  const newShipment = async () => {
    const order = await newOrder();
    const [row] = await db
      .insert(s.shipments)
      .values({ orderId: order.id, mode: 'own', status: 'out_for_delivery' })
      .returning();
    return row!.id;
  };
  const wrongFor = (code: string) => (code === '0000' ? '1111' : '0000');

  it('only the customer code marks a shipment delivered; wrong codes count down', async () => {
    const id = await newShipment();
    const code = await issueDeliveryCode(t(), ring, id);
    expect(code).toMatch(/^\d{4}$/);
    const [stored] = await db.select().from(s.shipments).where(eq(s.shipments.id, id));
    expect(stored?.deliveryCodeEnc).not.toContain(code);
    expect(await deliveryCodeFor(t(), ring, id)).toBe(code);

    expect(await verifyDeliveryCode(t(), ring, id, wrongFor(code))).toEqual({
      ok: false,
      reason: 'wrong',
      attemptsLeft: 4,
    });
    expect(await verifyDeliveryCode(t(), ring, id, code)).toEqual({ ok: true });
    const [done] = await db.select().from(s.shipments).where(eq(s.shipments.id, id));
    expect(done).toMatchObject({ status: 'delivered', deliveredVia: 'code' });
    expect(await deliveryCodeFor(t(), ring, id)).toBeNull();
  });

  it('locks after 5 wrong codes, even for the right one', async () => {
    const id = await newShipment();
    const code = await issueDeliveryCode(t(), ring, id);
    for (let i = 0; i < 4; i++) await verifyDeliveryCode(t(), ring, id, wrongFor(code));
    expect(await verifyDeliveryCode(t(), ring, id, wrongFor(code))).toEqual({ ok: false, reason: 'locked' });
    expect(await verifyDeliveryCode(t(), ring, id, code)).toEqual({ ok: false, reason: 'locked' });
  });

  it('parallel guessing cannot get more than 5 comparisons (attempt reserved before comparing)', async () => {
    const id = await newShipment();
    const code = await issueDeliveryCode(t(), ring, id);
    const wrong = wrongFor(code);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => verifyDeliveryCode(t(), ring, id, wrong)),
    );
    expect(results.filter((r) => !r.ok && r.reason === 'wrong')).toHaveLength(4);
    const [row] = await db.select().from(s.shipments).where(eq(s.shipments.id, id));
    expect(row?.deliveryCodeAttempts).toBe(5);
    expect(await verifyDeliveryCode(t(), ring, id, code)).toEqual({ ok: false, reason: 'locked' });
  });

  it('the database refuses "delivered" without proof and a plain-text code', async () => {
    const id = await newShipment();
    await expectPgError(
      db.update(s.shipments).set({ status: 'delivered' }).where(eq(s.shipments.id, id)),
      '23514',
    );
    await expectPgError(
      db.update(s.shipments).set({ deliveryCodeEnc: '4821' }).where(eq(s.shipments.id, id)),
      '23514',
    );
  });

  it('staff can confirm without the code only with a reason, audited once', async () => {
    const id = await newShipment();
    await issueDeliveryCode(t(), ring, id);
    await expect(
      overrideDelivery(t(), { shipmentId: id, staffUserId: F.user!, reason: 'no' }),
    ).rejects.toMatchObject({
      code: 'OVERRIDE_REASON',
    });
    await overrideDelivery(t(), {
      shipmentId: id,
      staffUserId: F.user!,
      reason: 'Customer phone switched off; received in person',
    });
    const [row] = await db.select().from(s.shipments).where(eq(s.shipments.id, id));
    expect(row).toMatchObject({ status: 'delivered', deliveredVia: 'override' });
    await expect(
      overrideDelivery(t(), { shipmentId: id, staffUserId: F.user!, reason: 'Second try at override' }),
    ).rejects.toMatchObject({ code: 'ALREADY_DELIVERED' });
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'delivery.override'))).toBe(1);
  });
});

describe('partner standing: pause, suspend, reactivate (decision 2026-11-01)', () => {
  const versionOf = async (id: string) =>
    (await db.select({ v: s.shops.version }).from(s.shops).where(eq(s.shops.id, id)))[0]!.v;

  it('pauses with a partner-visible reason, history and audit in one step', async () => {
    const shopId = F.shopB!;
    await setShopStanding(t(), {
      shopId,
      to: 'paused',
      reason: 'Too many late deliveries this week',
      staffUserId: F.user!,
      expectedVersion: await versionOf(shopId),
    });
    const [shop] = await db.select().from(s.shops).where(eq(s.shops.id, shopId));
    expect(shop).toMatchObject({ status: 'paused', statusReason: 'Too many late deliveries this week' });
    const events = await db
      .select()
      .from(s.partnerStatusEvents)
      .where(eq(s.partnerStatusEvents.partnerId, shopId));
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([['approved', 'paused']]);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'partner.status_changed'))).toBe(1);
  });

  it('refuses a missing reason, an impossible move and a stale version', async () => {
    const shopId = F.shopB!;
    await expect(
      setShopStanding(t(), {
        shopId,
        to: 'suspended',
        reason: 'no',
        staffUserId: F.user!,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'STATUS_REASON' });
    await expect(
      setShopStanding(t(), {
        shopId,
        to: 'paused',
        reason: 'Already paused, pausing again',
        staffUserId: F.user!,
        expectedVersion: await versionOf(shopId),
      }),
    ).rejects.toMatchObject({ code: 'STATUS_TRANSITION' });
    await expect(
      setShopStanding(t(), {
        shopId,
        to: 'suspended',
        reason: 'Counterfeit parts reported',
        staffUserId: F.user!,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('a delivery override without a reason is refused (NULL must not slip through the CHECK)', async () => {
    const order = await newOrder();
    const [ship] = await db
      .insert(s.shipments)
      .values({ orderId: order.id, mode: 'own', status: 'out_for_delivery' })
      .returning();
    await expectPgError(
      db
        .update(s.shipments)
        .set({
          status: 'delivered',
          deliveredVia: 'override',
          deliveredAt: new Date(),
          overrideBy: F.user!,
          overrideReason: null,
        })
        .where(eq(s.shipments.id, ship!.id)),
      '23514',
    );
  });

  it('the database refuses a pause or suspension without a reason, and keeps history append-only', async () => {
    await expectPgError(
      db.update(s.shops).set({ status: 'suspended', statusReason: null }).where(eq(s.shops.id, F.shopB!)),
      '23514',
    );
    const [e] = await db.select().from(s.partnerStatusEvents).limit(1);
    await expectPgError(
      db
        .update(s.partnerStatusEvents)
        .set({ reason: 'rewritten history' })
        .where(eq(s.partnerStatusEvents.id, e!.id)),
      '23001',
    );
  });

  it('reactivates, so the shop can be routed again', async () => {
    const shopId = F.shopB!;
    await setShopStanding(t(), {
      shopId,
      to: 'approved',
      reason: 'Delivery times back to normal',
      staffUserId: F.user!,
      expectedVersion: await versionOf(shopId),
    });
    const [shop] = await db.select({ status: s.shops.status }).from(s.shops).where(eq(s.shops.id, shopId));
    expect(shop?.status).toBe('approved');
  });
});
