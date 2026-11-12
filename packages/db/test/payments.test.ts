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
const BATTERY = fixture.products.find((p) => p.slug === 'exide-xltz4a-2w-battery')?.sku ?? '';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let userId = '';
let otherUser = '';
let n = 0;

async function placeOnline() {
  const lines = [{ sku: BATTERY, qty: 1 }];
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
    expect(await expireUnpaidOnlineOrders(t(), { olderThanMinutes: 30 })).toBe(1);
    expect(await groupStatus(groupId)).toBe('expired');
    const [order] = await db.select().from(s.orders).where(eq(s.orders.code, placed.orders[0]!.code));
    expect(order!.status).toBe('cancelled');
    const holds = await db.select().from(s.reservations).where(eq(s.reservations.orderId, order!.id));
    expect(holds.every((h) => h.status !== 'active')).toBe(true);
    expect(await expireUnpaidOnlineOrders(t(), { olderThanMinutes: 30 })).toBe(0);
  });
});

describe('captures that must not complete an order (security review 2026-11-12)', () => {
  it('a capture after the payment window ended is flagged for a refund, never marks paid', async () => {
    const { placed, groupId, providerOrderId } = await placeOnline();
    await db.execute(
      sql`update order_groups set created_at = now() - interval '45 minutes' where id = ${groupId}`,
    );
    await expireUnpaidOnlineOrders(t(), { olderThanMinutes: 30 });
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
