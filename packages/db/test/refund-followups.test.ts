/**
 * Refund follow-ups (spec 05 "Settling by hand", "Late captures", "Staff alerts", "Credit notes"; decisions
 * 2026-11-16): finance settles a `needs_reconciliation` refund by hand (four-eyes, reason code + note, one winner), a
 * capture that arrives after the order closed raises ONE refund request, refund alerts reach finance staff once and
 * show on the Overview, and a processed refund of an invoiced order gets a gapless, linked credit note.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  adminOverviewCounts,
  allocateInvoiceNumber,
  applyRazorpayPayment,
  approveRefund,
  cancelMyOrder,
  cancelOrderAsStaff,
  claimRefundDispatch,
  createStaffRefund,
  events,
  expireUnpaidOnlineOrders,
  getAdminRefund,
  grantRole,
  listAdminRefunds,
  listNotices,
  placeOrder,
  quoteCheckout,
  recordAndApplyRazorpayRefundEvent,
  recordRazorpayOrder,
  recordRefundNeedsReconciliation,
  settleUnsureRefund,
  syncRbacCatalogue,
  type CityScope,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const skuOf = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? '';
const BATTERY = skuOf('exide-xltz4a-2w-battery');

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
const ring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
let customer = '';
let alice = ''; // staff who asks
let bob = ''; // finance
let carol = ''; // finance
let raipur = '';
let n = 0;

async function place(userId = customer) {
  const lines = [{ sku: BATTERY, qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  n += 1;
  const placed = await placeOrder(t(), {
    method: 'online',
    userId,
    idempotencyKey: `followups-key-${String(n).padStart(6, '0')}`,
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
  const providerOrderId = `order_fu${String(n).padStart(8, '0')}`;
  await recordRazorpayOrder(t(), { groupId: group!.id, providerOrderId, amountPaise: placed.totalPaise });
  return {
    placed,
    groupId: group!.id,
    providerOrderId,
    providerPaymentId: `pay_fu${String(n).padStart(8, '0')}`,
  };
}

const capture = (o: { providerOrderId: string; providerPaymentId: string }, amountPaise: number) => ({
  providerOrderId: o.providerOrderId,
  providerPaymentId: o.providerPaymentId,
  status: 'captured' as const,
  amountPaise,
  currency: 'INR',
  method: 'upi',
});

async function paidOrder() {
  const o = await place();
  await applyRazorpayPayment(t(), capture(o, o.placed.totalPaise));
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(eq(s.payments.providerOrderId, o.providerOrderId));
  const subs = await db
    .select()
    .from(s.orders)
    .where(eq(s.orders.groupId, o.groupId))
    .orderBy(s.orders.subNo);
  return { ...o, payment: payment!, subs, total: o.placed.totalPaise };
}

const refundsOf = (paymentId: string) =>
  db.select().from(s.refunds).where(eq(s.refunds.paymentId, paymentId)).orderBy(s.refunds.createdAt);
const refundRow = async (id: string) => (await db.select().from(s.refunds).where(eq(s.refunds.id, id)))[0]!;
const paymentRow = async (id: string) =>
  (await db.select().from(s.payments).where(eq(s.payments.id, id)))[0]!;

/** A paid order, cancelled by staff, its refund approved, sent once and then reported unsure by Razorpay. */
async function unsure(opts: { reportedPaise?: number; providerRefundId?: string } = {}) {
  const o = await paidOrder();
  await cancelOrderAsStaff(t(), {
    cityIds: 'all',
    code: o.subs[0]!.code,
    reasonCode: 'customer_unreachable',
    expectedVersion: o.subs[0]!.version,
    staffUserId: alice,
  });
  const [r] = await refundsOf(o.payment.id);
  await approveRefund(t(), { scope: ALL, staffUserId: bob, refundId: r!.id, expectedVersion: r!.version });
  await claimRefundDispatch(t(), r!.id);
  await recordRefundNeedsReconciliation(t(), r!.id, {
    code: opts.reportedPaise ? 'provider_amount_mismatch' : 'give_up_after_timeouts',
    providerRefundId: opts.providerRefundId,
    reportedPaise: opts.reportedPaise,
  });
  const row = await refundRow(r!.id);
  expect(row.status).toBe('needs_reconciliation');
  return { o, id: r!.id, version: row.version };
}

const settle = (id: string, version: number, extra: Partial<Parameters<typeof settleUnsureRefund>[1]> = {}) =>
  settleUnsureRefund(t(), {
    scope: ALL,
    staffUserId: bob,
    refundId: id,
    expectedVersion: version,
    outcome: 'not_refunded',
    reasonCode: 'dashboard_checked',
    note: 'Checked the Razorpay dashboard',
    keyring: ring,
    ...extra,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  [raipur] = (await db.select({ id: s.cities.id }).from(s.cities).limit(1)).map((c) => c.id) as [string];
  const mk = async (uid: string, extra: Record<string, string> = {}) =>
    (
      await db
        .insert(s.users)
        .values({ firebaseUid: uid, ...extra })
        .returning()
    )[0]!.id;
  customer = await mk('fb-fu-ravi', { email: 'ravi.followups@example.com' });
  alice = await mk('fb-fu-alice');
  bob = await mk('fb-fu-bob');
  carol = await mk('fb-fu-carol');
  await grantRole(t(), { userId: bob, role: 'finance', grantedBy: null });
  await grantRole(t(), { userId: carol, role: 'finance', grantedBy: null });
});

afterAll(async () => {
  await client.close();
});

describe('finance settles an unsure refund by hand', () => {
  it('not_refunded: Razorpay holds nothing, so the refund fails and the amount is freed', async () => {
    const { o, id, version } = await unsure();
    const v = await settle(id, version);
    expect(v).toMatchObject({ status: 'failed', settleReasonCode: 'dashboard_checked' });
    expect(await refundRow(id)).toMatchObject({
      status: 'failed',
      settledBy: bob,
      settleReasonCode: 'dashboard_checked',
      settleNote: 'Checked the Razorpay dashboard',
    });
    expect((await paymentRow(o.payment.id)).refundReservedPaise).toBe(0);
    const events = await db.select().from(s.refundEvents).where(eq(s.refundEvents.refundId, id));
    expect(events.at(-1)).toMatchObject({ kind: 'failed', actorType: 'admin', actorId: bob });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, id));
    expect(audit.some((a) => a.action === 'refund.reconciled' && a.actorUserId === bob)).toBe(true);
  });

  it('not_refunded is refused when Razorpay already reported a refund id (money did move)', async () => {
    const { id, version } = await unsure({ reportedPaise: 500, providerRefundId: 'rfnd_exists000001' });
    await expect(settle(id, version)).rejects.toMatchObject({ code: 'PROVIDER_HOLDS_REFUND' });
    expect((await refundRow(id)).status).toBe('needs_reconciliation');
  });

  it('refunded_full: needs Razorpay refund id, then the refund and the payment settle', async () => {
    const { o, id, version } = await unsure();
    await expect(settle(id, version, { outcome: 'refunded_full' })).rejects.toMatchObject({
      code: 'PROVIDER_REFUND_ID_REQUIRED',
    });
    const v = await settle(id, version, { outcome: 'refunded_full', providerRefundId: 'rfnd_FullRefund01' });
    expect(v.status).toBe('processed');
    expect(await refundRow(id)).toMatchObject({ providerRefundId: 'rfnd_FullRefund01', settledBy: bob });
    const p = await paymentRow(o.payment.id);
    expect(p).toMatchObject({ refundedPaise: o.total, status: 'refunded' });
    // The customer is told once it is processed, like any processed refund.
    const mails = await db
      .select()
      .from(s.notificationOutbox)
      .where(eq(s.notificationOutbox.channel, 'email'));
    expect(mails.some((m) => m.templateKey === 'refund_processed')).toBe(true);
  });

  it('refunded_other_amount: records the amount Razorpay really refunded and adjusts the ledger', async () => {
    const { o, id, version } = await unsure({ reportedPaise: 500, providerRefundId: 'rfnd_other000002' });
    await expect(
      settle(id, version, { outcome: 'refunded_other_amount', providerAmountPaise: 700 }),
    ).rejects.toMatchObject({ code: 'AMOUNT_DIFFERS_FROM_REPORT' });
    await expect(
      settle(id, version, { outcome: 'refunded_other_amount', providerAmountPaise: o.total + 1 }),
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
    const v = await settle(id, version, { outcome: 'refunded_other_amount', providerAmountPaise: 500 });
    expect(v).toMatchObject({ status: 'processed', amountPaise: 500 });
    const p = await paymentRow(o.payment.id);
    expect(p).toMatchObject({ refundReservedPaise: 500, refundedPaise: 500, status: 'partially_refunded' });
  });

  it('four-eyes: the staff member who asked cannot settle it; a stale version or a closed refund is a 409', async () => {
    const o = await paidOrder();
    const { refund: asked } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      idempotencyKey: `followups-asked-${String(n)}-abcdefgh`,
      orderCode: o.subs[0]!.code,
      amountPaise: 1000,
      source: 'part_refund',
      reasonCode: 'goodwill',
      note: undefined,
      destination: undefined,
      keyring: ring,
    });
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: asked.id,
      expectedVersion: asked.version,
    });
    await claimRefundDispatch(t(), asked.id);
    await recordRefundNeedsReconciliation(t(), asked.id, { code: 'give_up_after_timeouts' });
    const row = await refundRow(asked.id);
    await expect(settle(asked.id, row.version, { staffUserId: alice })).rejects.toMatchObject({
      code: 'FOUR_EYES',
    });
    // The database says the same, whatever the code does.
    await expect(
      db
        .update(s.refunds)
        .set({ settledBy: alice, settleReasonCode: 'other', settleNote: 'x'.repeat(12) })
        .where(eq(s.refunds.id, asked.id)),
    ).rejects.toThrow();
    await expect(settle(asked.id, row.version + 9)).rejects.toMatchObject({ code: 'STALE_REFUND' });
    await settle(asked.id, row.version);
    await expect(settle(asked.id, row.version)).rejects.toMatchObject({ code: 'NOT_UNSURE' });
  });

  it('a note of at least ten characters is required; scope hides foreign cities (404)', async () => {
    const { id, version } = await unsure();
    await expect(settle(id, version, { note: 'short' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      settle(id, version, { scope: { all: false, cityIds: ['00000000-0000-7000-8000-000000000000'] } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('two finance users settling at once: exactly one wins', async () => {
    const { id, version } = await unsure();
    const results = await Promise.allSettled([
      settle(id, version, { staffUserId: bob }),
      settle(id, version, { staffUserId: carol }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const events = await db.select().from(s.refundEvents).where(eq(s.refundEvents.refundId, id));
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(1);
  });

  it('a late processed webhook after a by-hand failure is still honoured (money moved)', async () => {
    const { o, id, version } = await unsure();
    await settle(id, version);
    const r = await refundRow(id);
    const res = await recordAndApplyRazorpayRefundEvent(t(), {
      eventId: `rzp:evt_fu_late_${id.slice(0, 8)}`,
      type: 'refund.processed',
      payload: {},
      fact: {
        providerRefundId: 'rfnd_late000000001',
        providerPaymentId: o.providerPaymentId,
        refundId: id,
        status: 'processed',
        amountPaise: r.amountPaise,
        currency: 'INR',
      },
    });
    expect(res.outcome).toBe('processed');
  });
});

describe('a capture after the order closed raises one refund request', () => {
  it('an expired payment window: the capture is recorded and ONE request (payment_after_close) waits for approval', async () => {
    const o = await place();
    await db.execute(
      sql`update order_groups set created_at = now() - interval '45 minutes' where id = ${o.groupId}`,
    );
    await expireUnpaidOnlineOrders(t());
    expect(await applyRazorpayPayment(t(), capture(o, o.placed.totalPaise))).toEqual({
      outcome: 'needs_refund',
    });
    const [payment] = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.providerOrderId, o.providerOrderId));
    expect(payment).toMatchObject({ status: 'paid', providerPaymentId: o.providerPaymentId });
    const rows = await refundsOf(payment!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'requested',
      source: 'payment_after_close',
      reasonCode: 'payment_after_close',
      amountPaise: o.placed.totalPaise,
      requestedBy: null,
      mode: 'source',
    });
    expect((await paymentRow(payment!.id)).refundReservedPaise).toBe(o.placed.totalPaise);
    // The same webhook again (or a retry) neither adds a request nor moves anything.
    expect(await applyRazorpayPayment(t(), capture(o, o.placed.totalPaise))).toEqual({
      outcome: 'unchanged',
    });
    expect(await refundsOf(payment!.id)).toHaveLength(1);
    // The order is never completed by it.
    const subs = await db.select().from(s.orders).where(eq(s.orders.groupId, o.groupId));
    expect(subs.every((x) => x.status === 'cancelled')).toBe(true);
    const logged = await db.select().from(events).where(eq(events.event, 'refund_requested_after_close'));
    expect(logged.length).toBeGreaterThan(0);
  });

  it('an order the customer cancelled before paying: the late capture asks for a refund too, and the queue shows it', async () => {
    await db
      .insert(s.settings)
      .values({ key: 'orders.customer_self_cancel_online', value: true })
      .onConflictDoNothing();
    const o = await place();
    const [sub] = await db.select().from(s.orders).where(eq(s.orders.code, o.placed.orders[0]!.code));
    await cancelMyOrder(t(), {
      userId: customer,
      code: sub!.code,
      reasonCode: 'changed_mind',
      expectedVersion: sub!.version,
    });
    await applyRazorpayPayment(t(), capture(o, o.placed.totalPaise));
    const page = await listAdminRefunds(t(), ALL, {
      view: 'waiting',
      cursor: null,
      staffUserId: bob,
      limit: 50,
    });
    const mine = page.items.find((r) => r.groupCode === o.placed.code);
    expect(mine).toMatchObject({
      source: 'payment_after_close',
      amountPaise: o.placed.totalPaise,
      status: 'requested',
    });
  });

  it('a normal capture on a live order creates no refund', async () => {
    const o = await paidOrder();
    expect(await refundsOf(o.payment.id)).toHaveLength(0);
  });
});

describe('staff alerts', () => {
  const noticesOf = async (userId: string) =>
    (await db.select().from(s.notifications).where(eq(s.notifications.userId, userId))).filter(
      (x) => x.kind === 'staff.refund_alert',
    );

  it('an unsure refund alerts finance staff once (bell), not the requester-only staff, and not twice', async () => {
    const before = (await noticesOf(bob)).length;
    const { id } = await unsure();
    expect((await noticesOf(bob)).length).toBe(before + 1);
    expect((await noticesOf(carol)).length).toBeGreaterThan(0);
    expect(await noticesOf(alice)).toHaveLength(0);
    // The same alert again (a second report of the same refund) does not ring the bell twice.
    await recordRefundNeedsReconciliation(t(), id, {
      code: 'provider_amount_mismatch',
      providerRefundId: 'rfnd_dup000000001',
      reportedPaise: 100,
    });
    expect((await noticesOf(bob)).length).toBe(before + 1);
    const list = await listNotices(t(), bob, { limit: 50 });
    expect(list.notices.some((x) => x.kind === 'staff.refund_alert')).toBe(true);
  });

  it('a Razorpay refund we never asked for alerts finance (unexpected_provider_refund)', async () => {
    const o = await paidOrder();
    const { refund: asked } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      idempotencyKey: `followups-unexp-${String(n)}-abcdefgh`,
      orderCode: o.subs[0]!.code,
      amountPaise: 1000,
      source: 'part_refund',
      reasonCode: 'goodwill',
      note: undefined,
      destination: undefined,
      keyring: ring,
    });
    const before = (await noticesOf(bob)).length;
    const res = await recordAndApplyRazorpayRefundEvent(t(), {
      eventId: `rzp:evt_fu_unexp_${n}`,
      type: 'refund.processed',
      payload: {},
      fact: {
        providerRefundId: 'rfnd_unexp0000001',
        providerPaymentId: o.providerPaymentId,
        refundId: asked.id,
        status: 'processed',
        amountPaise: 1000,
        currency: 'INR',
      },
    });
    expect(res.outcome).toBe('mismatch');
    expect((await noticesOf(bob)).length).toBe(before + 1);
  });
});

describe('Overview counts', () => {
  const scopes = (refunds: CityScope | null) => ({
    orders: null,
    service: null,
    tickets: null,
    reviews: null,
    applications: null,
    prices: null,
    analytics: null,
    refunds,
  });

  it('counts refunds waiting for approval and refunds that need checking, within the staff scope', async () => {
    await paidOrder().then(async (o) => {
      await cancelOrderAsStaff(t(), {
        cityIds: 'all',
        code: o.subs[0]!.code,
        reasonCode: 'customer_unreachable',
        expectedVersion: o.subs[0]!.version,
        staffUserId: alice,
      });
    });
    await unsure();
    const c = await adminOverviewCounts(t(), { now: new Date(), scopes: scopes(ALL) });
    expect(c.refundsWaiting).toBeGreaterThan(0);
    expect(c.refundsNeedChecking).toBeGreaterThan(0);
    const none = await adminOverviewCounts(t(), { now: new Date(), scopes: scopes(null) });
    expect(none.refundsWaiting).toBeNull();
    expect(none.refundsNeedChecking).toBeNull();
    const inCity = await adminOverviewCounts(t(), {
      now: new Date(),
      scopes: scopes({ all: false, cityIds: [raipur] }),
    });
    expect(inCity.refundsWaiting).toBeGreaterThan(0);
    const elsewhere = await adminOverviewCounts(t(), {
      now: new Date(),
      scopes: scopes({ all: false, cityIds: ['00000000-0000-7000-8000-000000000000'] }),
    });
    expect(elsewhere.refundsWaiting).toBe(0);
  });
});

describe('credit notes for refunds of invoiced orders', () => {
  async function invoicedOrder() {
    const o = await paidOrder();
    const sub = o.subs[0]!;
    const total = sub.totalPaise;
    const cgst = Math.round((total * 9) / 118);
    const taxable = total - 2 * cgst;
    const num = await db.transaction((tx) => allocateInvoiceNumber(tx as unknown as Tx, 'MDR'));
    const [inv] = await db
      .insert(s.invoices)
      .values({
        kind: 'tax_invoice',
        series: num.series,
        fy: num.fy,
        seq: num.seq,
        number: num.number,
        orderId: sub.id,
        taxablePaise: taxable,
        cgstPaise: cgst,
        sgstPaise: cgst,
        totalPaise: total,
      })
      .returning();
    return { ...o, sub, invoice: inv!, total };
  }

  async function refundAndProcess(o: Awaited<ReturnType<typeof invoicedOrder>>, amountPaise: number) {
    const { refund: asked } = await createStaffRefund(t(), {
      scope: ALL,
      staffUserId: alice,
      idempotencyKey: `followups-cn-${String(n)}-${String(amountPaise)}-abcdefgh`,
      orderCode: o.sub.code,
      amountPaise,
      source: 'part_refund',
      reasonCode: 'goodwill',
      note: undefined,
      destination: undefined,
      keyring: ring,
    });
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: bob,
      refundId: asked.id,
      expectedVersion: asked.version,
    });
    await claimRefundDispatch(t(), asked.id);
    const res = await recordAndApplyRazorpayRefundEvent(t(), {
      eventId: `rzp:evt_fu_cn_${asked.id.slice(0, 12)}`,
      type: 'refund.processed',
      payload: {},
      fact: {
        providerRefundId: `rfnd_cn${asked.id.slice(0, 12)}`,
        providerPaymentId: o.providerPaymentId,
        refundId: asked.id,
        status: 'processed',
        amountPaise,
        currency: 'INR',
      },
    });
    expect(res.outcome).toBe('processed');
    return asked.id;
  }

  const creditNotes = (invoiceId: string) =>
    db
      .select()
      .from(s.invoices)
      .where(and(eq(s.invoices.creditNoteFor, invoiceId), eq(s.invoices.kind, 'credit_note')))
      .orderBy(s.invoices.seq);

  it('a processed refund gets one credit note from its own gapless series, linked both ways', async () => {
    const o = await invoicedOrder();
    const refundId = await refundAndProcess(o, 1180);
    const [cn] = await creditNotes(o.invoice.id);
    expect(cn).toMatchObject({
      kind: 'credit_note',
      series: 'CN',
      refundId,
      creditNoteFor: o.invoice.id,
      orderId: o.sub.id,
      totalPaise: 1180,
      status: 'issued',
    });
    expect(cn!.number).toMatch(/^CN\/\d{4}\/\d{6}$/);
    // Components add up exactly to the refund; CGST equals SGST.
    expect(cn!.taxablePaise + cn!.cgstPaise + cn!.sgstPaise + cn!.igstPaise).toBe(1180);
    expect(cn!.cgstPaise).toBe(cn!.sgstPaise);
    const view = await getAdminRefund(t(), ALL, bob, refundId, ring);
    expect(view.creditNote).toMatchObject({ number: cn!.number, totalPaise: 1180 });
  });

  it('the series has no gaps, and a replayed webhook never issues a second credit note', async () => {
    const o = await invoicedOrder();
    const a = await refundAndProcess(o, 1000);
    const b = await refundAndProcess(o, 500);
    const notes = await creditNotes(o.invoice.id);
    expect(notes.map((x) => x.refundId)).toEqual([a, b]);
    expect(notes[1]!.seq).toBe(notes[0]!.seq + 1);
    const replay = await recordAndApplyRazorpayRefundEvent(t(), {
      eventId: `rzp:evt_fu_cn_replay_${a.slice(0, 8)}`,
      type: 'refund.processed',
      payload: {},
      fact: {
        providerRefundId: `rfnd_cn${a.slice(0, 12)}`,
        providerPaymentId: o.providerPaymentId,
        refundId: a,
        status: 'processed',
        amountPaise: 1000,
        currency: 'INR',
      },
    });
    expect(replay.outcome).toBe('unchanged');
    expect(await creditNotes(o.invoice.id)).toHaveLength(2);
  });

  it('credit notes together never exceed the invoice; the last one takes the exact remainder of every component', async () => {
    const o = await invoicedOrder();
    await refundAndProcess(o, 333);
    await refundAndProcess(o, o.total - 333);
    const notes = await creditNotes(o.invoice.id);
    const sum = (k: 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'totalPaise') =>
      notes.reduce((acc, x) => acc + x[k], 0);
    expect(sum('totalPaise')).toBe(o.invoice.totalPaise);
    expect(sum('taxablePaise')).toBe(o.invoice.taxablePaise);
    expect(sum('cgstPaise')).toBe(o.invoice.cgstPaise);
    expect(sum('sgstPaise')).toBe(o.invoice.sgstPaise);
  });

  it('an order without a tax invoice gets none; a credit note must point at an invoice (CHECK) and one per refund (unique)', async () => {
    const o = await paidOrder();
    await cancelOrderAsStaff(t(), {
      cityIds: 'all',
      code: o.subs[0]!.code,
      reasonCode: 'customer_unreachable',
      expectedVersion: o.subs[0]!.version,
      staffUserId: alice,
    });
    expect(await db.select().from(s.invoices).where(eq(s.invoices.orderId, o.subs[0]!.id))).toHaveLength(0);
    await expect(
      db.insert(s.invoices).values({
        kind: 'credit_note',
        series: 'CN',
        fy: '2627',
        seq: 9999,
        number: 'CN/2627/009999',
        taxablePaise: 1,
        totalPaise: 1,
      }),
    ).rejects.toThrow();
  });
});
