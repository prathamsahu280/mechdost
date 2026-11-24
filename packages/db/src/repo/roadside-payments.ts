import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { RsaPaymentPurpose } from '@mechdost/shared/rsa';
import { paymentMachine, type PaymentStatus } from '@mechdost/shared/state';
import { auditLog, payments, rsaRequests } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { PaymentOutcome, RazorpayPaymentFact } from './payments';
import { queueStaffNotice } from './notices';
import { requestRefundForRsa } from './refunds';
import { paiseText, queueRsaEmail } from './roadside-messages';
import { finishRsa } from './roadside-job';
import { lockRsa, transitionRsa } from './roadside-core';

/**
 * Online payment of a roadside request (spec 22, razorpay-payments skill): the advance at booking (purpose
 * `rsa_advance`) and the balance after the work (`rsa_balance`), on the same `payments` table and webhook as orders and
 * service bills. The amount of an order is ALWAYS read here from the request's snapshot (`advance_paise`) or its bill
 * (`balance_paise`), never from the client and never from the live setting. One open and one captured payment per
 * request and purpose (partial unique indexes). A capture is applied under the request row lock: the advance makes the
 * request live (`awaiting_payment` -> `requested`), the balance completes it (`billed` -> `completed`); a capture that
 * finds the request cancelled, expired or already settled (cash) is recorded and ONE refund request is raised.
 */
const OPEN: readonly PaymentStatus[] = ['created', 'attempted', 'failed'];
const PAID_LIKE: readonly string[] = ['paid', 'partially_refunded', 'refunded'];

export interface RsaPaymentRow {
  id: string;
  requestId: string;
  providerOrderId: string;
  amountPaise: number;
  status: string;
  purpose: RsaPaymentPurpose;
}

const columns = {
  id: payments.id,
  providerOrderId: payments.providerOrderId,
  amountPaise: payments.amountPaise,
  status: payments.status,
  purpose: payments.purpose,
};

const row = (
  r: { id: string; providerOrderId: string; amountPaise: number; status: string; purpose: string },
  requestId: string,
): RsaPaymentRow => ({
  ...r,
  requestId,
  purpose: r.purpose as RsaPaymentPurpose,
});

/** A customer's own request with something to pay now (404 for anyone else's, 409 when nothing is payable). */
export async function payableRsaOfUser(
  db: Tx,
  input: { userId: string; code: string; purpose: RsaPaymentPurpose },
): Promise<{ requestId: string; requestCode: string; amountPaise: number }> {
  const [q] = await db
    .select({
      id: rsaRequests.id,
      code: rsaRequests.code,
      status: rsaRequests.status,
      advancePaise: rsaRequests.advancePaise,
      balancePaise: rsaRequests.balancePaise,
    })
    .from(rsaRequests)
    .where(and(eq(rsaRequests.code, input.code), eq(rsaRequests.userId, input.userId)))
    .limit(1);
  if (!q) throw new NotFoundError('Roadside request not found');
  const advance = input.purpose === 'rsa_advance';
  const amountPaise = advance ? q.advancePaise : (q.balancePaise ?? 0);
  if (q.status !== (advance ? 'awaiting_payment' : 'billed') || amountPaise <= 0)
    throw new ConflictError('There is nothing to pay on this request now', 'RSA_NOT_PAYABLE');
  return { requestId: q.id, requestCode: q.code, amountPaise };
}

/** The Razorpay order of a request and purpose that can still be paid, or null (a retry or a double click reuses it). */
export async function openPaymentForRsa(
  db: Tx,
  requestId: string,
  purpose: RsaPaymentPurpose,
): Promise<RsaPaymentRow | null> {
  const [r] = await db
    .select(columns)
    .from(payments)
    .where(
      and(
        eq(payments.rsaRequestId, requestId),
        eq(payments.purpose, purpose),
        inArray(payments.status, [...OPEN]),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return r ? row(r, requestId) : null;
}

/**
 * Store the Razorpay order before the client sees it. The request row is locked (the same lock a cash mark, a capture
 * and a cancel take) and the amount is compared with the snapshot again: a changed bill gives `PAYABLE_CHANGED`. Two
 * overlapping clicks: the unique open-order index lets the first stored order win and the second gets it back.
 */
export async function recordRsaRazorpayOrder(
  db: Tx,
  input: { requestId: string; purpose: RsaPaymentPurpose; providerOrderId: string; amountPaise: number },
): Promise<RsaPaymentRow> {
  return db.transaction(async (tx) => {
    const r = await lockRsa(tx, eq(rsaRequests.id, input.requestId));
    const advance = input.purpose === 'rsa_advance';
    const expected = advance ? r.advancePaise : (r.balancePaise ?? 0);
    if (r.status !== (advance ? 'awaiting_payment' : 'billed') || expected <= 0)
      throw new ConflictError('There is nothing to pay on this request now', 'RSA_NOT_PAYABLE');
    if (expected !== input.amountPaise)
      throw new ConflictError('The amount to pay changed', 'PAYABLE_CHANGED');
    const [stored] = await tx
      .insert(payments)
      .values({
        purpose: input.purpose,
        rsaRequestId: input.requestId,
        groupId: null,
        providerOrderId: input.providerOrderId,
        amountPaise: input.amountPaise,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (stored) return row(stored, input.requestId);
    const open = await openPaymentForRsa(tx, input.requestId, input.purpose);
    if (!open) throw new ConflictError('There is nothing to pay on this request now', 'RSA_NOT_PAYABLE');
    return open;
  });
}

/** The payment behind a Razorpay order of a roadside request, only for the customer who owns the request. */
export async function paymentOfUserRsa(
  db: Tx,
  input: { userId: string; providerOrderId: string },
): Promise<RsaPaymentRow & { requestCode: string }> {
  const [r] = await db
    .select({ ...columns, requestId: rsaRequests.id, requestCode: rsaRequests.code })
    .from(payments)
    .innerJoin(rsaRequests, eq(rsaRequests.id, payments.rsaRequestId))
    .where(and(eq(payments.providerOrderId, input.providerOrderId), eq(rsaRequests.userId, input.userId)))
    .limit(1);
  if (!r) throw new NotFoundError('Payment not found');
  return { ...row(r, r.requestId), requestCode: r.requestCode };
}

const TARGET: Record<RazorpayPaymentFact['status'], 'paid' | 'attempted' | 'failed'> = {
  captured: 'paid',
  authorized: 'attempted',
  failed: 'failed',
};

/**
 * Apply one Razorpay payment fact to a roadside payment (called by `applyRazorpayPayment` in its transaction). Locks
 * request -> payment; amount and currency must match what we asked for and the request's snapshot (else an audited
 * `mismatch`); the payment status only moves forward through `paymentMachine`.
 */
export async function applyRsaPayment(
  tx: Tx,
  fact: RazorpayPaymentFact,
  requestId: string,
): Promise<{ outcome: PaymentOutcome }> {
  const r = await lockRsa(tx, eq(rsaRequests.id, requestId));
  const [payment] = await tx
    .select({ ...columns, providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(eq(payments.providerOrderId, fact.providerOrderId))
    .for('update');
  if (!payment) return { outcome: 'unknown_order' };
  const advance = payment.purpose === 'rsa_advance';
  const expected = advance ? r.advancePaise : (r.balancePaise ?? 0);

  if (
    fact.amountPaise !== payment.amountPaise ||
    fact.currency !== 'INR' ||
    payment.amountPaise !== expected
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
  if (PAID_LIKE.includes(from)) {
    if (to !== 'paid' || payment.providerPaymentId === fact.providerPaymentId)
      return { outcome: 'unchanged' };
    await flagForRefund(tx, fact, r.code);
    await alertFinanceOfExtraPayment(tx, r, payment.id, fact);
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
  const audit = (action: string) =>
    tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action,
      entity: 'payment',
      entityId: payment.id,
      after: { providerPaymentId: fact.providerPaymentId, method: fact.method, from },
    });

  if (to !== 'paid') {
    await move();
    await audit(`payment.${to}`);
    return { outcome: to };
  }

  // Captured. The request decides whether this money is what it was waiting for.
  const waiting = advance ? r.status === 'awaiting_payment' : r.status === 'billed';
  if (waiting) {
    await move();
    await audit('payment.paid');
    if (advance) {
      const live = await transitionRsa(tx, {
        request: r,
        to: 'requested',
        expectedVersion: r.version,
        actor: { type: 'system', userId: null },
        patch: { advancePaidAt: new Date() },
        payload: { amountPaise: payment.amountPaise, method: fact.method ?? 'unknown' },
      });
      await queueRsaEmail(tx, {
        template: 'rsa_received',
        requestId: r.id,
        userId: r.userId,
        version: live.version,
        payload: () => ({ requestCode: r.code, amount: paiseText(payment.amountPaise) }),
      });
      await recordServerEvent(tx, 'rsa_fee_paid', {
        userId: r.userId,
        cityId: r.cityId,
        props: { requestCode: r.code, amountPaise: payment.amountPaise, method: fact.method ?? 'unknown' },
      });
    } else {
      await finishRsa(tx, r, { method: 'online', actor: { type: 'system', userId: null } });
    }
    return { outcome: 'paid' };
  }

  // Late capture: the request was cancelled or expired, or the bill was settled another way (cash). The money is real:
  // record the payment as captured and raise ONE refund request for it (idempotent per payment).
  const [other] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.rsaRequestId, requestId),
        eq(payments.purpose, payment.purpose),
        inArray(payments.status, PAID_LIKE as string[]),
        ne(payments.id, payment.id),
      ),
    )
    .limit(1);
  if (other) {
    await flagForRefund(tx, fact, r.code);
    await alertFinanceOfExtraPayment(tx, r, payment.id, fact);
    return { outcome: 'needs_refund' };
  }
  await move();
  await flagForRefund(tx, fact, r.code);
  const closed = r.status === 'cancelled';
  await requestRefundForRsa(tx, {
    requestId,
    paymentId: payment.id,
    source: closed ? 'payment_after_close' : 'duplicate_payment',
  });
  await recordServerEvent(tx, 'rsa_late_capture', {
    userId: r.userId,
    cityId: r.cityId,
    props: {
      requestCode: r.code,
      amountPaise: payment.amountPaise,
      reason: closed ? 'cancelled' : 'settled',
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

/**
 * A second captured payment for a request and purpose that is already paid. The payments table allows one captured
 * payment per request and purpose (a unique index), so the extra one cannot be recorded and cannot be refunded through
 * the ledger: finance gets a bell notice (once per Razorpay payment) to refund it in the Razorpay dashboard.
 */
async function alertFinanceOfExtraPayment(
  tx: Tx,
  r: { cityId: string },
  paymentId: string,
  fact: RazorpayPaymentFact,
): Promise<void> {
  await queueStaffNotice(tx, {
    kind: 'staff.refund_alert',
    cityId: r.cityId,
    entityId: paymentId,
    version: fact.providerPaymentId,
  });
}
