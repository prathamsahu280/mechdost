/**
 * Refunds for prepaid orders (spec 05; decision 2026-11-15 "All need approval"; razorpay-payments skill): every refund
 * is a request that waits for a finance approval; the ledger can never exceed what was captured; two approvals at once
 * make one Razorpay call; a webhook replays safely, out of order, and with a wrong amount never moves money state.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  applyRazorpayPayment,
  approveRefund,
  cancelOrderAsStaff,
  claimRefundDispatch,
  claimRefundReconcile,
  createStaffRefund,
  customerRefundsByOrder,
  dueReconciliationIds,
  dueRefundIds,
  getAdminRefund,
  listAdminRefunds,
  placeOrder,
  quoteCheckout,
  recordAndApplyRazorpayRefundEvent,
  recordRazorpayOrder,
  recordRefundDispatchError,
  recordRefundNeedsReconciliation,
  recordRefundSent,
  markRefundPaid,
  rejectRefund,
  resolveRefundAbsent,
  revealRefundDestination,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const skuOf = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? '';
const BATTERY = skuOf('exide-xltz4a-2w-battery');
// Two shops serve this cart (payments.test.ts): two sub-orders in one group.
const TWO_SHOP_CART = [
  { sku: skuOf('castrol-activ-4t-20w40-900ml'), qty: 1 },
  { sku: skuOf('scooter-tubeless-tyre-90-90-12'), qty: 1 },
];

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
let customer = '';
let alice = ''; // staff who requests
let bob = ''; // finance who approves
let n = 0;

async function paidOrder(lines: { sku: string; qty: number }[] = [{ sku: BATTERY, qty: 1 }]) {
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  n += 1;
  const placed = await placeOrder(t(), {
    method: 'online',
    userId: customer,
    idempotencyKey: `refunds-key-${String(n).padStart(6, '0')}`,
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
  const providerOrderId = `order_rf${String(n).padStart(8, '0')}`;
  await recordRazorpayOrder(t(), { groupId: group!.id, providerOrderId, amountPaise: placed.totalPaise });
  const providerPaymentId = `pay_rf${String(n).padStart(8, '0')}`;
  await applyRazorpayPayment(t(), {
    providerOrderId,
    providerPaymentId,
    status: 'captured',
    amountPaise: placed.totalPaise,
    currency: 'INR',
    method: 'upi',
  });
  const [payment] = await db.select().from(s.payments).where(eq(s.payments.providerOrderId, providerOrderId));
  const subs = await db
    .select()
    .from(s.orders)
    .where(eq(s.orders.groupId, group!.id))
    .orderBy(s.orders.subNo);
  return { groupId: group!.id, payment: payment!, providerPaymentId, subs, total: placed.totalPaise };
}

async function cancelAsStaff(order: { code: string; version: number }) {
  await cancelOrderAsStaff(t(), {
    cityIds: 'all',
    code: order.code,
    reasonCode: 'customer_unreachable',
    expectedVersion: order.version,
    staffUserId: alice,
  });
}

const refundsOf = (paymentId: string) =>
  db.select().from(s.refunds).where(eq(s.refunds.paymentId, paymentId)).orderBy(s.refunds.createdAt);
const paymentRow = async (id: string) =>
  (await db.select().from(s.payments).where(eq(s.payments.id, id)))[0]!;

const refundFact = (
  refund: { providerRefundId: string | null; id: string },
  payment: { providerPaymentId: string | null },
  amountPaise: number,
  status: 'processed' | 'failed' = 'processed',
  providerRefundId = refund.providerRefundId ?? `rfnd_${refund.id.slice(0, 12)}`,
) => ({
  providerRefundId,
  providerPaymentId: payment.providerPaymentId ?? '',
  refundId: refund.id,
  status,
  amountPaise,
  currency: 'INR',
});

let evt = 0;
const webhook = (fact: ReturnType<typeof refundFact>, eventId = `rzp:evt_rf${String((evt += 1))}`) =>
  recordAndApplyRazorpayRefundEvent(t(), { eventId, type: `refund.${fact.status}`, payload: {}, fact });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  customer = (
    await db
      .insert(s.users)
      .values({ firebaseUid: 'fb-refunds-ravi', email: 'ravi.refunds@example.com' })
      .returning()
  )[0]!.id;
  alice = (await db.insert(s.users).values({ firebaseUid: 'fb-refunds-alice' }).returning())[0]!.id;
  bob = (await db.insert(s.users).values({ firebaseUid: 'fb-refunds-bob' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('a refund request is created for a paid online order that is closed', () => {
  it('staff cancelling a paid order creates one system request for what the customer paid; nothing is sent', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const rows = await refundsOf(o.payment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'requested',
      source: 'order_cancelled',
      reasonCode: 'order_cancelled',
      amountPaise: o.total,
      requestedBy: null,
      providerRefundId: null,
      orderId: o.subs[0]!.id,
    });
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(o.total);
    const events = await db.select().from(s.refundEvents).where(eq(s.refundEvents.refundId, rows[0]!.id));
    expect(events.map((e) => e.kind)).toEqual(['requested']);
  });

  it('an order cancelled before it was paid (or paid on delivery) needs no refund', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [{ sku: BATTERY, qty: 1 }],
      locale: 'en',
    });
    n += 1;
    const placed = await placeOrder(t(), {
      method: 'online',
      userId: customer,
      idempotencyKey: `refunds-key-${String(n).padStart(6, '0')}`,
      address: {
        contactName: 'Ravi',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines: [{ sku: BATTERY, qty: 1 }],
      expectedTotalPaise: q.onlineTotalPaise,
      note: null,
      locale: 'en',
    });
    const [sub] = await db
      .select()
      .from(s.orders)
      .where(eq(s.orders.code, `${placed.code}-1`));
    await cancelAsStaff(sub!);
    expect(await db.select().from(s.refunds).where(eq(s.refunds.orderId, sub!.id))).toHaveLength(0);
  });

  it('cancelling one part of a two-shop group asks for that part only; the other part stays paid', async () => {
    const o = await paidOrder(TWO_SHOP_CART);
    expect(o.subs).toHaveLength(2);
    await cancelAsStaff(o.subs[1]!);
    const rows = await refundsOf(o.payment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountPaise).toBe(o.subs[1]!.totalPaise);
    expect(rows[0]!.amountPaise).toBeLessThan(o.total);
  });
});

describe('approval (all refunds need it)', () => {
  it('a system request is approved by a staff member; the Razorpay refund is claimed once', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    // Nothing can be sent before approval.
    expect(await claimRefundDispatch(t(), r!.id)).toBeNull();
    const approved = await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: r!.id,
      expectedVersion: r!.version,
    });
    expect(approved).toMatchObject({ status: 'approved', approvedBy: bob });
    const job = await claimRefundDispatch(t(), r!.id);
    expect(job).toMatchObject({
      refundId: r!.id,
      amountPaise: o.total,
      providerPaymentId: o.providerPaymentId,
      idemKey: r!.idemKey,
    });
    // Claimed: nobody else may send it until the backoff passes.
    expect(await claimRefundDispatch(t(), r!.id)).toBeNull();
  });

  it('four-eyes: the staff member who asked cannot approve their own request', async () => {
    const o = await paidOrder();
    const { refund } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: 5_000,
      source: 'part_refund',
      reasonCode: 'goodwill',
      idempotencyKey: `req-${String((n += 1))}-four-eyes`,
    });
    await expect(
      approveRefund(t(), {
        scope: ALL,
        staffUserId: alice,
        refundId: refund.id,
        expectedVersion: refund.version,
      }),
    ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    const [row] = await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id));
    expect(row!.status).toBe('requested');
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: refund.id,
      expectedVersion: refund.version,
    });
  });

  it('the database also refuses an approval by the requester (CHECK)', async () => {
    const o = await paidOrder();
    const { refund } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: 5_000,
      source: 'part_refund',
      reasonCode: 'goodwill',
      idempotencyKey: `req-${String((n += 1))}-db-check`,
    });
    await expect(
      db
        .update(s.refunds)
        .set({ approvedBy: alice, status: 'approved', decidedAt: new Date() })
        .where(eq(s.refunds.id, refund.id)),
    ).rejects.toThrow();
  });

  it('two finance users approving at once: exactly one wins, so exactly one Razorpay refund', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    const carol = (
      await db
        .insert(s.users)
        .values({ firebaseUid: `fb-refunds-carol-${String(n)}` })
        .returning()
    )[0]!.id;
    const results = await Promise.allSettled([
      approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version }),
      approveRefund(t(), { scope: ALL, staffUserId: carol, refundId: r!.id, expectedVersion: r!.version }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((x) => x.status === 'rejected');
    expect(lost).toMatchObject({
      reason: { code: expect.stringMatching(/STALE_REFUND|NOT_PENDING/) as string },
    });
    const claims = await Promise.all([claimRefundDispatch(t(), r!.id), claimRefundDispatch(t(), r!.id)]);
    expect(claims.filter((c) => c !== null)).toHaveLength(1);
    const events = await db.select().from(s.refundEvents).where(eq(s.refundEvents.refundId, r!.id));
    expect(events.filter((e) => e.kind === 'approved')).toHaveLength(1);
  });

  it('a stale version is refused (409) and nothing changes', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await expect(
      approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version + 5 }),
    ).rejects.toMatchObject({ code: 'STALE_REFUND' });
  });

  it('rejecting needs a reason code, frees the amount and tells the customer', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    const done = await rejectRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: r!.id,
      expectedVersion: r!.version,
      reasonCode: 'not_eligible',
      note: 'Already refunded outside the system',
    });
    expect(done).toMatchObject({ status: 'rejected', rejectReasonCode: 'not_eligible' });
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(0);
    await expect(claimRefundDispatch(t(), r!.id)).resolves.toBeNull();
    const mail = await db
      .select()
      .from(s.notificationOutbox)
      .where(sql`${s.notificationOutbox.dedupeKey} like ${`%:${r!.id}:email`}`);
    expect(mail.map((m) => m.templateKey).sort()).toEqual(['refund_declined', 'refund_requested']);
    expect(mail[0]).toMatchObject({ channel: 'email', recipient: 'ravi.refunds@example.com' });
  });
});

describe('the ledger: refunds can never exceed what was captured', () => {
  it('a staff request above the sub-order total, or above what is left, is refused', async () => {
    const o = await paidOrder();
    const sub = o.subs[0]!;
    await expect(
      createStaffRefund(t(), {
        scope: ALL,
        staffUserId: alice,
        orderCode: sub.code,
        amountPaise: o.total + 1,
        source: 'part_refund',
        reasonCode: 'goodwill',
        idempotencyKey: `req-${String((n += 1))}-too-much`,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_ORDER' });
    await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: sub.code,
      amountPaise: o.total - 100,
      source: 'part_refund',
      reasonCode: 'faulty',
      idempotencyKey: `req-${String((n += 1))}-first`,
    });
    await expect(
      createStaffRefund(t(), {
        scope: ALL,
        staffUserId: alice,
        orderCode: sub.code,
        amountPaise: 101,
        source: 'part_refund',
        reasonCode: 'faulty',
        idempotencyKey: `req-${String((n += 1))}-second`,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_ORDER' });
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(o.total - 100);
  });

  it('the database CHECK stops a ledger above the captured amount even if code is wrong', async () => {
    const o = await paidOrder();
    await expect(
      db
        .update(s.payments)
        .set({ refundReservedPaise: o.total + 1 })
        .where(eq(s.payments.id, o.payment.id)),
    ).rejects.toThrow();
  });

  it('a cancelled order after a part refund asks only for the rest', async () => {
    const o = await paidOrder();
    await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: 1_000,
      source: 'part_refund',
      reasonCode: 'missing_item',
      idempotencyKey: `req-${String((n += 1))}-part`,
    });
    await cancelAsStaff(o.subs[0]!);
    const rows = await refundsOf(o.payment.id);
    expect(rows.map((r) => r.amountPaise).sort((a, b) => a - b)).toEqual([1_000, o.total - 1_000]);
  });

  it('the same Idempotency-Key returns the same request; a different body with it is refused', async () => {
    const o = await paidOrder();
    const input = {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: 2_000,
      source: 'support_claim',
      reasonCode: 'wrong_item',
      idempotencyKey: `req-${String((n += 1))}-same`,
    } as const;
    const first = await createStaffRefund(t(), input);
    const second = await createStaffRefund(t(), input);
    expect(second.replay).toBe(true);
    expect(second.refund.id).toBe(first.refund.id);
    expect(await refundsOf(o.payment.id)).toHaveLength(1);
    await expect(createStaffRefund(t(), { ...input, amountPaise: 3_000 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
  });

  it('a cash-on-delivery order is never refunded through Razorpay: it needs a payout destination', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [{ sku: BATTERY, qty: 1 }],
      locale: 'en',
    });
    n += 1;
    const cod = await placeOrder(t(), {
      method: 'cod',
      userId: customer,
      idempotencyKey: `refunds-key-${String(n).padStart(6, '0')}`,
      address: {
        contactName: 'Ravi',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines: [{ sku: BATTERY, qty: 1 }],
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    await expect(
      createStaffRefund(t(), {
        scope: ALL,
        staffUserId: alice,
        orderCode: `${cod.code}-1`,
        amountPaise: 1_000,
        source: 'part_refund',
        reasonCode: 'goodwill',
        idempotencyKey: `req-${String((n += 1))}-cod`,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_DESTINATION' });
  });

  it('a foreign city or an unknown order is a 404', async () => {
    const o = await paidOrder();
    await expect(
      createStaffRefund(t(), {
        scope: { all: false, cityIds: ['00000000-0000-4000-8000-000000000000'] },
        staffUserId: alice,
        orderCode: o.subs[0]!.code,
        amountPaise: 1_000,
        source: 'part_refund',
        reasonCode: 'goodwill',
        idempotencyKey: `req-${String((n += 1))}-scope`,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('sending to Razorpay (dispatch)', () => {
  async function approvedRefund() {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    return { o, id: r!.id };
  }

  it("storing Razorpay's refund id moves it to initiated, once", async () => {
    const { id } = await approvedRefund();
    await claimRefundDispatch(t(), id);
    expect(await recordRefundSent(t(), id, 'rfnd_abc123')).toBe(true);
    expect(await recordRefundSent(t(), id, 'rfnd_abc123')).toBe(false);
    const [row] = await db.select().from(s.refunds).where(eq(s.refunds.id, id));
    expect(row).toMatchObject({ status: 'initiated', providerRefundId: 'rfnd_abc123' });
  });

  it('a temporary Razorpay error keeps it approved for a retry; a refusal fails it and frees the amount', async () => {
    const a = await approvedRefund();
    await claimRefundDispatch(t(), a.id);
    await recordRefundDispatchError(t(), a.id, { permanent: false, code: 'razorpay_503' });
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, a.id)))[0]).toMatchObject({
      status: 'approved',
      failureCode: 'razorpay_503',
    });
    expect(await dueRefundIds(t(), 10)).not.toContain(a.id); // backing off
    await db
      .update(s.refunds)
      .set({ nextAttemptAt: sql`now() - interval '1 minute'` })
      .where(eq(s.refunds.id, a.id));
    expect(await dueRefundIds(t(), 10)).toContain(a.id);
    await claimRefundDispatch(t(), a.id);
    await recordRefundDispatchError(t(), a.id, { permanent: true, code: 'razorpay_400' });
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, a.id)))[0]).toMatchObject({
      status: 'failed',
      failureCode: 'razorpay_400',
    });
    expect((await paymentRow(a.o.payment.id)).refundReservedPaise).toBe(0);
  });

  it('gives up after eight tries without freeing the money: Razorpay may have sent it (needs reconciliation)', async () => {
    const a = await approvedRefund();
    for (let i = 0; i < 8; i += 1) {
      await db
        .update(s.refunds)
        .set({ nextAttemptAt: sql`now() - interval '1 minute'` })
        .where(eq(s.refunds.id, a.id));
      await claimRefundDispatch(t(), a.id);
      await recordRefundDispatchError(t(), a.id, { permanent: false, code: 'network' });
    }
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, a.id)))[0]).toMatchObject({
      status: 'needs_reconciliation',
      failureCode: 'dispatch_exhausted',
    });
    expect((await paymentRow(a.o.payment.id)).refundReservedPaise).toBe(a.o.total);
  });
});

describe('unsure outcomes never free the money (security review 2026-11-15)', () => {
  async function dispatched() {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    await claimRefundDispatch(t(), r!.id);
    return { o, id: r!.id };
  }
  const row = async (id: string) => (await db.select().from(s.refunds).where(eq(s.refunds.id, id)))[0]!;

  it('an amount Razorpay reports differently keeps the refund unsure, its id stored and the amount reserved', async () => {
    const { o, id } = await dispatched();
    await recordRefundNeedsReconciliation(t(), id, {
      code: 'provider_amount_mismatch',
      providerRefundId: 'rfnd_other000001',
      reportedPaise: o.total - 500,
    });
    expect(await row(id)).toMatchObject({
      status: 'needs_reconciliation',
      providerRefundId: 'rfnd_other000001',
      providerReportedPaise: o.total - 500,
      failureCode: 'provider_amount_mismatch',
    });
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(o.total);
    const alert = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'refund.alert.needs_reconciliation'));
    expect(alert.some((a) => a.entityId === id)).toBe(true);
    // Nobody can send it again meanwhile, and the customer is not told it failed.
    expect(await claimRefundDispatch(t(), id)).toBeNull();
    const [mine] = [...(await customerRefundsByOrder(t(), customer, [o.subs[0]!.id])).values()].flat();
    expect(mine?.status).toBe('processing');
  });

  it('a processed webhook for a refund we had failed moves it to processed, holds the amount again and alerts', async () => {
    const { o, id } = await dispatched();
    await recordRefundDispatchError(t(), id, { permanent: true, code: 'razorpay_400' });
    expect(await row(id)).toMatchObject({ status: 'failed' });
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(0);
    const payment = await paymentRow(o.payment.id);
    const res = await webhook(
      refundFact({ id, providerRefundId: null }, payment, o.total, 'processed', 'rfnd_late00000001'),
    );
    expect(res.outcome).toBe('processed');
    expect(await row(id)).toMatchObject({ status: 'processed', providerRefundId: 'rfnd_late00000001' });
    expect(await paymentRow(o.payment.id)).toMatchObject({
      status: 'refunded',
      refundReservedPaise: o.total,
      refundedPaise: o.total,
    });
    const alert = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'refund.alert.processed_after_failed'));
    expect(alert.some((a) => a.entityId === id)).toBe(true);
  });

  it('cannot re-hold the amount when the ledger filled up meanwhile: refused, alerted, never parked', async () => {
    const { o, id } = await dispatched();
    await recordRefundDispatchError(t(), id, { permanent: true, code: 'razorpay_400' });
    await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: o.total,
      source: 'part_refund',
      reasonCode: 'goodwill',
      idempotencyKey: `req-${String((n += 1))}-refill`,
    });
    const payment = await paymentRow(o.payment.id);
    const res = await webhook(
      refundFact({ id, providerRefundId: null }, payment, o.total, 'processed', 'rfnd_late00000002'),
    );
    expect(res.outcome).toBe('mismatch');
    expect(await row(id)).toMatchObject({ status: 'failed' });
    const alert = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'refund.alert.ledger_full'));
    expect(alert.some((a) => a.entityId === id)).toBe(true);
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(o.total);
  });

  it('a processed webhook for an unsure refund settles it; a failed one frees it', async () => {
    const a = await dispatched();
    await recordRefundNeedsReconciliation(t(), a.id, { code: 'razorpay_timeout' });
    const payment = await paymentRow(a.o.payment.id);
    expect(
      (await webhook(refundFact({ id: a.id, providerRefundId: null }, payment, a.o.total))).outcome,
    ).toBe('processed');
    expect(await row(a.id)).toMatchObject({ status: 'processed' });
    expect((await paymentRow(a.o.payment.id)).refundedPaise).toBe(a.o.total);

    const b = await dispatched();
    await recordRefundNeedsReconciliation(t(), b.id, { code: 'razorpay_timeout' });
    const paymentB = await paymentRow(b.o.payment.id);
    expect(
      (await webhook(refundFact({ id: b.id, providerRefundId: null }, paymentB, b.o.total, 'failed')))
        .outcome,
    ).toBe('failed');
    expect((await paymentRow(b.o.payment.id)).refundReservedPaise).toBe(0);
  });

  it('our own refund id on a webhook is never silently parked, whatever its state (here: never sent)', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id); // still requested: nothing was ever sent
    const payment = await paymentRow(o.payment.id);
    const res = await webhook(
      refundFact({ id: r!.id, providerRefundId: null }, payment, o.total, 'processed', 'rfnd_stray0000001'),
    );
    expect(res.outcome).toBe('mismatch');
    expect((await row(r!.id)).status).toBe('requested');
    const alert = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'refund.alert.unexpected_provider_refund'));
    expect(alert.some((a) => a.entityId === r!.id)).toBe(true);
    const [ev] = await db
      .select()
      .from(s.webhookEvents)
      .where(
        sql`${s.webhookEvents.status} = 'parked' and ${s.webhookEvents.payload}::text like ${'%stray%'}`,
      );
    expect(ev).toBeUndefined();
  });

  it('only an unsure refund with no Razorpay id can be failed on a confirmed absence, which frees the amount', async () => {
    const a = await dispatched();
    await recordRefundNeedsReconciliation(t(), a.id, { code: 'razorpay_timeout' });
    expect(await resolveRefundAbsent(t(), a.id)).toBe(true);
    expect(await row(a.id)).toMatchObject({ status: 'failed' });
    expect((await paymentRow(a.o.payment.id)).refundReservedPaise).toBe(0);
    const b = await dispatched();
    await recordRefundNeedsReconciliation(t(), b.id, {
      code: 'provider_amount_mismatch',
      providerRefundId: 'rfnd_exists00001',
      reportedPaise: 1,
    });
    expect(await resolveRefundAbsent(t(), b.id)).toBe(false); // Razorpay does hold one
    expect((await row(b.id)).status).toBe('needs_reconciliation');
  });

  it('the worker re-checks unsure refunds without a Razorpay id once their wait is over, one claimer at a time', async () => {
    const a = await dispatched();
    await recordRefundNeedsReconciliation(t(), a.id, { code: 'razorpay_timeout' });
    expect(await dueReconciliationIds(t(), 20)).not.toContain(a.id); // not yet
    await db
      .update(s.refunds)
      .set({ nextAttemptAt: sql`now() - interval '1 minute'` })
      .where(eq(s.refunds.id, a.id));
    expect(await dueReconciliationIds(t(), 20)).toContain(a.id);
    const claims = await Promise.all([claimRefundReconcile(t(), a.id), claimRefundReconcile(t(), a.id)]);
    expect(claims.filter((c) => c !== null)).toHaveLength(1);
  });
});

describe('Razorpay refund webhooks (chaos)', () => {
  async function initiated(amountOverride?: number) {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    void amountOverride;
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    await claimRefundDispatch(t(), r!.id);
    await recordRefundSent(t(), r!.id, `rfnd_${r!.id.slice(0, 12)}`);
    const [fresh] = await refundsOf(o.payment.id);
    const payment = await paymentRow(o.payment.id);
    return { o, refund: fresh!, payment };
  }

  it('processed: the refund and the payment settle; replays and a second event id change nothing', async () => {
    const { o, refund, payment } = await initiated();
    const fact = refundFact(refund, payment, o.total);
    expect(await webhook(fact, 'rzp:evt_same')).toMatchObject({ fresh: true, outcome: 'processed' });
    expect(await webhook(fact, 'rzp:evt_same')).toMatchObject({ fresh: false });
    expect(await webhook(fact)).toMatchObject({ fresh: true, outcome: 'unchanged' });
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id)))[0]).toMatchObject({
      status: 'processed',
    });
    expect(await paymentRow(o.payment.id)).toMatchObject({ status: 'refunded', refundedPaise: o.total });
    const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.id, o.groupId));
    expect(group!.paymentStatus).toBe('refunded');
  });

  it('a part refund leaves the payment partially refunded', async () => {
    const o = await paidOrder();
    const { refund } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: 1_500,
      source: 'part_refund',
      reasonCode: 'faulty',
      idempotencyKey: `req-${String((n += 1))}-partial`,
    });
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: refund.id,
      expectedVersion: refund.version,
    });
    await claimRefundDispatch(t(), refund.id);
    await recordRefundSent(t(), refund.id, `rfnd_${refund.id.slice(0, 12)}`);
    const [row] = await refundsOf(o.payment.id);
    const payment = await paymentRow(o.payment.id);
    await webhook(refundFact(row!, payment, 1_500));
    expect(await paymentRow(o.payment.id)).toMatchObject({
      status: 'partially_refunded',
      refundedPaise: 1_500,
    });
  });

  it('the webhook can beat our own write of the Razorpay refund id (approved goes straight to processed)', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    await claimRefundDispatch(t(), r!.id);
    const payment = await paymentRow(o.payment.id);
    const res = await webhook(
      refundFact({ id: r!.id, providerRefundId: null }, payment, o.total, 'processed', 'rfnd_early000001'),
    );
    expect(res.outcome).toBe('processed');
    expect(await recordRefundSent(t(), r!.id, 'rfnd_early000001')).toBe(false); // already past that step
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, r!.id)))[0]).toMatchObject({
      status: 'processed',
      providerRefundId: 'rfnd_early000001',
    });
  });

  it('a wrong amount never settles anything and is audited', async () => {
    const { o, refund, payment } = await initiated();
    const res = await webhook(refundFact(refund, payment, o.total - 1));
    expect(res.outcome).toBe('mismatch');
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id)))[0]!.status).toBe(
      'initiated',
    );
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'refund.amount_mismatch'));
    expect(audit.some((a) => a.entityId === refund.id)).toBe(true);
  });

  it('a refund Razorpay knows but we do not (made in the dashboard) is parked, not lost', async () => {
    const o = await paidOrder();
    const payment = await paymentRow(o.payment.id);
    const res = await webhook({
      providerRefundId: 'rfnd_dashboard01',
      providerPaymentId: payment.providerPaymentId ?? '',
      refundId: '',
      status: 'processed',
      amountPaise: 100,
      currency: 'INR',
    });
    expect(res.outcome).toBe('unknown_refund');
    const [ev] = await db
      .select()
      .from(s.webhookEvents)
      .where(sql`${s.webhookEvents.type} = 'refund.processed' and ${s.webhookEvents.status} = 'parked'`)
      .limit(1);
    expect(ev).toBeDefined();
  });

  it('failed: the amount is freed; a second failed event changes nothing; a late processed event is honoured (money moved)', async () => {
    const { o, refund, payment } = await initiated();
    expect((await webhook(refundFact(refund, payment, o.total, 'failed'))).outcome).toBe('failed');
    expect(await paymentRow(o.payment.id)).toMatchObject({
      refundReservedPaise: 0,
      refundedPaise: 0,
      status: 'paid',
    });
    expect((await webhook(refundFact(refund, payment, o.total, 'failed'))).outcome).toBe('unchanged');
    expect((await webhook(refundFact(refund, payment, o.total))).outcome).toBe('processed');
    expect((await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id)))[0]!.status).toBe(
      'processed',
    );
  });

  it('a refund for another payment id is refused (mismatch)', async () => {
    const { o, refund, payment } = await initiated();
    const fact = { ...refundFact(refund, payment, o.total), providerPaymentId: 'pay_someoneelse' };
    expect((await webhook(fact)).outcome).toBe('mismatch');
  });

  it('a fully refunded order never earns its pending coin rewards (spec 20)', async () => {
    const o = await paidOrder();
    const [reward] = await db
      .insert(s.coinRewards)
      .values({
        userId: customer,
        source: 'order',
        coins: 10,
        availableAt: new Date(Date.now() + 86_400_000),
        orderId: o.subs[0]!.id,
      })
      .returning();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    await claimRefundDispatch(t(), r!.id);
    await recordRefundSent(t(), r!.id, `rfnd_${r!.id.slice(0, 12)}`);
    const [fresh] = await refundsOf(o.payment.id);
    await webhook(refundFact(fresh!, await paymentRow(o.payment.id), o.total));
    const [after] = await db.select().from(s.coinRewards).where(eq(s.coinRewards.id, reward!.id));
    expect(after).toMatchObject({ status: 'cancelled', cancelReasonCode: 'order_refunded' });
  });
});

describe('cash on delivery: paid out by hand (Q104)', () => {
  const key = () => randomBytes(32).toString('base64');
  const keyring = loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${key()}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: key(),
  });
  const upi = { kind: 'upi', upiId: 'ravi.kumar@okhdfcbank' } as const;

  async function deliveredCod() {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [{ sku: BATTERY, qty: 1 }],
      locale: 'en',
    });
    n += 1;
    const placed = await placeOrder(t(), {
      method: 'cod',
      userId: customer,
      idempotencyKey: `refunds-key-${String(n).padStart(6, '0')}`,
      address: {
        contactName: 'Ravi',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines: [{ sku: BATTERY, qty: 1 }],
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    const [sub] = await db
      .select()
      .from(s.orders)
      .where(eq(s.orders.code, `${placed.code}-1`));
    const [shop] = await db.select({ id: s.shops.id }).from(s.shops).limit(1);
    await db.update(s.orders).set({ status: 'delivered', shopId: shop!.id }).where(eq(s.orders.id, sub!.id));
    return sub!;
  }
  const input = (code: string, extra: Record<string, unknown> = {}) => ({
    scope: ALL,
    staffUserId: alice,
    orderCode: code,
    amountPaise: 2_000,
    source: 'support_claim' as const,
    reasonCode: 'faulty' as const,
    destination: upi,
    keyring,
    idempotencyKey: `req-${String((n += 1))}-cod`,
    ...extra,
  });

  it('needs a destination, a delivered (collected) order and stays inside what was paid', async () => {
    const sub = await deliveredCod();
    await expect(createStaffRefund(t(), input(sub.code, { destination: undefined }))).rejects.toMatchObject({
      code: 'REFUND_DESTINATION',
    });
    await expect(
      createStaffRefund(t(), input(sub.code, { amountPaise: sub.totalPaise + 1 })),
    ).rejects.toMatchObject({
      code: 'REFUND_EXCEEDS_ORDER',
    });
    const pending = await db.select().from(s.orders).where(eq(s.orders.id, sub.id));
    await db.update(s.orders).set({ status: 'packed' }).where(eq(s.orders.id, pending[0]!.id));
    await expect(createStaffRefund(t(), input(sub.code))).rejects.toMatchObject({
      code: 'REFUND_NOT_COLLECTED',
    });
  });

  it('keeps the destination encrypted, shows it masked, and reveals it only once approved (audited)', async () => {
    const sub = await deliveredCod();
    const { refund } = await createStaffRefund(t(), input(sub.code));
    expect(refund).toMatchObject({
      mode: 'bank_upi',
      status: 'requested',
      destinationMasked: 'ra***@okhdfcbank',
    });
    const [row] = await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id));
    expect(row!.destinationEnc).toMatch(/^v1\./);
    expect(row!.destinationEnc).not.toContain('ravi');
    expect(row).toMatchObject({ paymentId: null, providerRefundId: null });
    await expect(
      revealRefundDestination(t(), { scope: ALL, staffUserId: bob, refundId: refund.id, keyring }),
    ).rejects.toMatchObject({
      code: 'NOT_APPROVED',
    });
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: refund.id,
      expectedVersion: refund.version,
    });
    expect(
      await revealRefundDestination(t(), { scope: ALL, staffUserId: bob, refundId: refund.id, keyring }),
    ).toEqual(upi);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, refund.id));
    expect(audit.map((a) => a.action)).toContain('refund.destination_viewed');
  });

  it('never goes to Razorpay: no dispatch; finance marks it paid with the UTR, once', async () => {
    const sub = await deliveredCod();
    const { refund } = await createStaffRefund(t(), input(sub.code));
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: refund.id,
      expectedVersion: refund.version,
    });
    expect(await claimRefundDispatch(t(), refund.id)).toBeNull();
    expect(await dueRefundIds(t(), 50)).not.toContain(refund.id);
    const [approved] = await db.select().from(s.refunds).where(eq(s.refunds.id, refund.id));
    await expect(
      markRefundPaid(t(), {
        scope: ALL,
        staffUserId: bob,
        refundId: refund.id,
        expectedVersion: approved!.version,
        reference: 'x',
      }),
    ).rejects.toMatchObject({ code: 'REFUND_REFERENCE' });
    const paid = await markRefundPaid(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: refund.id,
      expectedVersion: approved!.version,
      reference: '412345678901',
    });
    expect(paid).toMatchObject({
      status: 'processed',
      manualReference: '412345678901',
      processedAt: expect.any(String) as string,
    });
    await expect(
      markRefundPaid(t(), {
        scope: ALL,
        staffUserId: bob,
        refundId: refund.id,
        expectedVersion: approved!.version,
        reference: '412345678901',
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_APPROVED|STALE_REFUND/) as string });
    expect((await customerRefundsByOrder(t(), customer, [sub.id])).get(sub.id)?.[0]?.status).toBe('refunded');
  });

  it('cannot be marked paid before an approval, nor can a Razorpay refund be marked paid by hand', async () => {
    const sub = await deliveredCod();
    const { refund } = await createStaffRefund(t(), input(sub.code));
    await expect(
      markRefundPaid(t(), {
        scope: ALL,
        staffUserId: bob,
        refundId: refund.id,
        expectedVersion: refund.version,
        reference: '412345678901',
      }),
    ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    const [fresh] = await refundsOf(o.payment.id);
    await expect(
      markRefundPaid(t(), {
        scope: ALL,
        staffUserId: bob,
        refundId: r!.id,
        expectedVersion: fresh!.version,
        reference: '412345678901',
      }),
    ).rejects.toMatchObject({ code: 'NOT_MANUAL' });
  });

  it('an order paid online takes no destination; four-eyes and rejection work the same', async () => {
    const o = await paidOrder();
    await expect(
      createStaffRefund(t(), input(o.subs[0]!.code, { keyring: undefined })),
    ).rejects.toMatchObject({ code: 'REFUND_DESTINATION' });
    const sub = await deliveredCod();
    const { refund } = await createStaffRefund(t(), input(sub.code));
    await expect(
      approveRefund(t(), {
        scope: ALL,
        staffUserId: alice,
        refundId: refund.id,
        expectedVersion: refund.version,
      }),
    ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    const done = await rejectRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: refund.id,
      expectedVersion: refund.version,
      reasonCode: 'not_eligible',
    });
    expect(done.status).toBe('rejected');
  });
});

describe('what staff and customers see', () => {
  it('the queue counts waiting and overdue requests against the SLA setting', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await db
      .update(s.refunds)
      .set({ createdAt: sql`now() - interval '30 hours'` })
      .where(eq(s.refunds.id, r!.id));
    const page = await listAdminRefunds(t(), ALL, { view: 'overdue', cursor: null, staffUserId: bob });
    expect(page.items.map((i) => i.id)).toContain(r!.id);
    expect(page.items.find((i) => i.id === r!.id)).toMatchObject({ overdue: true, canApprove: true });
    expect(page.counts.overdue).toBeGreaterThanOrEqual(1);
    // The admin raises the limit: the same request is waiting, no longer overdue.
    await db.insert(s.settings).values({ key: 'refunds.approval_sla_hours', value: 72 });
    const later = await listAdminRefunds(t(), ALL, { view: 'overdue', cursor: null, staffUserId: bob });
    expect(later.items.map((i) => i.id)).not.toContain(r!.id);
    await db.delete(s.settings).where(eq(s.settings.key, 'refunds.approval_sla_hours'));
  });

  it('the requester sees canApprove false on their own request', async () => {
    const o = await paidOrder();
    const { refund } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      orderCode: o.subs[0]!.code,
      amountPaise: 700,
      source: 'part_refund',
      reasonCode: 'goodwill',
      idempotencyKey: `req-${String((n += 1))}-view`,
    });
    expect((await getAdminRefund(t(), ALL, alice, refund.id)).canApprove).toBe(false);
    expect((await getAdminRefund(t(), ALL, bob, refund.id)).canApprove).toBe(true);
  });

  it('a customer sees the status of their own refunds only, never before Razorpay confirms', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    const ids = [o.subs[0]!.id];
    expect((await customerRefundsByOrder(t(), customer, ids)).get(ids[0]!)?.[0]).toMatchObject({
      status: 'under_review',
      amountPaise: o.total,
    });
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    expect((await customerRefundsByOrder(t(), customer, ids)).get(ids[0]!)?.[0]?.status).toBe('processing');
    await claimRefundDispatch(t(), r!.id);
    await recordRefundSent(t(), r!.id, `rfnd_${r!.id.slice(0, 12)}`);
    expect((await customerRefundsByOrder(t(), customer, ids)).get(ids[0]!)?.[0]?.status).toBe('processing');
    expect((await customerRefundsByOrder(t(), alice, ids)).size).toBe(0);
  });

  it('every change leaves an append-only event and an audit row', async () => {
    const o = await paidOrder();
    await cancelAsStaff(o.subs[0]!);
    const [r] = await refundsOf(o.payment.id);
    await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
    const events = await db.select().from(s.refundEvents).where(eq(s.refundEvents.refundId, r!.id));
    expect(events.map((e) => e.kind)).toEqual(['requested', 'approved']);
    await expect(db.delete(s.refundEvents).where(eq(s.refundEvents.refundId, r!.id))).rejects.toThrow();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, r!.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['refund.requested', 'refund.approved']),
    );
  });
});
