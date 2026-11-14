/**
 * Refunds over HTTP (spec 05; decision 2026-11-15 "All need approval"): a cancelled paid order waits in the finance
 * queue; only a staff member with `refunds:approve` (not the requester) can approve it; approving sends exactly one
 * Razorpay refund (with its idempotency key); the signed refund webhook settles it and the customer sees the status
 * on the order. A fake gateway stands in for Razorpay (never a real call).
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import {
  RazorpayError,
  type RazorpayGateway,
  type RazorpayPayment,
  type RazorpayRefund,
} from '../src/payments/razorpay';
import { dispatchDueRefunds, reconcileDueRefunds } from '../src/payments/refunds';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const BATTERY = fixture.products.find((p) => p.slug === 'exide-xltz4a-2w-battery')?.sku ?? '';
const KEY_SECRET = 'test_key_secret_0123456789';
const WEBHOOK_SECRET = 'test_webhook_secret_01';
const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_Fake0123456789',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

interface RefundCall {
  paymentId: string;
  amountPaise: number;
  idemKey: string;
  refundId: string;
}

class FakeRazorpay implements RazorpayGateway {
  keyId = ENV.RAZORPAY_KEY_ID;
  orders = 0;
  payments = new Map<string, RazorpayPayment>();
  refundCalls: RefundCall[] = [];
  /** What the next refund call does: answer, or throw this Razorpay HTTP status. */
  failWith: number | null = null;
  /** Razorpay creates the refund, then the answer is lost (timeout): the classic uncertain outcome. */
  loseAnswer: { status: string } | null = null;
  /** Razorpay creates a refund for another amount than we asked. */
  otherAmount: number | null = null;
  /** The lookup itself cannot be answered (Razorpay is down). */
  lookupDown = false;
  /** Refunds Razorpay holds, by our refund id. */
  held = new Map<string, RazorpayRefund>();
  createOrder(input: { amountPaise: number }) {
    this.orders += 1;
    return Promise.resolve({
      id: `order_RfFake${String(this.orders).padStart(6, '0')}`,
      amountPaise: input.amountPaise,
      currency: 'INR' as const,
    });
  }
  fetchPayment(id: string) {
    const p = this.payments.get(id);
    return p ? Promise.resolve(p) : Promise.reject(new Error('unknown payment'));
  }
  createRefund(input: RefundCall) {
    this.refundCalls.push(input);
    if (this.failWith) return Promise.reject(new RazorpayError(this.failWith, 'refused'));
    const made: RazorpayRefund = {
      id: `rfnd_${input.idemKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 14)}`,
      paymentId: input.paymentId,
      amountPaise: this.otherAmount ?? input.amountPaise,
      status: this.loseAnswer?.status ?? 'pending',
    };
    this.held.set(input.refundId, made);
    if (this.loseAnswer) return Promise.reject(new Error('timeout'));
    return Promise.resolve(made);
  }
  findRefund(input: { refundId: string }) {
    if (this.lookupDown) return Promise.reject(new Error('lookup down'));
    return Promise.resolve(this.held.get(input.refundId) ?? null);
  }
}

let ctx: Awaited<ReturnType<typeof buildApp>>;
let razorpay: FakeRazorpay;
let ravi: Record<string, string>;
let finance: Record<string, string>;
let ops: Record<string, string>;
let boss: Record<string, string>;
let n = 0;

async function person(label: string, role: string | null) {
  n += 1;
  const phone = `+9198444444${String(n).padStart(2, '0')}`;
  const token = ctx.verifier.add(`token-refunds-${label}-0000`, {
    firebaseUid: `rf-${label}`,
    phone,
    email: `rf-${label}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `rf-${label}`,
    phone,
    email: `rf-${label}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: null, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const json = async <T>(res: Response) => (await res.json()) as T;
interface RefundJson {
  id: string;
  status: string;
  version: number;
  amountPaise: number;
  orderCode: string | null;
  mode: string;
  providerRefundId: string | null;
  canApprove: boolean;
}

/** Customer pays online through the API; returns the order with its sub-order codes. */
async function paidOrder() {
  const lines = [{ sku: BATTERY, qty: 1 }];
  const q = await json<{ onlineTotalPaise: number }>(
    await ctx.app.request('/v1/checkout/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pincode: '492004', lines }),
    }),
  );
  n += 1;
  // A fresh customer per order: placing orders is rate limited per user.
  const buyer = await person(`buyer${String(n)}`, null);
  const placed = await json<{
    code: string;
    totalPaise: number;
    orders: { code: string }[];
    razorpay: { orderId: string };
  }>(
    await ctx.app.request('/v1/orders', {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': `refunds-api-key-${String(n).padStart(6, '0')}` },
      body: JSON.stringify({
        address: { contactName: 'Ravi', contactPhone: '+919876543210', line1: 'House 12', pincode: '492004' },
        lines,
        expectedTotalPaise: q.onlineTotalPaise,
        paymentMethod: 'online',
        locale: 'en',
      }),
    }),
  );
  const paymentId = `pay_RfPaid${String(n).padStart(6, '0')}`;
  razorpay.payments.set(paymentId, {
    id: paymentId,
    orderId: placed.razorpay.orderId,
    status: 'captured',
    amountPaise: placed.totalPaise,
    currency: 'INR',
    method: 'upi',
  });
  const sig = createHmac('sha256', KEY_SECRET)
    .update(`${placed.razorpay.orderId}|${paymentId}`)
    .digest('hex');
  const verified = await ctx.app.request('/v1/payments/razorpay/verify', {
    method: 'POST',
    headers: buyer,
    body: JSON.stringify({
      razorpayOrderId: placed.razorpay.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: sig,
    }),
  });
  expect(verified.status).toBe(200);
  return { buyer, group: placed.code, sub: placed.orders[0]!.code, total: placed.totalPaise, paymentId };
}

async function cancelByStaff(sub: string) {
  const [o] = await ctx.db.select().from(s.orders).where(eq(s.orders.code, sub));
  const res = await ctx.app.request(`/v1/admin/orders/${sub}/cancel`, {
    method: 'POST',
    headers: boss,
    body: JSON.stringify({ reasonCode: 'customer_unreachable', version: o!.version }),
  });
  expect(res.status).toBe(200);
}

const queue = async (headers: Record<string, string>, view = 'waiting') =>
  json<{ items: RefundJson[]; counts: { waiting: number; overdue: number; attention: number } }>(
    await ctx.app.request(`/v1/admin/refunds?view=${view}&limit=50`, { headers }),
  );
const approve = (headers: Record<string, string>, r: RefundJson) =>
  ctx.app.request(`/v1/admin/refunds/${r.id}/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ version: r.version }),
  });
const webhook = (event: string, refund: Record<string, unknown>, eventId: string) => {
  const raw = JSON.stringify({ event, payload: { refund: { entity: refund } } });
  return ctx.app.request('/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
    },
    body: raw,
  });
};
const customerRefunds = async (group: string, buyer: Record<string, string>) =>
  (
    await json<{ orders: { refunds: { status: string; amountPaise: number }[] }[] }>(
      await ctx.app.request(`/v1/orders/${group}`, { headers: buyer }),
    )
  ).orders[0]!.refunds;

beforeAll(async () => {
  razorpay = new FakeRazorpay();
  ctx = await buildApp({ env: ENV, razorpay });
  await seedRaipurDemo(ctx.db, fixture);
  // Plenty of stock: these tests place many orders for the same battery.
  await ctx.db.update(s.shopInventory).set({ onHand: 500 });
  ravi = await person('ravi', null);
  finance = await person('finance', 'finance');
  ops = await person('ops', 'ops_manager');
  boss = await person('boss', 'super_admin');
});

describe('refund requests over HTTP', () => {
  it('a cancelled paid order waits for approval: only finance sees the approve button, ops cannot approve', async () => {
    const o = await paidOrder();
    await cancelByStaff(o.sub);
    expect(razorpay.refundCalls).toHaveLength(0); // nothing is sent before an approval
    const q = await queue(finance);
    const r = q.items.find((i) => i.orderCode === o.sub)!;
    expect(r).toMatchObject({ status: 'requested', canApprove: true, mode: 'source' });
    expect(q.counts.waiting).toBeGreaterThanOrEqual(1);
    expect((await customerRefunds(o.group, o.buyer))[0]).toMatchObject({
      status: 'under_review',
      amountPaise: o.total,
    });
    // Ops may look and ask, not approve.
    expect((await queue(ops)).items.map((i) => i.id)).toContain(r.id);
    expect((await approve(ops, r)).status).toBe(403);
    expect(razorpay.refundCalls).toHaveLength(0);
    // A customer is not staff.
    expect((await ctx.app.request('/v1/admin/refunds', { headers: ravi })).status).toBe(403);
  });

  it('approving sends exactly one Razorpay refund with its idempotency key; a second approval is a 409', async () => {
    const o = await paidOrder();
    await cancelByStaff(o.sub);
    const r = (await queue(finance)).items.find((i) => i.orderCode === o.sub)!;
    const before = razorpay.refundCalls.length;
    const [first, second] = await Promise.all([approve(finance, r), approve(boss, r)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(razorpay.refundCalls).toHaveLength(before + 1);
    expect(razorpay.refundCalls.at(-1)).toMatchObject({
      paymentId: o.paymentId,
      amountPaise: o.total,
      refundId: r.id,
    });
    const done = await json<RefundJson>(
      await ctx.app.request(`/v1/admin/refunds/${r.id}`, { headers: finance }),
    );
    expect(done.status).toBe('initiated');
    expect(done.providerRefundId).toMatch(/^rfnd_/);
    // "Processing" for the customer: never "refunded" until Razorpay confirms.
    expect((await customerRefunds(o.group, o.buyer))[0]!.status).toBe('processing');
  });

  it('the signed refund.processed webhook settles it; replays and a wrong signature change nothing', async () => {
    const o = await paidOrder();
    await cancelByStaff(o.sub);
    const r = (await queue(finance)).items.find((i) => i.orderCode === o.sub)!;
    await approve(finance, r);
    const sent = await json<RefundJson>(
      await ctx.app.request(`/v1/admin/refunds/${r.id}`, { headers: finance }),
    );
    const entity = {
      id: sent.providerRefundId,
      payment_id: o.paymentId,
      amount: o.total,
      currency: 'INR',
      status: 'processed',
      notes: { refundId: r.id },
    };
    const bad = await ctx.app.request('/webhooks/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-event-id': 'evt_rfbad0001', 'x-razorpay-signature': 'ab'.repeat(32) },
      body: JSON.stringify({ event: 'refund.processed', payload: { refund: { entity } } }),
    });
    expect(bad.status).toBe(400);
    expect((await webhook('refund.processed', entity, 'evt_rfok00001')).status).toBe(200);
    expect((await webhook('refund.processed', entity, 'evt_rfok00001')).status).toBe(200);
    const done = await json<RefundJson>(
      await ctx.app.request(`/v1/admin/refunds/${r.id}`, { headers: finance }),
    );
    expect(done.status).toBe('processed');
    expect((await customerRefunds(o.group, o.buyer))[0]).toMatchObject({
      status: 'refunded',
      amountPaise: o.total,
    });
    const [payment] = await ctx.db
      .select()
      .from(s.payments)
      .where(eq(s.payments.providerPaymentId, o.paymentId));
    expect(payment).toMatchObject({ status: 'refunded', refundedPaise: o.total });
  });

  it('a Razorpay outage keeps it approved and the worker sweep sends it once; a refusal fails it', async () => {
    const o = await paidOrder();
    await cancelByStaff(o.sub);
    const r = (await queue(finance)).items.find((i) => i.orderCode === o.sub)!;
    razorpay.failWith = 503;
    expect((await approve(finance, r)).status).toBe(200);
    razorpay.failWith = null;
    const [row] = await ctx.db.select().from(s.refunds).where(eq(s.refunds.id, r.id));
    expect(row!.status).toBe('approved'); // approved, not lost
    await ctx.db
      .update(s.refunds)
      .set({ nextAttemptAt: new Date(Date.now() - 60_000) })
      .where(eq(s.refunds.id, r.id));
    const before = razorpay.refundCalls.length;
    expect(await dispatchDueRefunds(ctx.db, razorpay)).toMatchObject({ sent: 1 });
    expect(razorpay.refundCalls).toHaveLength(before + 1);
    expect(razorpay.refundCalls.at(-1)!.idemKey).toBe(row!.idemKey); // same key, so Razorpay would dedupe
    expect(await dispatchDueRefunds(ctx.db, razorpay)).toMatchObject({ sent: 0 });

    const p = await paidOrder();
    await cancelByStaff(p.sub);
    const r2 = (await queue(finance)).items.find((i) => i.orderCode === p.sub)!;
    razorpay.failWith = 400;
    await approve(finance, r2);
    razorpay.failWith = null;
    const [failed] = await ctx.db.select().from(s.refunds).where(eq(s.refunds.id, r2.id));
    expect(failed).toMatchObject({ status: 'failed', failureCode: 'razorpay_400' });
    expect((await customerRefunds(p.group, p.buyer))[0]!.status).toBe('failed');
  });

  it('staff ask for a part refund with an Idempotency-Key; the requester cannot approve it (four-eyes)', async () => {
    const o = await paidOrder();
    const post = (key: string, amountPaise = 1_000) =>
      ctx.app.request('/v1/admin/refunds', {
        method: 'POST',
        headers: { ...boss, 'idempotency-key': key },
        body: JSON.stringify({
          orderCode: o.sub,
          amountPaise,
          source: 'support_claim',
          reasonCode: 'faulty',
          note: 'Customer sent photos of the damage',
        }),
      });
    expect((await post('rf-api-claim-key-0000001')).status).toBe(201);
    const again = await post('rf-api-claim-key-0000001');
    expect(again.status).toBe(200);
    const r = await json<RefundJson>(again);
    expect((await post('rf-api-claim-key-0000001', 2_000)).status).toBe(409);
    expect((await post('rf-api-claim-key-0000002', o.total)).status).toBe(409); // more than was paid for
    // The requester (a super admin, who may approve in general) still cannot approve their own.
    const own = await approve(boss, r);
    expect(own.status).toBe(403);
    expect((await json<ErrorJson>(own)).error.code).toBe('FOUR_EYES');
    expect((await approve(finance, r)).status).toBe(200);
  });

  it('declining needs a reason code; a foreign or unknown refund is a 404', async () => {
    const o = await paidOrder();
    await cancelByStaff(o.sub);
    const r = (await queue(finance)).items.find((i) => i.orderCode === o.sub)!;
    const reject = (reasonCode: string) =>
      ctx.app.request(`/v1/admin/refunds/${r.id}/reject`, {
        method: 'POST',
        headers: finance,
        body: JSON.stringify({ version: r.version, reasonCode }),
      });
    expect((await reject('made_up')).status).toBe(400);
    expect((await reject('not_eligible')).status).toBe(200);
    expect(
      (await ctx.app.request('/v1/admin/refunds/00000000-0000-4000-8000-000000000000', { headers: finance }))
        .status,
    ).toBe(404);
    expect((await customerRefunds(o.group, o.buyer))[0]!.status).toBe('declined');
  });
});

describe('uncertain outcomes never free the money (security review 2026-11-15)', () => {
  async function approvedWith(setup: () => void) {
    const o = await paidOrder();
    await cancelByStaff(o.sub);
    const r = (await queue(finance)).items.find((i) => i.orderCode === o.sub)!;
    setup();
    expect((await approve(finance, r)).status).toBe(200);
    razorpay.failWith = null;
    razorpay.loseAnswer = null;
    razorpay.otherAmount = null;
    razorpay.lookupDown = false;
    const row = async () => (await ctx.db.select().from(s.refunds).where(eq(s.refunds.id, r.id)))[0]!;
    const payment = async () =>
      (await ctx.db.select().from(s.payments).where(eq(s.payments.providerPaymentId, o.paymentId)))[0]!;
    return { o, r, row, payment };
  }

  it('a timeout on create: the lookup finds the refund, so it is recorded and never created twice', async () => {
    const calls = razorpay.refundCalls.length;
    const a = await approvedWith(() => {
      razorpay.loseAnswer = { status: 'processed' };
    });
    expect(await a.row()).toMatchObject({ status: 'processed' });
    expect(razorpay.refundCalls.length).toBe(calls + 1); // exactly one create
    expect(await dispatchDueRefunds(ctx.db, razorpay)).toMatchObject({ sent: 0 });
    expect(razorpay.refundCalls.length).toBe(calls + 1);
    expect(await a.payment()).toMatchObject({ status: 'refunded', refundedPaise: a.o.total });
  });

  it('a refusal that Razorpay confirms it never created fails the refund and frees the amount', async () => {
    const a = await approvedWith(() => {
      razorpay.failWith = 400;
    });
    expect(await a.row()).toMatchObject({ status: 'failed', failureCode: 'razorpay_400' });
    expect((await a.payment()).refundReservedPaise).toBe(0);
  });

  it('a refusal that could not be double-checked keeps the amount reserved (needs reconciliation)', async () => {
    const a = await approvedWith(() => {
      razorpay.failWith = 400;
      razorpay.lookupDown = true;
    });
    expect(await a.row()).toMatchObject({ status: 'needs_reconciliation', failureCode: 'razorpay_400' });
    expect((await a.payment()).refundReservedPaise).toBe(a.o.total);
    expect((await customerRefunds(a.o.group, a.o.buyer))[0]!.status).toBe('processing');
  });

  it('an amount that differs from ours is never failed: unsure, id and reported amount stored, amount reserved', async () => {
    const a = await approvedWith(() => {
      razorpay.otherAmount = 100;
    });
    expect(await a.row()).toMatchObject({
      status: 'needs_reconciliation',
      failureCode: 'provider_amount_mismatch',
      providerReportedPaise: 100,
    });
    expect((await a.row()).providerRefundId).toMatch(/^rfnd_/);
    expect((await a.payment()).refundReservedPaise).toBe(a.o.total);
    const queueAttention = await queue(finance, 'attention');
    expect(queueAttention.items.map((i) => i.id)).toContain(a.r.id);
    expect(queueAttention.counts.attention).toBeGreaterThanOrEqual(1);
  });

  it('the worker re-checks an unsure refund: found, it is recorded; confirmed absent, it fails and frees the money', async () => {
    const lost = await approvedWith(() => {
      razorpay.failWith = 400;
      razorpay.lookupDown = true;
    });
    const gone = await approvedWith(() => {
      razorpay.failWith = 400;
      razorpay.lookupDown = true;
    });
    // Razorpay did create the first one after all.
    razorpay.held.set(lost.r.id, {
      id: 'rfnd_found0000001',
      paymentId: lost.o.paymentId,
      amountPaise: lost.o.total,
      status: 'processed',
    });
    for (const a of [lost, gone])
      await ctx.db
        .update(s.refunds)
        .set({ nextAttemptAt: new Date(Date.now() - 60_000) })
        .where(eq(s.refunds.id, a.r.id));
    expect(await reconcileDueRefunds(ctx.db, razorpay)).toMatchObject({ found: 1, absent: 1 });
    expect(await lost.row()).toMatchObject({ status: 'processed', providerRefundId: 'rfnd_found0000001' });
    expect(await gone.row()).toMatchObject({ status: 'failed' });
    expect((await gone.payment()).refundReservedPaise).toBe(0);
    expect(await reconcileDueRefunds(ctx.db, razorpay)).toMatchObject({ found: 0, absent: 0 });
  });

  it('a processed webhook for a refund we had failed settles it and leaves an alert', async () => {
    const a = await approvedWith(() => {
      razorpay.failWith = 400;
    });
    expect((await a.row()).status).toBe('failed');
    const entity = {
      id: 'rfnd_latewebhook01',
      payment_id: a.o.paymentId,
      amount: a.o.total,
      currency: 'INR',
      status: 'processed',
      notes: { refundId: a.r.id },
    };
    expect((await webhook('refund.processed', entity, 'evt_rflate0001')).status).toBe(200);
    expect(await a.row()).toMatchObject({ status: 'processed' });
    expect(await a.payment()).toMatchObject({ refundReservedPaise: a.o.total, refundedPaise: a.o.total });
    const audit = await ctx.db.select().from(s.auditLog);
    expect(
      audit.some((x) => x.entityId === a.r.id && x.action === 'refund.alert.processed_after_failed'),
    ).toBe(true);
  });
});
