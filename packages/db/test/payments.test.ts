/**
 * Razorpay payment facts (plan 2026-11-12; razorpay-payments skill; research/data-integrity.md §4): a capture for
 * the exact amount marks the group paid; a different amount never does; the state only moves forward (a late
 * failure after paid is a no-op); replays change nothing; only the owner sees their payment; unpaid online orders
 * never reach the routing queue and give their stock back when the payment window ends.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  applyRazorpayPayment,
  cancelMyOrder,
  recordAndApplyRazorpayEvent,
  expireUnpaidOnlineOrders,
  listRoutingQueue,
  onlineGroupOfUser,
  openPaymentForGroup,
  paymentOfUserGroup,
  placeOrder,
  quoteCheckout,
  recordRazorpayOrder,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const skuOf = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? '';
const BATTERY = skuOf('exide-xltz4a-2w-battery');
// Two shops serve this cart (checkout.test.ts "splits a cart per nearest shop"): two sub-orders, one group.
const TWO_SHOP_CART = [
  { sku: skuOf('castrol-activ-4t-20w40-900ml'), qty: 1 },
  { sku: skuOf('scooter-tubeless-tyre-90-90-12'), qty: 1 },
];

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let userId = '';
let otherUser = '';
let n = 0;

async function placeOnline(lines: { sku: string; qty: number }[] = [{ sku: BATTERY, qty: 1 }]) {
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  n += 1;
  const placed = await placeOrder(t(), {
    method: 'online',
    userId,
    idempotencyKey: `payments-key-${String(n).padStart(6, '0')}`,
    address: {
      contactName: 'Ravi',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.onlineTotalPaise,
    note: null,
    locale: 'en',
  });
  const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
  const providerOrderId = `order_test${String(n).padStart(6, '0')}`;
  await recordRazorpayOrder(t(), { groupId: group!.id, providerOrderId, amountPaise: placed.totalPaise });
  return { placed, groupId: group!.id, providerOrderId };
}

const captured = (providerOrderId: string, amountPaise: number, paymentId = `pay_${providerOrderId}`) => ({
  providerOrderId,
  providerPaymentId: paymentId,
  status: 'captured' as const,
  amountPaise,
  currency: 'INR',
  method: 'upi',
});

const groupStatus = async (groupId: string) =>
  (await db.select().from(s.orderGroups).where(eq(s.orderGroups.id, groupId)))[0]!.paymentStatus;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  // These tests cancel as the customer, which is off by default (Q25: cancel through support only).
  await db.insert(s.settings).values({ key: 'orders.customer_self_cancel_online', value: true });
  userId = (await db.insert(s.users).values({ firebaseUid: 'fb-payments-ravi' }).returning())[0]!.id;
  otherUser = (await db.insert(s.users).values({ firebaseUid: 'fb-payments-other' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('Razorpay payment facts', () => {
  it('a capture for the exact amount marks the order paid; replays change nothing', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    expect((await openPaymentForGroup(t(), groupId))?.providerOrderId).toBe(providerOrderId);
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'paid',
    });
    expect(await groupStatus(groupId)).toBe('paid');
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'unchanged',
    });
    const [payment] = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.providerOrderId, providerOrderId));
    expect(payment).toMatchObject({
      status: 'paid',
      method: 'upi',
      providerPaymentId: `pay_${providerOrderId}`,
    });
    expect(payment!.capturedAt).not.toBeNull();
    expect(await openPaymentForGroup(t(), groupId)).toBeNull();
  });

  it('a capture for a different amount never marks paid, and is audited', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise - 100))).toEqual({
      outcome: 'mismatch',
    });
    expect(await groupStatus(groupId)).toBe('created');
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(
        sql`${s.auditLog.action} = 'payment.amount_mismatch' and ${s.auditLog.entityId} = ${providerOrderId}`,
      );
    expect(audit).toHaveLength(1);
  });

  it('a failure arriving after the capture leaves the order paid (out-of-order webhooks)', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise));
    expect(
      await applyRazorpayPayment(t(), { ...captured(providerOrderId, placed.totalPaise), status: 'failed' }),
    ).toEqual({ outcome: 'unchanged' });
    expect(await groupStatus(groupId)).toBe('paid');
  });

  it('a failed attempt can still be paid later (UPI retry), and an unknown order is reported', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    expect(
      await applyRazorpayPayment(t(), {
        ...captured(providerOrderId, placed.totalPaise, 'pay_first_try'),
        status: 'failed',
      }),
    ).toEqual({ outcome: 'failed' });
    expect(await groupStatus(groupId)).toBe('failed');
    expect(
      await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise, 'pay_second_try')),
    ).toEqual({ outcome: 'paid' });
    expect(await groupStatus(groupId)).toBe('paid');
    expect(await applyRazorpayPayment(t(), captured('order_unknown000', 100))).toEqual({
      outcome: 'unknown_order',
    });
  });

  it('only the owner can look up the payment of their order', async () => {
    const { providerOrderId } = await placeOnline();
    expect((await paymentOfUserGroup(t(), { userId, providerOrderId })).providerOrderId).toBe(
      providerOrderId,
    );
    await expect(paymentOfUserGroup(t(), { userId: otherUser, providerOrderId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('unpaid online orders', () => {
  it('never reach the routing queue until paid', async () => {
    const unpaid = await placeOnline();
    const paid = await placeOnline();
    await applyRazorpayPayment(t(), captured(paid.providerOrderId, paid.placed.totalPaise));
    const queue = (
      await listRoutingQueue(t(), { all: true }, { view: 'needs_routing', locale: 'en' })
    ).items.map((i) => i.code);
    expect(queue).toContain(paid.placed.orders[0]!.code);
    expect(queue).not.toContain(unpaid.placed.orders[0]!.code);
  });

  it('give their stock back and close when the payment window ends', async () => {
    const { placed, groupId } = await placeOnline();
    await db.execute(
      sql`update order_groups set created_at = now() - interval '45 minutes' where id = ${groupId}`,
    );
    expect(await expireUnpaidOnlineOrders(t())).toEqual({ closed: 1, failed: 0 });
    expect(await groupStatus(groupId)).toBe('expired');
    const [order] = await db.select().from(s.orders).where(eq(s.orders.code, placed.orders[0]!.code));
    expect(order!.status).toBe('cancelled');
    const holds = await db.select().from(s.reservations).where(eq(s.reservations.orderId, order!.id));
    expect(holds.every((h) => h.status !== 'active')).toBe(true);
    expect(await expireUnpaidOnlineOrders(t())).toEqual({ closed: 0, failed: 0 });
  });
});

describe('captures that must not complete an order (security review 2026-11-12)', () => {
  it('a capture after the payment window ended is flagged for a refund, never marks paid', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    await db.execute(
      sql`update order_groups set created_at = now() - interval '45 minutes' where id = ${groupId}`,
    );
    await expireUnpaidOnlineOrders(t());
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'needs_refund',
    });
    expect(await groupStatus(groupId)).toBe('expired');
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(
        sql`${s.auditLog.action} = 'payment.captured_needs_refund' and ${s.auditLog.entityId} = ${providerOrderId}`,
      );
    expect(audit).toHaveLength(1);
  });

  it('cancelling an unpaid online order closes its payment; a later capture is flagged for a refund', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    const [order] = await db.select().from(s.orders).where(eq(s.orders.code, placed.orders[0]!.code));
    await cancelMyOrder(t(), {
      userId,
      code: order!.code,
      reasonCode: 'changed_mind',
      expectedVersion: order!.version,
    });
    expect(await groupStatus(groupId)).toBe('expired');
    expect(await openPaymentForGroup(t(), groupId)).toBeNull();
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'needs_refund',
    });
  });

  it('a webhook event is recorded only together with its payment fact (a failed apply can be retried)', async () => {
    const { placed, providerOrderId } = await placeOnline();
    await expect(
      recordAndApplyRazorpayEvent(t(), {
        eventId: 'rzp:evt_atomic_0001',
        type: 'payment.captured',
        payload: {},
        // A payment id already used by another order: the unique index throws inside the apply.
        fact: captured(providerOrderId, placed.totalPaise, 'pay_order_test000001'),
      }),
    ).rejects.toThrow();
    const seen = await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, 'rzp:evt_atomic_0001'));
    expect(seen).toHaveLength(0);
    expect(
      await recordAndApplyRazorpayEvent(t(), {
        eventId: 'rzp:evt_atomic_0001',
        type: 'payment.captured',
        payload: {},
        fact: captured(providerOrderId, placed.totalPaise),
      }),
    ).toEqual({ fresh: true, outcome: 'paid' });
  });
});

describe('replays of a completed payment (security review 2026-11-12, second pass)', () => {
  it('a replayed capture of a paid order is unchanged, even after the order was later cancelled', async () => {
    const { placed, providerOrderId } = await placeOnline();
    expect((await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).outcome).toBe(
      'paid',
    );
    await db.execute(sql`update orders set status = 'cancelled', status_reason_code = 'other'
      where code = ${placed.orders[0]!.code}`);
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'unchanged',
    });
    const flags = await db
      .select()
      .from(s.auditLog)
      .where(
        sql`${s.auditLog.action} = 'payment.captured_needs_refund' and ${s.auditLog.entityId} = ${providerOrderId}`,
      );
    expect(flags).toHaveLength(0);
  });
});

describe('a second capture on a paid order (security review 2026-11-12, third pass)', () => {
  it('is flagged for a refund once; the first payment stays the paid one', async () => {
    const { placed, providerOrderId } = await placeOnline();
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise, 'pay_FirstPaid01'));
    const second = captured(providerOrderId, placed.totalPaise, 'pay_SecondPay01');
    expect(await applyRazorpayPayment(t(), second)).toEqual({ outcome: 'needs_refund' });
    expect(await applyRazorpayPayment(t(), second)).toEqual({ outcome: 'needs_refund' });
    const flags = await db
      .select()
      .from(s.auditLog)
      .where(
        sql`${s.auditLog.action} = 'payment.captured_needs_refund' and ${s.auditLog.entityId} = ${providerOrderId}`,
      );
    expect(flags).toHaveLength(1);
    const [payment] = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.providerOrderId, providerOrderId));
    expect(payment).toMatchObject({ status: 'paid', providerPaymentId: 'pay_FirstPaid01' });
  });
});

describe('final review 2026-11-12', () => {
  it('a paid order keeps its stock held until it is routed (the online hold is extended on capture)', async () => {
    const { placed, providerOrderId } = await placeOnline();
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise));
    const [order] = await db.select().from(s.orders).where(eq(s.orders.code, placed.orders[0]!.code));
    const holds = await db.select().from(s.reservations).where(eq(s.reservations.orderId, order!.id));
    expect(holds.length).toBeGreaterThan(0);
    // COD holds last `checkout.cod_reservation_minutes` (default 1440); a paid order gets at least that.
    const minutesLeft = (h: (typeof holds)[number]) => (h.expiresAt.getTime() - Date.now()) / 60_000;
    expect(holds.every((h) => h.status === 'active' && minutesLeft(h) > 1400)).toBe(true);
  });

  it('a group has one open Razorpay order: a second one recorded at the same time returns the first', async () => {
    const { groupId, providerOrderId, placed } = await placeOnline();
    const again = await recordRazorpayOrder(t(), {
      groupId,
      providerOrderId: `${providerOrderId}_dup`,
      amountPaise: placed.totalPaise,
    });
    expect(again.providerOrderId).toBe(providerOrderId);
    const rows = await db.select().from(s.payments).where(eq(s.payments.groupId, groupId));
    expect(rows).toHaveLength(1);
  });

  it('a capture on another Razorpay order of an already paid group is flagged for a refund, never a crash', async () => {
    const { groupId, placed, providerOrderId } = await placeOnline();
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise));
    // Recording refuses a paid group, so the late order is inserted directly (a row from before that check).
    await expect(
      recordRazorpayOrder(t(), {
        groupId,
        providerOrderId: `${providerOrderId}_x`,
        amountPaise: placed.totalPaise,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CLOSED' });
    const [late] = await db
      .insert(s.payments)
      .values({ groupId, providerOrderId: `${providerOrderId}_late`, amountPaise: placed.totalPaise })
      .returning();
    expect(await applyRazorpayPayment(t(), captured(late!.providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'needs_refund',
    });
    expect(await groupStatus(groupId)).toBe('paid');
  });

  it('cancelling one part of an unpaid online order closes the payment; the next one asks only for what is left', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline(TWO_SHOP_CART);
    expect(placed.orders).toHaveLength(2);
    const [first, second] = placed.orders;
    const [order] = await db.select().from(s.orders).where(eq(s.orders.code, first!.code));
    await cancelMyOrder(t(), {
      userId,
      code: order!.code,
      reasonCode: 'changed_mind',
      expectedVersion: order!.version,
    });
    expect(await groupStatus(groupId)).toBe('created');
    expect(await openPaymentForGroup(t(), groupId)).toBeNull();
    const group = await onlineGroupOfUser(t(), { userId, groupCode: placed.code });
    expect(group.payablePaise).toBe(second!.totalPaise);
    // The old Razorpay order (full amount) can no longer complete the order.
    expect(await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise))).toEqual({
      outcome: 'needs_refund',
    });
  });

  it('the payment window follows the city setting, not only the global one', async () => {
    const { groupId } = await placeOnline();
    const [g] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.id, groupId));
    await db.execute(
      sql`update order_groups set created_at = now() - interval '15 minutes' where id = ${groupId}`,
    );
    expect((await expireUnpaidOnlineOrders(t())).closed).toBe(0); // global default: 30 minutes
    await db
      .insert(s.settings)
      .values({ key: 'checkout.online_payment_minutes', cityId: g!.cityId, value: 10 });
    try {
      expect((await expireUnpaidOnlineOrders(t())).closed).toBe(1);
      expect(await groupStatus(groupId)).toBe('expired');
    } finally {
      await db.delete(s.settings).where(eq(s.settings.key, 'checkout.online_payment_minutes'));
    }
  });
});

describe('payment emails (spec 10, design 2026-11-15)', () => {
  const emails = () =>
    db
      .select({ template: s.notificationOutbox.templateKey, payload: s.notificationOutbox.payload })
      .from(s.notificationOutbox)
      .where(eq(s.notificationOutbox.channel, 'email'));

  it('a capture sends the receipt and the order confirmation once; a bad amount or a replay sends nothing', async () => {
    await db
      .update(s.users)
      .set({ email: 'ravi.pay@example.com', emailVerifiedAt: new Date() })
      .where(eq(s.users.id, userId));
    await db.execute(sql`delete from notification_outbox`);
    const { placed, providerOrderId } = await placeOnline();
    expect(await emails()).toEqual([]); // placed but unpaid: nothing yet
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise - 100));
    expect(await emails()).toEqual([]);
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise));
    await applyRazorpayPayment(t(), captured(providerOrderId, placed.totalPaise));
    const sent = await emails();
    expect(sent.map((e) => e.template).sort()).toEqual(['order_placed', 'payment_received']);
    const receipt = sent.find((e) => e.template === 'payment_received')!.payload as Record<string, string>;
    expect(receipt).toMatchObject({ orderCode: placed.code, method: 'UPI' });
    expect(receipt.paymentId).toBe(`pay_${providerOrderId}`);
  });
});
