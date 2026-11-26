/**
 * "Your savings" ledger (personalisation phase 4, decision 2026-11-26; spec 14 "Savings ledger"): checkout snapshots the
 * printed MRP per line and the waived delivery fee; delivery writes one append-only `delivered` row; each processed
 * refund writes one proportional reversal; replays, repeated syncs and webhook retries write nothing more; another
 * customer never sees the rows. PGlite is one connection, so the "concurrent" case proves idempotency under
 * interleaving, not real lock contention (that needs TEST_DATABASE_URL on real Postgres).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { savingsBreakdown } from '@mechdost/shared/savings';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  applyRazorpayPayment,
  approveRefund,
  cancelOrderAsStaff,
  claimRefundDispatch,
  createStaffRefund,
  mySavings,
  orderSavingsForCustomer,
  placeOrder,
  quoteCheckout,
  recordAndApplyRazorpayRefundEvent,
  recordDailyPrices,
  recordRazorpayOrder,
  recordRefundSent,
  syncOrderSavings,
  transitionOrder,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const skuOf = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? '';
const BATTERY = skuOf('exide-xltz4a-2w-battery');
const PIN = '492004';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
let ravi = '';
let meera = '';
let alice = '';
let bob = '';
let n = 0;

async function paidOrder(userId = ravi, lines = [{ sku: BATTERY, qty: 2 }]) {
  const q = await quoteCheckout(t(), { pincode: PIN, lines, locale: 'en' });
  n += 1;
  const placed = await placeOrder(t(), {
    method: 'online',
    userId,
    idempotencyKey: `savings-key-${String(n).padStart(6, '0')}`,
    address: {
      contactName: 'Ravi',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: PIN,
    },
    lines,
    expectedTotalPaise: q.onlineTotalPaise,
    note: null,
    locale: 'en',
  });
  const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
  const providerOrderId = `order_sv${String(n).padStart(8, '0')}`;
  await recordRazorpayOrder(t(), { groupId: group!.id, providerOrderId, amountPaise: placed.totalPaise });
  await applyRazorpayPayment(t(), {
    providerOrderId,
    providerPaymentId: `pay_sv${String(n).padStart(8, '0')}`,
    status: 'captured',
    amountPaise: placed.totalPaise,
    currency: 'INR',
    method: 'upi',
  });
  const [sub] = await db.select().from(s.orders).where(eq(s.orders.groupId, group!.id));
  return { quote: q, order: sub!, groupCode: placed.code };
}

async function deliver(orderId: string, deliveredAt = new Date()) {
  const [shop] = await db.select({ id: s.shops.id }).from(s.shops).limit(1);
  const step = async (from: string, to: string, actor: 'system' | 'shop', patch = {}) => {
    const [o] = await db.select({ version: s.orders.version }).from(s.orders).where(eq(s.orders.id, orderId));
    await db.transaction((tx) =>
      transitionOrder(tx as unknown as Tx, {
        orderId,
        from: from as never,
        to: to as never,
        expectedVersion: o!.version,
        actor: { type: actor, userId: null },
        patch,
      }),
    );
  };
  await step('placed', 'awaiting_shop', 'system');
  await step('awaiting_shop', 'confirmed', 'shop', { shopId: shop!.id, confirmedAt: new Date() });
  await step('confirmed', 'packed', 'shop');
  await step('packed', 'shipped', 'shop');
  await step('shipped', 'delivered', 'system', { deliveredAt });
}

let evt = 0;
/** A staff part refund, approved by finance, sent, then confirmed by a Razorpay webhook (replayed `replays` times). */
async function processRefund(orderCode: string, amountPaise: number, replays = 0) {
  n += 1;
  const { refund } = await createStaffRefund(t(), {
    scope: ALL,
    staffUserId: alice,
    orderCode,
    amountPaise,
    source: 'part_refund',
    reasonCode: 'goodwill',
    idempotencyKey: `sv-${String(n).padStart(6, '0')}-refund`,
  });
  await approveRefund(t(), {
    scope: ALL,
    staffUserId: bob,
    refundId: refund.id,
    expectedVersion: refund.version,
  });
  await claimRefundDispatch(t(), refund.id);
  const providerRefundId = `rfnd_sv${String(n).padStart(8, '0')}`;
  await recordRefundSent(t(), refund.id, providerRefundId);
  const [row] = await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id));
  const [pay] = await db.select().from(s.payments).where(eq(s.payments.id, row!.paymentId!));
  const fact = {
    providerRefundId,
    providerPaymentId: pay!.providerPaymentId ?? '',
    refundId: refund.id,
    status: 'processed' as const,
    amountPaise,
    currency: 'INR',
  };
  const eventId = `rzp:evt_sv${String((evt += 1))}`;
  for (let i = 0; i <= replays; i += 1)
    await recordAndApplyRazorpayRefundEvent(t(), { eventId, type: 'refund.processed', payload: {}, fact });
  return refund.id;
}

const entriesOf = (orderId: string) =>
  db
    .select()
    .from(s.customerSavingsEntries)
    .where(eq(s.customerSavingsEntries.orderId, orderId))
    .orderBy(s.customerSavingsEntries.id);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const mk = async (uid: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid }).returning())[0]!.id;
  ravi = await mk('fb-savings-ravi');
  meera = await mk('fb-savings-meera');
  alice = await mk('fb-savings-alice');
  bob = await mk('fb-savings-bob');
});

afterAll(async () => {
  await client.close();
});

describe('checkout snapshots', () => {
  it('copies the printed MRP onto each order line', async () => {
    const { order } = await paidOrder();
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, order.id));
    const [variant] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, BATTERY));
    expect(item!.mrpPaise).toBe(variant!.mrpPaise);
    expect(item!.mrpPaise).toBeGreaterThan(0);
  });

  it('records the delivery fee the free-delivery threshold waived (0 when it was charged)', async () => {
    const charged = await paidOrder();
    expect(charged.order.shippingPaise).toBeGreaterThan(0);
    expect(charged.order.deliveryWaivedPaise).toBe(0);
    await db.update(s.pincodes).set({ freeDeliveryMinPaise: 0 }).where(eq(s.pincodes.pincode, PIN));
    try {
      const free = await paidOrder();
      expect(free.order.shippingPaise).toBe(0);
      expect(free.order.deliveryWaivedPaise).toBe(charged.order.shippingPaise);
    } finally {
      await db.update(s.pincodes).set({ freeDeliveryMinPaise: null }).where(eq(s.pincodes.pincode, PIN));
    }
  });

  it('the quote carries a server-computed estimate (MRP saving + waived delivery; coupon and Coins come later)', async () => {
    const q = await quoteCheckout(t(), { pincode: PIN, lines: [{ sku: BATTERY, qty: 2 }], locale: 'en' });
    const line = q.lines[0]!;
    expect(q.savingsEstimate).toEqual({
      mrpPaise: (line.mrpPaise! - line.unitPaise!) * 2,
      deliveryPaise: 0,
      totalPaise: (line.mrpPaise! - line.unitPaise!) * 2,
      excludedLines: 0,
    });
  });
});

describe('delivered → one ledger row', () => {
  it('writes the components from the order snapshot, with one line row per counted line', async () => {
    const { order } = await paidOrder();
    await deliver(order.id);
    const rows = await entriesOf(order.id);
    expect(rows).toHaveLength(1);
    const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, order.id));
    const expected = savingsBreakdown({
      lines: items.map((i) => ({ itemId: i.id, qty: i.qty, unitPaise: i.unitPaise, mrpPaise: i.mrpPaise })),
      couponPaise: order.couponDiscountPaise,
      coinsPaise: order.coinDiscountPaise,
      deliveryWaivedPaise: order.deliveryWaivedPaise,
    });
    expect(rows[0]).toMatchObject({
      kind: 'delivered',
      userId: ravi,
      refundId: null,
      mrpPaise: expected.mrpPaise,
      couponPaise: expected.couponPaise,
      coinsPaise: expected.coinsPaise,
      deliveryPaise: expected.deliveryPaise,
      totalPaise: expected.totalPaise,
      countedLines: 1,
      excludedLines: 0,
    });
    expect(expected.mrpPaise).toBeGreaterThan(0);
    const lines = await db
      .select()
      .from(s.customerSavingsLines)
      .where(eq(s.customerSavingsLines.entryId, rows[0]!.id));
    expect(lines).toEqual([
      expect.objectContaining({ orderItemId: items[0]!.id, mrpSavingPaise: expected.mrpPaise }),
    ]);
  });

  it('is idempotent: syncing again (or twice at once) writes nothing more', async () => {
    const { order } = await paidOrder();
    await deliver(order.id);
    await syncOrderSavings(t(), order.id);
    await Promise.all([syncOrderSavings(t(), order.id), syncOrderSavings(t(), order.id)]);
    expect(await entriesOf(order.id)).toHaveLength(1);
  });

  it('lines placed without an MRP snapshot are excluded and counted, never filled from today’s MRP', async () => {
    const { order } = await paidOrder();
    await db.update(s.orderItems).set({ mrpPaise: null }).where(eq(s.orderItems.orderId, order.id));
    await deliver(order.id);
    const [row] = await entriesOf(order.id);
    expect(row).toMatchObject({ mrpPaise: 0, countedLines: 0, excludedLines: 1 });
  });

  it('an undelivered or cancelled order writes nothing', async () => {
    const { order } = await paidOrder();
    expect(await syncOrderSavings(t(), order.id)).toEqual({ written: 0 });
    await cancelOrderAsStaff(t(), {
      cityIds: 'all',
      code: order.code,
      reasonCode: 'customer_unreachable',
      expectedVersion: order.version,
      staffUserId: alice,
    });
    expect(await entriesOf(order.id)).toHaveLength(0);
  });

  it('the ledger is append-only (the database refuses an edit or a delete)', async () => {
    const { order } = await paidOrder();
    await deliver(order.id);
    await expect(
      db.execute(sql`update customer_savings_entries set mrp_paise = 1 where order_id = ${order.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from customer_savings_entries where order_id = ${order.id}`),
    ).rejects.toThrow();
  });
});

describe('refunds reverse the savings', () => {
  it('a half refund reverses half (per line and component); a webhook replay writes nothing more', async () => {
    const { order } = await paidOrder();
    await deliver(order.id);
    const [delivered] = await entriesOf(order.id);
    const half = Math.floor(order.totalPaise / 2);
    const refundId = await processRefund(order.code, half, 2);
    const rows = await entriesOf(order.id);
    expect(rows).toHaveLength(2);
    const rev = rows[1]!;
    expect(rev).toMatchObject({ kind: 'refund', refundId, refundPaise: half });
    expect(rev.mrpPaise).toBe(-Math.floor((delivered!.mrpPaise * half) / order.totalPaise));
    expect(rev.totalPaise).toBe(rev.mrpPaise + rev.couponPaise + rev.coinsPaise + rev.deliveryPaise);
    expect(rev.periodAt.getTime()).toBe(delivered!.periodAt.getTime());
    expect(await syncOrderSavings(t(), order.id)).toEqual({ written: 0 });
  });

  it('refunds adding up to the order total reverse exactly everything (never below zero)', async () => {
    const { order } = await paidOrder();
    await deliver(order.id);
    const a = Math.floor(order.totalPaise / 3);
    await processRefund(order.code, a);
    await processRefund(order.code, order.totalPaise - a);
    const rows = await entriesOf(order.id);
    expect(rows).toHaveLength(3);
    const net = rows.reduce((acc, r) => acc + r.totalPaise, 0);
    const netMrp = rows.reduce((acc, r) => acc + r.mrpPaise, 0);
    expect(net).toBe(0);
    expect(netMrp).toBe(0);
  });
});

describe('reads', () => {
  it('this month and this year sum the customer’s rows by delivery time (IST), net of refunds', async () => {
    const before = await mySavings(t(), meera, { period: 'month', now: new Date() });
    expect(before).toMatchObject({ totalPaise: 0, orders: 0, excludedLines: 0 });
    const { order } = await paidOrder(meera);
    await deliver(order.id);
    const [row] = await entriesOf(order.id);
    const month = await mySavings(t(), meera, { period: 'month', now: new Date() });
    expect(month).toMatchObject({
      mrpPaise: row!.mrpPaise,
      couponPaise: row!.couponPaise,
      coinsPaise: row!.coinsPaise,
      deliveryPaise: row!.deliveryPaise,
      totalPaise: row!.totalPaise,
      orders: 1,
      excludedLines: 0,
    });
    const year = await mySavings(t(), meera, { period: 'year', now: new Date() });
    expect(year.totalPaise).toBe(row!.totalPaise);
    // Next year's window does not include it.
    const later = await mySavings(t(), meera, {
      period: 'year',
      now: new Date(Date.now() + 400 * 86_400_000),
    });
    expect(later.totalPaise).toBe(0);
  });

  it('another customer’s order is 404 and their savings never show', async () => {
    const { order } = await paidOrder(meera);
    await deliver(order.id);
    await expect(orderSavingsForCustomer(t(), ravi, order.code)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const mine = await orderSavingsForCustomer(t(), meera, order.code);
    expect(mine.status).toBe('final');
    const raviYear = await mySavings(t(), ravi, { period: 'year', now: new Date() });
    const raviRows = await db
      .select({ total: sql<string>`coalesce(sum(total_paise), 0)` })
      .from(s.customerSavingsEntries)
      .where(eq(s.customerSavingsEntries.userId, ravi));
    expect(raviYear.totalPaise).toBe(Number(raviRows[0]!.total));
  });

  it('an order not yet delivered shows an estimate from its own snapshot', async () => {
    const { order } = await paidOrder();
    const view = await orderSavingsForCustomer(t(), ravi, order.code);
    expect(view.status).toBe('estimate');
    expect(view.mrpPaise).toBeGreaterThan(0);
  });
});

describe('daily price history', () => {
  it('records each live pack once per IST day and city; a second run writes nothing', async () => {
    const first = await recordDailyPrices(t(), '2026-11-26');
    expect(first).toBeGreaterThan(0);
    expect(await recordDailyPrices(t(), '2026-11-26')).toBe(0);
    const [variant] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, BATTERY));
    const [row] = await db
      .select()
      .from(s.variantPriceDaily)
      .where(and(eq(s.variantPriceDaily.variantId, variant!.id), eq(s.variantPriceDaily.day, '2026-11-26')));
    expect(row).toMatchObject({ mrpPaise: variant!.mrpPaise });
    expect(row!.offers).toBeGreaterThan(0);
    expect(row!.minPricePaise).toBeGreaterThan(0);
  });
});
