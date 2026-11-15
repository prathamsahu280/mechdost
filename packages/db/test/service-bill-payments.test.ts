/**
 * Online payment of the service bill, staff cancel and ranked suggestions (spec 03, 05, 06; design 2026-11-15, items 5
 * to 7): the same payments table and webhook handling as orders with purpose `service_bill`; one open Razorpay order per
 * bill; "pay online" and "paid at the workshop" can never both settle a bill (the loser is a conflict or a refund
 * request); staff cancel refunds a paid bill through the refunds queue exactly once and gives the slot back once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { CreateServiceRequestInput, SendEstimateInput } from '@mechdost/shared/service-requests';
import { istDateString } from '@mechdost/shared/time';
import {
  advanceJob,
  applyRazorpayPayment,
  applyRazorpayRefund,
  approveRefund,
  billJob,
  cancelServiceRequestByStaff,
  claimRefundDispatch,
  createServiceRequest,
  decideEstimate,
  decideProposal,
  getMyServiceRequest,
  listAdminRefunds,
  markJobPaid,
  payableBillOfUser,
  paymentOfUserBill,
  proposeSlot,
  receiveVehicle,
  recordAndApplyRazorpayEvent,
  recordBillRazorpayOrder,
  recordRefundSent,
  sendEstimate,
  suggestWorkshopsForRequest,
  setWorkshopStanding,
  getAdminWorkshop,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const W: Record<string, { id: string; slug: string }> = {};
const TODAY = istDateString(new Date());
let keyN = 0;
let orderN = 0;
const ALL = { all: true as const };

/** The first date from tomorrow on that is not a Sunday (the fixture workshops are open Monday to Saturday). */
function openDate(): string {
  for (let i = 1; i < 9; i += 1) {
    const d = istDateString(new Date(Date.now() + i * 86_400_000));
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) return d;
  }
  throw new Error('no open date');
}
const DAY = openDate();

const LINES: SendEstimateInput['lines'] = [
  { description: 'Engine oil 1 L', serviceKey: null, qty: 1, unitPaise: 45_000, gstRateBp: 1800 },
];

const step = (code: string, version: number, key = 'main') => ({
  workshopIds: [W[key]!.id],
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});

async function request(over: Partial<CreateServiceRequestInput> = {}) {
  keyN += 1;
  return createServiceRequest(t(), {
    userId: f.customer,
    idempotencyKey: `bill-pay-key-${String(keyN).padStart(6, '0')}`,
    request: {
      workshopSlug: W.main!.slug,
      vehicleType: '2W',
      vehicleId: null,
      vehicle: 'Honda Activa 6G',
      serviceKeys: ['routine2w'],
      concern: null,
      pincode: '492001',
      lat: null,
      lng: null,
      preferredDate: TODAY,
      preferredSlot: 'morning',
      pickup: false,
      ...over,
    },
  });
}

/** Up to `confirmed` (a proposal with an hourly slot held). */
async function confirmed(hour: number | null = null, date = TODAY) {
  const r = await request();
  let v = (
    await proposeSlot(t(), {
      ...step(r.code, r.version),
      date,
      ...(hour === null ? { slot: 'morning' as const } : { hour }),
      lowPaise: 80_000,
      highPaise: 150_000,
      note: null,
    })
  ).version;
  v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
    .version;
  return { code: r.code, version: v };
}

/** A request taken through to `billed`. */
async function billed() {
  const c = await confirmed();
  let v = (await receiveVehicle(t(), { ...step(c.code, c.version), odometerKm: 5_000 })).version;
  const sent = await sendEstimate(t(), { ...step(c.code, v), lines: LINES });
  const view = await getMyServiceRequest(t(), f.customer, c.code, 'en');
  v = (
    await decideEstimate(t(), {
      userId: f.customer,
      code: c.code,
      decision: {
        revision: 1,
        version: sent.version,
        consent: true,
        decisions: (view.estimate?.items ?? []).map((i) => ({ itemId: i.id, decision: 'approved' as const })),
      },
    })
  ).version;
  v = (await advanceJob(t(), { ...step(c.code, v), to: 'in_progress' })).version;
  v = (await advanceJob(t(), { ...step(c.code, v), to: 'ready' })).version;
  const bill = await billJob(t(), step(c.code, v));
  return { code: c.code, version: bill.version, totalPaise: bill.totalPaise };
}

/** The Razorpay order of a bill as the API stores it. */
async function openOrder(code: string) {
  orderN += 1;
  const bill = await payableBillOfUser(t(), { userId: f.customer, code });
  const row = await recordBillRazorpayOrder(t(), {
    billId: bill.billId,
    providerOrderId: `order_bill${String(orderN).padStart(4, '0')}`,
    amountPaise: bill.totalPaise,
  });
  return { ...row, billId: bill.billId };
}

let payN = 0;
const capture = (
  providerOrderId: string,
  amountPaise: number,
  paymentId = `pay_auto${String((payN += 1)).padStart(5, '0')}`,
  over = {},
) => ({
  providerOrderId,
  providerPaymentId: paymentId,
  status: 'captured' as const,
  amountPaise,
  currency: 'INR',
  method: 'upi',
  ...over,
});

const stateOf = async (code: string) => {
  const [r] = await db.select().from(s.serviceRequests).where(eq(s.serviceRequests.code, code));
  const [b] = await db.select().from(s.serviceBills).where(eq(s.serviceBills.requestId, r!.id));
  return { request: r!, bill: b! };
};
const refundsOf = (billId: string) => db.select().from(s.refunds).where(eq(s.refunds.billId, billId));

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  W.main = await addWorkshop(db, f, { name: 'Main', gstin: '22AAAAA0000A1Z5' });
  W.other = await addWorkshop(db, f, { name: 'Other' });
});
afterAll(async () => {
  await client.close();
});

describe('online payment of the service bill', () => {
  it('stores one Razorpay order per bill: a second click returns the first, a foreign user gets 404', async () => {
    const b = await billed();
    const first = await openOrder(b.code);
    const bill = await payableBillOfUser(t(), { userId: f.customer, code: b.code });
    const second = await recordBillRazorpayOrder(t(), {
      billId: bill.billId,
      providerOrderId: 'order_second0001',
      amountPaise: bill.totalPaise,
    });
    expect(second.providerOrderId).toBe(first.providerOrderId);
    const rows = await db.select().from(s.payments).where(eq(s.payments.billId, bill.billId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'service_bill', groupId: null, amountPaise: b.totalPaise });
    await expect(payableBillOfUser(t(), { userId: f.other, code: b.code })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      paymentOfUserBill(t(), { userId: f.other, providerOrderId: first.providerOrderId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an amount that is not the bill total', async () => {
    const b = await billed();
    const bill = await payableBillOfUser(t(), { userId: f.customer, code: b.code });
    await expect(
      recordBillRazorpayOrder(t(), {
        billId: bill.billId,
        providerOrderId: 'order_wrongamt01',
        amountPaise: bill.totalPaise - 1,
      }),
    ).rejects.toMatchObject({ code: 'PAYABLE_CHANGED' });
  });

  it('a capture settles bill and request (billed to paid to completed) once; replays change nothing', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    const fact = capture(order.providerOrderId, b.totalPaise);
    expect(await applyRazorpayPayment(t(), fact)).toEqual({ outcome: 'paid' });
    const { request, bill } = await stateOf(b.code);
    expect(request.status).toBe('completed');
    expect(bill).toMatchObject({ method: 'online', paidRecordedBy: null });
    expect(bill.paidAt).not.toBeNull();
    const events = await db.select().from(s.serviceEvents).where(eq(s.serviceEvents.requestId, request.id));
    expect(events.filter((e) => e.toStatus === 'paid')).toHaveLength(1);
    // Replay x3 via the webhook path (new event ids: Razorpay may send order.paid and payment.captured).
    for (let i = 0; i < 3; i += 1) {
      const r = await recordAndApplyRazorpayEvent(t(), {
        eventId: `rzp:evt_replay${String(i)}`,
        type: 'payment.captured',
        payload: {},
        fact,
      });
      expect(r.outcome).toBe('unchanged');
    }
    // The same event id twice is deduplicated before anything is applied.
    await recordAndApplyRazorpayEvent(t(), { eventId: 'rzp:evt_same', type: 'x', payload: {}, fact });
    expect(
      await recordAndApplyRazorpayEvent(t(), { eventId: 'rzp:evt_same', type: 'x', payload: {}, fact }),
    ).toMatchObject({ fresh: false, outcome: null });
    expect(await refundsOf(bill.id)).toHaveLength(0);
  });

  it('out of order: failed or authorized after paid never regress it; failed then captured still pays', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    expect(
      await applyRazorpayPayment(
        t(),
        capture(order.providerOrderId, b.totalPaise, 'pay_bill0002', { status: 'failed' }),
      ),
    ).toEqual({ outcome: 'failed' });
    expect((await stateOf(b.code)).request.status).toBe('billed');
    expect(
      await applyRazorpayPayment(t(), capture(order.providerOrderId, b.totalPaise, 'pay_bill0003')),
    ).toEqual({
      outcome: 'paid',
    });
    for (const status of ['failed', 'authorized'] as const)
      expect(
        await applyRazorpayPayment(
          t(),
          capture(order.providerOrderId, b.totalPaise, 'pay_bill0003', { status }),
        ),
      ).toEqual({ outcome: 'unchanged' });
    const [p] = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.providerOrderId, order.providerOrderId));
    expect(p?.status).toBe('paid');
  });

  it('tamper: a wrong amount or currency is a mismatch, audited, and settles nothing', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    expect(await applyRazorpayPayment(t(), capture(order.providerOrderId, b.totalPaise - 100))).toEqual({
      outcome: 'mismatch',
    });
    expect(
      await applyRazorpayPayment(
        t(),
        capture(order.providerOrderId, b.totalPaise, 'pay_bill0004', { currency: 'USD' }),
      ),
    ).toEqual({ outcome: 'mismatch' });
    const { request, bill } = await stateOf(b.code);
    expect(request.status).toBe('billed');
    expect(bill.paidAt).toBeNull();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'payment.amount_mismatch'));
    expect(audit.some((a) => a.entityId === order.providerOrderId)).toBe(true);
  });

  it('an unknown order id is parked, not an error', async () => {
    expect(await applyRazorpayPayment(t(), capture('order_nothere0001', 100))).toEqual({
      outcome: 'unknown_order',
    });
  });

  it('a different captured payment on a paid order is money taken twice: audited once, no second settlement', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    await applyRazorpayPayment(t(), capture(order.providerOrderId, b.totalPaise, 'pay_bill0005'));
    const again = capture(order.providerOrderId, b.totalPaise, 'pay_bill0006');
    expect(await applyRazorpayPayment(t(), again)).toEqual({ outcome: 'needs_refund' });
    expect(await applyRazorpayPayment(t(), again)).toEqual({ outcome: 'needs_refund' });
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(
        and(
          eq(s.auditLog.action, 'payment.captured_needs_refund'),
          eq(s.auditLog.entityId, order.providerOrderId),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it('paid at the workshop first: a late capture is recorded and ONE refund request is raised, no second settlement', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    const done = await markJobPaid(t(), { ...step(b.code, b.version), method: 'cash' });
    expect(done.status).toBe('completed');
    const fact = capture(order.providerOrderId, b.totalPaise, 'pay_late00001');
    expect(await applyRazorpayPayment(t(), fact)).toEqual({ outcome: 'needs_refund' });
    expect(await applyRazorpayPayment(t(), fact)).toEqual({ outcome: 'unchanged' });
    const { bill } = await stateOf(b.code);
    expect(bill.method).toBe('cash');
    const refunds = await refundsOf(bill.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: 'requested',
      amountPaise: b.totalPaise,
      source: 'duplicate_payment',
      groupId: null,
      orderId: null,
    });
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, refunds[0]!.paymentId!));
    expect(p).toMatchObject({ status: 'paid', refundReservedPaise: b.totalPaise });
  });

  it('after an online payment "paid at the workshop" is refused (the request moved on)', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    await applyRazorpayPayment(t(), capture(order.providerOrderId, b.totalPaise));
    await expect(markJobPaid(t(), { ...step(b.code, b.version + 2), method: 'cash' })).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
    await expect(payableBillOfUser(t(), { userId: f.customer, code: b.code })).rejects.toMatchObject({
      code: 'BILL_NOT_PAYABLE',
    });
  });

  it('concurrent online capture and paid-at-workshop: exactly one settles, the other loses cleanly', async () => {
    for (let round = 0; round < 3; round += 1) {
      const b = await billed();
      const order = await openOrder(b.code);
      const results = await Promise.allSettled([
        applyRazorpayPayment(
          t(),
          capture(order.providerOrderId, b.totalPaise, `pay_race0000${String(round)}`),
        ),
        markJobPaid(t(), { ...step(b.code, b.version), method: 'upi' }),
      ]);
      const { request, bill } = await stateOf(b.code);
      expect(request.status).toBe('completed');
      expect(bill.paidAt).not.toBeNull();
      const paidEvents = await db
        .select()
        .from(s.serviceEvents)
        .where(and(eq(s.serviceEvents.requestId, request.id), eq(s.serviceEvents.toStatus, 'paid')));
      expect(paidEvents).toHaveLength(1);
      const refunds = await refundsOf(bill.id);
      const workshopWon = bill.method !== 'online';
      if (workshopWon) {
        expect(refunds).toHaveLength(1); // the capture came after: it is refunded, never a second settlement
        expect(results[1].status).toBe('fulfilled');
      } else {
        expect(refunds).toHaveLength(0);
        expect(results[1].status).toBe('rejected'); // the workshop's mark lost with WRONG_STEP
      }
    }
  });
});

describe('staff cancel', () => {
  it('cancels with a reason code, withdraws the proposal and gives the held hour back exactly once', async () => {
    const c = await confirmed(11, DAY);
    const slot = async () =>
      (await db.select().from(s.workshopSlots).where(eq(s.workshopSlots.workshopId, W.main!.id))).find(
        (x) => x.hour === 11 && x.slotDate === DAY,
      );
    expect((await slot())?.booked).toBeGreaterThanOrEqual(1);
    const before = (await slot())!.booked;
    const out = await cancelServiceRequestByStaff(t(), {
      scope: ALL,
      code: c.code,
      reasonCode: 'workshop_unavailable',
      expectedVersion: c.version,
      staffUserId: f.staff,
    });
    expect(out).toMatchObject({ status: 'cancelled', refundRequested: false });
    expect((await slot())?.booked).toBe(before - 1);
    const { request } = await stateOf(c.code);
    expect(request).toMatchObject({ status: 'cancelled', statusReasonCode: 'workshop_unavailable' });
    const [proposal] = await db
      .select()
      .from(s.serviceProposals)
      .where(eq(s.serviceProposals.requestId, request.id));
    expect(proposal?.slotReleasedAt).not.toBeNull();
    // A second cancel is refused and the slot stays released once.
    await expect(
      cancelServiceRequestByStaff(t(), {
        scope: ALL,
        code: c.code,
        reasonCode: 'workshop_unavailable',
        expectedVersion: out.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
    expect((await slot())?.booked).toBe(before - 1);
    // Told through the customer's bell, and audited.
    const notices = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.kind, 'service.cancelled'));
    expect(notices.length).toBe(1);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, request.id));
    expect(audit.some((a) => a.action === 'service_request.cancelled' && a.actorRole === 'admin')).toBe(true);
  });

  it("is limited to the staff member's city and refuses finished requests", async () => {
    const c = await confirmed();
    await expect(
      cancelServiceRequestByStaff(t(), {
        scope: { all: false, cityIds: [f.bhilai] },
        code: c.code,
        reasonCode: 'other',
        expectedVersion: c.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelServiceRequestByStaff(t(), {
        scope: { all: false, cityIds: [] },
        code: c.code,
        reasonCode: 'other',
        expectedVersion: c.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const b = await billed();
    const order = await openOrder(b.code);
    await applyRazorpayPayment(t(), capture(order.providerOrderId, b.totalPaise));
    await expect(
      cancelServiceRequestByStaff(t(), {
        scope: ALL,
        code: b.code,
        reasonCode: 'other',
        expectedVersion: b.version + 2,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
  });

  it('a stale version is a conflict, not a silent cancel', async () => {
    const c = await confirmed();
    await expect(
      cancelServiceRequestByStaff(t(), {
        scope: ALL,
        code: c.code,
        reasonCode: 'other',
        expectedVersion: c.version + 5,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' });
  });

  it('cancelling a paid request creates exactly one refund request in the queue, however often it is retried', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    await applyRazorpayPayment(t(), capture(order.providerOrderId, b.totalPaise, 'pay_cxl00001'));
    // The paid step is transient in real life (paid to completed in the same transaction); a paid-but-open request is
    // reproduced here so the cancel path that refunds is exercised.
    const { request, bill } = await stateOf(b.code);
    await db
      .update(s.serviceRequests)
      .set({ status: 'paid', completedAt: null })
      .where(eq(s.serviceRequests.id, request.id));
    const v = (await stateOf(b.code)).request.version;
    const attempts = await Promise.allSettled([
      cancelServiceRequestByStaff(t(), {
        scope: ALL,
        code: b.code,
        reasonCode: 'policy_violation',
        expectedVersion: v,
        staffUserId: f.staff,
      }),
      cancelServiceRequestByStaff(t(), {
        scope: ALL,
        code: b.code,
        reasonCode: 'policy_violation',
        expectedVersion: v,
        staffUserId: f.staff,
      }),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const refunds = await refundsOf(bill.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: 'requested',
      amountPaise: b.totalPaise,
      source: 'service_cancelled',
      reasonCode: 'service_cancelled',
      requestedBy: null,
    });
    // It is in the finance queue for the right city only, with the request code and the customer-facing "online".
    const queue = await listAdminRefunds(t(), ALL, { view: 'waiting', cursor: null, staffUserId: f.staff });
    const mine = queue.items.find((i) => i.id === refunds[0]!.id);
    expect(mine).toMatchObject({ groupCode: b.code, orderCode: null, paymentMethod: 'online' });
    const bhilaiQueue = await listAdminRefunds(
      t(),
      { all: false, cityIds: [f.bhilai] },
      { view: 'waiting', cursor: null, staffUserId: f.staff },
    );
    expect(bhilaiQueue.items.find((i) => i.id === refunds[0]!.id)).toBeUndefined();
    const raipurQueue = await listAdminRefunds(
      t(),
      { all: false, cityIds: [f.raipur] },
      { view: 'waiting', cursor: null, staffUserId: f.staff },
    );
    expect(raipurQueue.items.find((i) => i.id === refunds[0]!.id)).toBeDefined();
    // The customer's request-level refund email is queued with the request code and an honest money line.
    const approved = await approveRefund(t(), {
      scope: ALL,
      staffUserId: f.other,
      refundId: refunds[0]!.id,
      expectedVersion: refunds[0]!.version,
    });
    expect(approved.status).toBe('approved');
    const job = await claimRefundDispatch(t(), refunds[0]!.id);
    expect(job).toMatchObject({ amountPaise: b.totalPaise, providerPaymentId: 'pay_cxl00001' });
    await recordRefundSent(t(), refunds[0]!.id, 'rfnd_cxl00001');
    expect(
      await applyRazorpayRefund(t(), {
        providerRefundId: 'rfnd_cxl00001',
        providerPaymentId: 'pay_cxl00001',
        refundId: refunds[0]!.id,
        status: 'processed',
        amountPaise: b.totalPaise,
        currency: 'INR',
      }),
    ).toEqual({ outcome: 'processed' });
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, refunds[0]!.paymentId!));
    expect(p).toMatchObject({ status: 'refunded', refundedPaise: b.totalPaise });
  });

  it('a capture that arrives after a staff cancel is recorded and refunded once (source service_cancelled)', async () => {
    const b = await billed();
    const order = await openOrder(b.code);
    const out = await cancelServiceRequestByStaff(t(), {
      scope: ALL,
      code: b.code,
      reasonCode: 'customer_asked',
      expectedVersion: b.version,
      staffUserId: f.staff,
    });
    expect(out.refundRequested).toBe(false);
    const fact = capture(order.providerOrderId, b.totalPaise, 'pay_aftercxl1');
    expect(await applyRazorpayPayment(t(), fact)).toEqual({ outcome: 'needs_refund' });
    expect(await applyRazorpayPayment(t(), fact)).toEqual({ outcome: 'unchanged' });
    const { request, bill } = await stateOf(b.code);
    expect(request.status).toBe('cancelled');
    expect(bill.paidAt).toBeNull();
    const refunds = await refundsOf(bill.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.source).toBe('service_cancelled');
  });
});

describe('ranked suggestions for routing', () => {
  it('lists eligible workshops of the city with reasons, never busy or paused ones, and 404s a foreign city', async () => {
    const paused = await addWorkshop(db, f, { name: 'Paused' });
    const p = await getAdminWorkshop(t(), ALL, paused.id);
    await setWorkshopStanding(t(), {
      scope: ALL,
      staffUserId: f.staff,
      workshopId: paused.id,
      status: 'paused',
      reason: 'Paused for checks',
      expectedVersion: p.version,
    });
    const busy = await addWorkshop(db, f, { name: 'Busy' });
    await db.update(s.workshops).set({ busy: true }).where(eq(s.workshops.id, busy.id));
    const bhilai = await addWorkshop(db, f, { name: 'Bhilai', pincode: '490001', lat: 21.21, lng: 81.38 });
    const r = await request();
    const out = await suggestWorkshopsForRequest(t(), ALL, r.code, 'en');
    const ids = out.map((x) => x.workshopId);
    expect(ids).toContain(W.main!.id);
    expect(ids).toContain(W.other!.id);
    for (const hidden of [paused.id, busy.id, bhilai.id]) expect(ids).not.toContain(hidden);
    expect(out.map((x) => x.rank)).toEqual(out.map((_, i) => i + 1));
    expect(out[0]?.reasons).toHaveLength(5);
    await expect(
      suggestWorkshopsForRequest(t(), { all: false, cityIds: [f.bhilai] }, r.code, 'en'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a workshop with more open jobs ranks below an otherwise identical empty one; a settled request is a conflict', async () => {
    const quiet = await addWorkshop(db, f, { name: 'Quiet' });
    const loaded = await addWorkshop(db, f, { name: 'Loaded' });
    for (let i = 0; i < 4; i += 1) {
      keyN += 1;
      const q = await createServiceRequest(t(), {
        userId: f.customer,
        idempotencyKey: `bill-pay-load-${String(keyN).padStart(6, '0')}`,
        request: {
          workshopSlug: loaded.slug,
          vehicleType: '2W',
          vehicleId: null,
          vehicle: 'Honda Activa 6G',
          serviceKeys: ['routine2w'],
          concern: null,
          pincode: '492001',
          lat: null,
          lng: null,
          preferredDate: TODAY,
          preferredSlot: 'morning',
          pickup: false,
        },
      });
      expect(q.status).toBe('awaiting_workshop');
    }
    const r = await request();
    const out = await suggestWorkshopsForRequest(t(), ALL, r.code, 'en');
    const at = (id: string) => out.findIndex((x) => x.workshopId === id);
    expect(at(quiet.id)).toBeLessThan(at(loaded.id));
    expect(out.find((x) => x.workshopId === loaded.id)?.openJobs).toBe(4);
    const b = await billed();
    await expect(suggestWorkshopsForRequest(t(), ALL, b.code, 'en')).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
  });
});
