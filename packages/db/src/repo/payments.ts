import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { paymentMachine, type PaymentStatus } from '@mechdost/shared/state';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { auditLog, orderGroups, orders, payments, settings, webhookEvents } from '../schema';
import { cancelInTx } from './customer-orders';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Razorpay payments (plan 2026-11-12; razorpay-payments skill; research/data-integrity.md §4). One `payments` row
 * per Razorpay order. Payment facts — from the checkout callback (after an HMAC check and a server fetch) or from
 * a webhook — all go through `applyRazorpayPayment`: the amount and currency must match what we asked for, and the
 * state only moves forward through `paymentMachine`, so replays and out-of-order events change nothing.
 */

const OPEN: readonly PaymentStatus[] = ['created', 'attempted', 'failed'];

export interface PaymentRow {
  id: string;
  groupId: string;
  providerOrderId: string;
  amountPaise: number;
  status: string;
}

const columns = {
  id: payments.id,
  groupId: payments.groupId,
  providerOrderId: payments.providerOrderId,
  amountPaise: payments.amountPaise,
  status: payments.status,
};

/** The latest Razorpay order of a group that can still be paid, or null (a retry reuses it). */
export async function openPaymentForGroup(db: Tx, groupId: string): Promise<PaymentRow | null> {
  const [row] = await db
    .select(columns)
    .from(payments)
    .where(and(eq(payments.groupId, groupId), inArray(payments.status, [...OPEN])))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row ?? null;
}

/** A customer's own online order group by its code (404 for anyone else or a COD order). */
export async function onlineGroupOfUser(
  db: Tx,
  input: { userId: string; groupCode: string },
): Promise<{ id: string; code: string; totalPaise: number; paymentStatus: string }> {
  const [g] = await db
    .select({
      id: orderGroups.id,
      code: orderGroups.code,
      totalPaise: orderGroups.totalPaise,
      paymentStatus: orderGroups.paymentStatus,
    })
    .from(orderGroups)
    .where(
      and(
        eq(orderGroups.code, input.groupCode),
        eq(orderGroups.userId, input.userId),
        eq(orderGroups.paymentMethod, 'online'),
      ),
    )
    .limit(1);
  if (!g) throw new NotFoundError('Order not found');
  return g;
}

/** Store the Razorpay order before the client sees it (unique provider order id). */
export async function recordRazorpayOrder(
  db: Tx,
  input: { groupId: string; providerOrderId: string; amountPaise: number },
): Promise<PaymentRow> {
  const [row] = await db
    .insert(payments)
    .values({
      groupId: input.groupId,
      providerOrderId: input.providerOrderId,
      amountPaise: input.amountPaise,
    })
    .returning(columns);
  if (!row) throw new Error('payment insert returned no row');
  return row;
}

/** The payment behind a Razorpay order, only for the customer who placed it (404 otherwise). */
export async function paymentOfUserGroup(
  db: Tx,
  input: { userId: string; providerOrderId: string },
): Promise<PaymentRow & { groupCode: string; paymentStatus: string }> {
  const [row] = await db
    .select({ ...columns, groupCode: orderGroups.code, paymentStatus: orderGroups.paymentStatus })
    .from(payments)
    .innerJoin(orderGroups, eq(orderGroups.id, payments.groupId))
    .where(and(eq(payments.providerOrderId, input.providerOrderId), eq(orderGroups.userId, input.userId)))
    .limit(1);
  if (!row) throw new NotFoundError('Payment not found');
  return row;
}

export interface RazorpayPaymentFact {
  providerOrderId: string;
  providerPaymentId: string;
  /** Razorpay payment status: `captured` = money taken; `authorized` = not captured yet; `failed`. */
  status: 'captured' | 'authorized' | 'failed';
  amountPaise: number;
  currency: string;
  method: string | null;
}

export type PaymentOutcome =
  | 'paid'
  | 'attempted'
  | 'failed'
  | 'unchanged'
  | 'mismatch'
  | 'unknown_order'
  /** Money was captured for an order that has expired or was cancelled: audited for a refund (spec 05). */
  | 'needs_refund';

const TARGET: Record<RazorpayPaymentFact['status'], 'paid' | 'attempted' | 'failed'> = {
  captured: 'paid',
  authorized: 'attempted',
  failed: 'failed',
};

/** Apply one payment fact. Locks the payment row; amount and currency must match; monotonic; audited. */
export async function applyRazorpayPayment(
  db: Tx,
  fact: RazorpayPaymentFact,
): Promise<{ outcome: PaymentOutcome }> {
  return db.transaction(async (tx) => {
    // Lock order: group row, then the payment row (the expiry job takes orders → group → payments; security review).
    const [ref] = await tx
      .select({ groupId: payments.groupId })
      .from(payments)
      .where(eq(payments.providerOrderId, fact.providerOrderId))
      .limit(1);
    if (!ref) return { outcome: 'unknown_order' as const };
    const [group] = await tx
      .select({
        cityId: orderGroups.cityId,
        userId: orderGroups.userId,
        groupCode: orderGroups.code,
        paymentStatus: orderGroups.paymentStatus,
      })
      .from(orderGroups)
      .where(eq(orderGroups.id, ref.groupId))
      .for('update');
    const [payment] = await tx
      .select(columns)
      .from(payments)
      .where(eq(payments.providerOrderId, fact.providerOrderId))
      .for('update');
    if (!group || !payment) return { outcome: 'unknown_order' as const };
    const p = { ...payment, ...group };

    if (fact.amountPaise !== p.amountPaise || fact.currency !== 'INR') {
      await tx.insert(auditLog).values({
        actorUserId: null,
        actorRole: 'system',
        action: 'payment.amount_mismatch',
        entity: 'payment',
        entityId: fact.providerOrderId,
        after: { expectedPaise: p.amountPaise, gotPaise: fact.amountPaise, currency: fact.currency },
      });
      return { outcome: 'mismatch' as const };
    }

    const to = TARGET[fact.status];
    const from = p.status as PaymentStatus;
    // Captured money for an order that expired or was cancelled must not complete it: flag it for a refund.
    if (
      to === 'paid' &&
      (from === 'expired' || p.paymentStatus === 'expired' || !(await hasLiveOrder(tx, p.groupId)))
    ) {
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
      if (!seen)
        await tx.insert(auditLog).values({
          actorUserId: null,
          actorRole: 'system',
          action: 'payment.captured_needs_refund',
          entity: 'payment',
          entityId: fact.providerOrderId,
          after: {
            providerPaymentId: fact.providerPaymentId,
            amountPaise: fact.amountPaise,
            groupCode: p.groupCode,
          },
        });
      return { outcome: 'needs_refund' as const };
    }
    if (from === to || !paymentMachine.canActor(from, to, 'system')) return { outcome: 'unchanged' as const };

    // Conditional on the status read under the lock (the version trigger bumps `version`).
    await tx
      .update(payments)
      .set({
        status: to,
        providerPaymentId: fact.providerPaymentId,
        method: fact.method,
        ...(to === 'paid' ? { capturedAt: sql`now()` } : {}),
      })
      .where(and(eq(payments.id, p.id), eq(payments.status, from)));
    // The group shows the latest attempt, but never goes back from paid.
    await tx
      .update(orderGroups)
      .set({ paymentStatus: to })
      .where(and(eq(orderGroups.id, p.groupId), sql`${orderGroups.paymentStatus} <> 'paid'`));
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'system',
      action: `payment.${to}`,
      entity: 'payment',
      entityId: p.id,
      after: { providerPaymentId: fact.providerPaymentId, method: fact.method, from },
    });
    if (to === 'paid' || to === 'failed')
      await recordServerEvent(tx, to === 'paid' ? 'payment_captured' : 'payment_failed', {
        userId: p.userId,
        cityId: p.cityId,
        props: { orderCode: p.groupCode, amountPaise: p.amountPaise, method: fact.method ?? 'unknown' },
      });
    return { outcome: to };
  });
}

/**
 * Online orders whose payment never completed within the window: their sub-orders are cancelled by the system
 * (reason `payment_not_completed`), the stock goes back on sale, and the group and its open payments expire.
 * Returns the number of groups closed. Run by the worker every minute.
 */
export async function expireUnpaidOnlineOrders(db: Tx, input: { olderThanMinutes: number }): Promise<number> {
  const due = await db
    .select({ id: orderGroups.id })
    .from(orderGroups)
    .where(
      and(
        eq(orderGroups.paymentMethod, 'online'),
        inArray(orderGroups.paymentStatus, [...OPEN]),
        lt(orderGroups.createdAt, sql`now() - make_interval(mins => ${input.olderThanMinutes})`),
      ),
    )
    .limit(100);
  let closed = 0;
  for (const g of due) {
    const done = await db.transaction(async (tx) => {
      // Order rows first (lock order), then the group: a capture racing this sees either state, never half.
      const subs = await tx
        .select({ id: orders.id, status: orders.status, version: orders.version })
        .from(orders)
        .where(eq(orders.groupId, g.id))
        .for('update');
      const [group] = await tx
        .update(orderGroups)
        .set({ paymentStatus: 'expired' })
        .where(and(eq(orderGroups.id, g.id), inArray(orderGroups.paymentStatus, [...OPEN])))
        .returning({ id: orderGroups.id });
      if (!group) return false; // paid meanwhile
      for (const o of subs.filter((x) => x.status === 'placed'))
        await cancelInTx(tx, {
          order: { id: o.id, status: 'placed' },
          expectedVersion: o.version,
          reasonCode: 'payment_not_completed',
          actor: { type: 'system' },
        });
      await tx
        .update(payments)
        .set({ status: 'expired' })
        .where(and(eq(payments.groupId, g.id), inArray(payments.status, [...OPEN])));
      return true;
    });
    if (done) closed += 1;
  }
  return closed;
}

/** Minutes an online payment may take (admin setting `checkout.online_payment_minutes`, global value). */
export async function onlinePaymentMinutes(db: Tx): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'checkout.online_payment_minutes'), isNull(settings.cityId)))
    .limit(1);
  const v = row?.value;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0
    ? v
    : OPERATIONAL_SETTINGS['checkout.online_payment_minutes'].default;
}

/** Is any sub-order of the group still live (not cancelled or rejected)? */
async function hasLiveOrder(tx: Tx, groupId: string): Promise<boolean> {
  const live = await tx.$count(
    orders,
    and(eq(orders.groupId, groupId), sql`${orders.status} not in ('cancelled', 'rejected')`),
  );
  return live > 0;
}

/**
 * A webhook event is recorded together with its payment fact (one transaction): if applying fails, the event is
 * not marked as seen, so Razorpay's retry can still apply it (security review 2026-11-12).
 */
export async function recordAndApplyRazorpayEvent(
  db: Tx,
  input: {
    eventId: string;
    type: string;
    payload: Record<string, unknown>;
    fact: RazorpayPaymentFact | null;
  },
): Promise<{ fresh: boolean; outcome: PaymentOutcome | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(webhookEvents)
      .values({
        id: input.eventId,
        provider: 'razorpay',
        type: input.type,
        payload: input.payload,
        status: 'processed',
        processedAt: new Date(),
      })
      .onConflictDoNothing({ target: webhookEvents.id })
      .returning({ id: webhookEvents.id });
    if (!row) return { fresh: false, outcome: null };
    if (!input.fact) return { fresh: true, outcome: null };
    const { outcome } = await applyRazorpayPayment(tx, input.fact);
    return { fresh: true, outcome };
  });
}
