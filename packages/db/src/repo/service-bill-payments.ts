import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { paymentMachine, type PaymentStatus } from '@mechdost/shared/state';
import { auditLog, payments, serviceBills, serviceRequests } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { PaymentOutcome, RazorpayPaymentFact } from './payments';
import { requestRefundForServiceBill } from './refunds';
import { lockRequest, transitionRequest } from './service-requests';

/**
 * Online payment of a workshop service bill (spec 03 "Service bill payments", spec 06; razorpay-payments skill).
 * The same `payments` table and the same webhook as product orders, purpose `service_bill`, one Razorpay order per
 * bill at a time (`payments_one_open_per_bill_uq`). The amount is ALWAYS the bill's `total_paise` read here, never
 * anything the client sent. A capture settles the bill and the request (billed -> paid -> completed) in one
 * transaction under the lock order request -> bill -> payment; "paid at the workshop" (`markJobPaid`) takes the
 * request row first as well and moves the request out of `billed`, so exactly one of the two paths can settle a bill:
 * the other finds the request no longer `billed` and ends as a conflict (workshop) or as a refund request (a capture
 * that arrives late). No coins or coupons apply to bills (builder ruling 2026-11-15, spec 03).
 */
const OPEN: readonly PaymentStatus[] = ['created', 'attempted', 'failed'];
const PAID_LIKE: readonly string[] = ['paid', 'partially_refunded', 'refunded'];

export interface BillPaymentRow {
  id: string;
  billId: string;
  providerOrderId: string;
  amountPaise: number;
  status: string;
}

const columns = {
  id: payments.id,
  providerOrderId: payments.providerOrderId,
  amountPaise: payments.amountPaise,
  status: payments.status,
};

/** A customer's own request with a bill that can still be paid online (404 for anyone else's, 409 otherwise). */
export async function payableBillOfUser(
  db: Tx,
  input: { userId: string; code: string },
): Promise<{ billId: string; requestCode: string; totalPaise: number }> {
  const [row] = await db
    .select({
      billId: serviceBills.id,
      requestCode: serviceRequests.code,
      totalPaise: serviceBills.totalPaise,
      paidAt: serviceBills.paidAt,
      status: serviceRequests.status,
    })
    .from(serviceRequests)
    .innerJoin(serviceBills, eq(serviceBills.requestId, serviceRequests.id))
    .where(and(eq(serviceRequests.code, input.code), eq(serviceRequests.userId, input.userId)))
    .limit(1);
  if (!row) throw new NotFoundError('Service request not found');
  if (row.status !== 'billed' || row.paidAt !== null)
    throw new ConflictError('This bill cannot be paid online now', 'BILL_NOT_PAYABLE');
  return { billId: row.billId, requestCode: row.requestCode, totalPaise: row.totalPaise };
}

/** The Razorpay order of a bill that can still be paid, or null (a retry or a double click reuses it). */
export async function openPaymentForBill(db: Tx, billId: string): Promise<BillPaymentRow | null> {
  const [row] = await db
    .select({ ...columns, billId: payments.billId })
    .from(payments)
    .where(and(eq(payments.billId, billId), inArray(payments.status, [...OPEN])))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row?.billId ? { ...row, billId: row.billId } : null;
}

/**
 * Store the Razorpay order before the client sees it. The request row is locked (the same lock "paid at the workshop"
 * and a capture take) and the bill is read again: a bill settled meanwhile gives `BILL_NOT_PAYABLE`, and the amount
 * must equal the bill's total. Two overlapping clicks: the unique open-order index lets the first stored order win,
 * the second gets that order back and its own Razorpay order is never shown.
 */
export async function recordBillRazorpayOrder(
  db: Tx,
  input: { billId: string; providerOrderId: string; amountPaise: number },
): Promise<BillPaymentRow> {
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select({ requestId: serviceBills.requestId })
      .from(serviceBills)
      .where(eq(serviceBills.id, input.billId))
      .limit(1);
    if (!b) throw new NotFoundError('Bill not found');
    const r = await lockRequest(tx, eq(serviceRequests.id, b.requestId));
    const [bill] = await tx
      .select({ totalPaise: serviceBills.totalPaise, paidAt: serviceBills.paidAt })
      .from(serviceBills)
      .where(eq(serviceBills.id, input.billId))
      .for('update');
    if (!bill || r.status !== 'billed' || bill.paidAt !== null)
      throw new ConflictError('This bill cannot be paid online now', 'BILL_NOT_PAYABLE');
    if (bill.totalPaise !== input.amountPaise)
      throw new ConflictError('The amount to pay changed', 'PAYABLE_CHANGED');
    const [row] = await tx
      .insert(payments)
      .values({
        purpose: 'service_bill',
        billId: input.billId,
        groupId: null,
        providerOrderId: input.providerOrderId,
        amountPaise: input.amountPaise,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (row) return { ...row, billId: input.billId };
    const open = await openPaymentForBill(tx, input.billId);
    if (!open) throw new ConflictError('This bill cannot be paid online now', 'BILL_NOT_PAYABLE');
    return open;
  });
}

/** The payment behind a Razorpay order of a bill, only for the customer who owns the request (404 otherwise). */
export async function paymentOfUserBill(
  db: Tx,
  input: { userId: string; providerOrderId: string },
): Promise<BillPaymentRow & { requestCode: string }> {
  const [row] = await db
    .select({ ...columns, billId: serviceBills.id, requestCode: serviceRequests.code })
    .from(payments)
    .innerJoin(serviceBills, eq(serviceBills.id, payments.billId))
    .innerJoin(serviceRequests, eq(serviceRequests.id, serviceBills.requestId))
    .where(and(eq(payments.providerOrderId, input.providerOrderId), eq(serviceRequests.userId, input.userId)))
    .limit(1);
  if (!row) throw new NotFoundError('Payment not found');
  return row;
}

const TARGET: Record<RazorpayPaymentFact['status'], 'paid' | 'attempted' | 'failed'> = {
  captured: 'paid',
  authorized: 'attempted',
  failed: 'failed',
};

/**
 * Apply one Razorpay payment fact to a bill payment (called by `applyRazorpayPayment` inside its transaction). Locks
 * request -> bill -> payment; amount and currency must match what we asked for and the bill's total (else audited
 * `mismatch`); the payment status only moves forward through `paymentMachine`. A capture settles the bill when the
 * request is still `billed` and the bill unpaid; otherwise the money is real but the bill is settled or the request is
 * cancelled: the payment is recorded as captured and ONE refund request is raised (idempotent per payment).
 */
export async function applyBillPayment(
  tx: Tx,
  fact: RazorpayPaymentFact,
  billId: string,
): Promise<{ outcome: PaymentOutcome }> {
  const [b] = await tx
    .select({ requestId: serviceBills.requestId })
    .from(serviceBills)
    .where(eq(serviceBills.id, billId))
    .limit(1);
  if (!b) return { outcome: 'unknown_order' };
  const r = await lockRequest(tx, eq(serviceRequests.id, b.requestId));
  const [bill] = await tx
    .select({ totalPaise: serviceBills.totalPaise, paidAt: serviceBills.paidAt })
    .from(serviceBills)
    .where(eq(serviceBills.id, billId))
    .for('update');
  const [payment] = await tx
    .select({ ...columns, providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(eq(payments.providerOrderId, fact.providerOrderId))
    .for('update');
  if (!bill || !payment) return { outcome: 'unknown_order' };

  if (
    fact.amountPaise !== payment.amountPaise ||
    fact.currency !== 'INR' ||
    payment.amountPaise !== bill.totalPaise
  ) {
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: 'payment.amount_mismatch',
      entity: 'payment',
      entityId: fact.providerOrderId,
      after: { expectedPaise: payment.amountPaise, gotPaise: fact.amountPaise, currency: fact.currency },
    });
    return { outcome: 'mismatch' };
  }

  const to = TARGET[fact.status];
  const from = payment.status as PaymentStatus;
  // A completed payment is final: the same payment again is a replay; a different captured one is money taken twice.
  if (from === 'paid' || from === 'partially_refunded' || from === 'refunded') {
    if (to !== 'paid' || payment.providerPaymentId === fact.providerPaymentId)
      return { outcome: 'unchanged' };
    await flagForRefund(tx, fact, r.code);
    return { outcome: 'needs_refund' };
  }
  if (from === to || !paymentMachine.canActor(from, to, 'system')) return { outcome: 'unchanged' };

  const move = async () => {
    await tx
      .update(payments)
      .set({
        status: to,
        providerPaymentId: fact.providerPaymentId,
        method: fact.method,
        ...(to === 'paid' ? { capturedAt: sql`now()` } : {}),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, from)));
  };

  if (to !== 'paid') {
    await move();
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: `payment.${to}`,
      entity: 'payment',
      entityId: payment.id,
      after: { providerPaymentId: fact.providerPaymentId, method: fact.method, from },
    });
    if (to === 'failed')
      await recordServerEvent(tx, 'service_bill_payment_failed', {
        userId: r.userId,
        cityId: r.cityId,
        props: { requestCode: r.code, amountPaise: payment.amountPaise, method: fact.method ?? 'unknown' },
      });
    return { outcome: to };
  }

  // Captured. Settle only a bill that is still waiting for money; the conditional UPDATE is the arbiter.
  if (r.status === 'billed' && bill.paidAt === null) {
    const settled = await tx
      .update(serviceBills)
      .set({ paidAt: new Date(), method: 'online' })
      .where(and(eq(serviceBills.id, billId), sql`${serviceBills.paidAt} is null`))
      .returning({ id: serviceBills.id });
    if (settled.length === 1) {
      await move();
      await tx.insert(auditLog).values({
        actorUserId: null,
        actorRole: 'system',
        action: 'payment.paid',
        entity: 'payment',
        entityId: payment.id,
        after: { providerPaymentId: fact.providerPaymentId, method: fact.method, from },
      });
      const step = await transitionRequest(tx, {
        request: r,
        to: 'paid',
        expectedVersion: r.version,
        actor: { type: 'system', userId: null },
        payload: { method: 'online', at: 'razorpay', amountPaise: payment.amountPaise },
      });
      await transitionRequest(tx, {
        request: r,
        to: 'completed',
        expectedVersion: step.version,
        actor: { type: 'system', userId: null },
        patch: { completedAt: new Date() },
      });
      await recordServerEvent(tx, 'service_bill_paid', {
        userId: r.userId,
        cityId: r.cityId,
        props: {
          requestCode: r.code,
          workshopId: r.workshopId,
          amountPaise: payment.amountPaise,
          via: 'online',
          method: fact.method ?? 'unknown',
        },
      });
      return { outcome: 'paid' };
    }
  }

  // Late capture: the bill was settled another way or the request was cancelled. The payment is recorded as captured
  // (the money is real) and a refund is requested, once; the bill is never settled a second time.
  const [other] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.billId, billId),
        inArray(payments.status, PAID_LIKE as string[]),
        ne(payments.id, payment.id),
      ),
    )
    .limit(1);
  if (other) {
    await flagForRefund(tx, fact, r.code);
    return { outcome: 'needs_refund' };
  }
  await move();
  await flagForRefund(tx, fact, r.code);
  const cancelled = r.status === 'cancelled';
  await requestRefundForServiceBill(tx, {
    billId,
    paymentId: payment.id,
    source: cancelled ? 'service_cancelled' : 'duplicate_payment',
  });
  await recordServerEvent(tx, 'service_bill_late_capture', {
    userId: r.userId,
    cityId: r.cityId,
    props: {
      requestCode: r.code,
      amountPaise: payment.amountPaise,
      reason: cancelled ? 'cancelled' : 'settled',
    },
  });
  return { outcome: 'needs_refund' };
}

/** Audit a captured payment that must be refunded (once per Razorpay payment id). */
async function flagForRefund(tx: Tx, fact: RazorpayPaymentFact, requestCode: string): Promise<void> {
  const [seen] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, 'payment.captured_needs_refund'),
        eq(auditLog.entityId, fact.providerOrderId),
        sql`${auditLog.after} ->> 'providerPaymentId' = ${fact.providerPaymentId}`,
      ),
    )
    .limit(1);
  if (seen) return;
  await tx.insert(auditLog).values({
    actorUserId: null,
    actorRole: 'system',
    action: 'payment.captured_needs_refund',
    entity: 'payment',
    entityId: fact.providerOrderId,
    after: { providerPaymentId: fact.providerPaymentId, amountPaise: fact.amountPaise, requestCode },
  });
}
