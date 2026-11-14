import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { paymentMachine, type PaymentStatus } from '@mechdost/shared/state';
import { auditLog, orderGroups, orders, payments, reservations, webhookEvents } from '../schema';
import { CHECKOUT_SETTINGS, settingOr } from './checkout';
import { cancelInTx } from './customer-orders';
import { ConflictError, NotFoundError } from './errors';
import { queueOrderPlacedEmail, queuePaymentReceivedEmail } from './email-events';
import { recordServerEvent } from './events';
import { rowsOf } from './sql-rows';
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

/**
 * A customer's own online order group by its code (404 for anyone else or a COD order). `payablePaise`: the
 * sub-orders still live; a part cancelled before paying is not charged (final review 2026-11-12, finding 3).
 */
export async function onlineGroupOfUser(
  db: Tx,
  input: { userId: string; groupCode: string },
): Promise<{ id: string; code: string; totalPaise: number; payablePaise: number; paymentStatus: string }> {
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
  return { ...g, payablePaise: await payableOf(db, g.id) };
}

/**
 * Store the Razorpay order before the client sees it. A group has one open Razorpay order
 * (`payments_one_open_per_group_uq`): when two place calls overlap, the second gets the first one's order and its
 * own Razorpay order is never shown, so it cannot be paid (final review 2026-11-12, finding 2).
 * The group row is locked (the same lock a part cancel takes in `settleGroupPayment`) and the amount still payable
 * is checked again: a part cancelled while Razorpay was creating the order gives `PAYABLE_CHANGED`, never a stored
 * order for the old total (security review 2026-11-12).
 */
export async function recordRazorpayOrder(
  db: Tx,
  input: { groupId: string; providerOrderId: string; amountPaise: number },
): Promise<PaymentRow> {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({ status: orderGroups.paymentStatus })
      .from(orderGroups)
      .where(eq(orderGroups.id, input.groupId))
      .for('update');
    if (!group || !OPEN.includes(group.status as PaymentStatus))
      throw new ConflictError('The order cannot be paid any more', 'PAYMENT_CLOSED');
    if ((await payableOf(tx, input.groupId)) !== input.amountPaise)
      throw new ConflictError('The amount to pay changed', 'PAYABLE_CHANGED');
    const [row] = await tx
      .insert(payments)
      .values({
        groupId: input.groupId,
        providerOrderId: input.providerOrderId,
        amountPaise: input.amountPaise,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (row) return row;
    const open = await openPaymentForGroup(tx, input.groupId);
    if (!open) throw new ConflictError('The order cannot be paid any more', 'PAYMENT_CLOSED');
    return open;
  });
}

/** What is still payable in a group: the sub-orders not cancelled or rejected. */
async function payableOf(db: Tx, groupId: string): Promise<number> {
  const [row] = await db
    .select({ payable: sql<string>`coalesce(sum(${orders.totalPaise}), 0)` })
    .from(orders)
    .where(and(eq(orders.groupId, groupId), sql`${orders.status} not in ('cancelled', 'rejected')`));
  return Number(row?.payable ?? 0);
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
      .select({ ...columns, providerPaymentId: payments.providerPaymentId })
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
    // A completed payment is final. The same payment again is a replay (unchanged); a different captured payment on
    // it is money taken twice and is flagged for a refund (security review, third pass).
    if (from === 'paid' || from === 'partially_refunded' || from === 'refunded') {
      if (to !== 'paid' || p.providerPaymentId === fact.providerPaymentId)
        return { outcome: 'unchanged' as const };
      await flagForRefund(tx, fact, p.groupCode);
      return { outcome: 'needs_refund' as const };
    }
    // The group was already paid through another Razorpay order: this is money taken twice (finding 2).
    if (to === 'paid' && ['paid', 'partially_refunded', 'refunded'].includes(p.paymentStatus)) {
      await flagForRefund(tx, fact, p.groupCode);
      return { outcome: 'needs_refund' as const };
    }
    // Captured money for an order that expired or was cancelled must not complete it: flag it for a refund.
    if (
      to === 'paid' &&
      (from === 'expired' || p.paymentStatus === 'expired' || !(await hasLiveOrder(tx, p.groupId)))
    ) {
      await flagForRefund(tx, fact, p.groupCode);
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
    // A paid order keeps its stock until staff route it: the short online hold becomes the COD hold (finding 1).
    if (to === 'paid') {
      const minutes = await settingOr(tx, p.cityId, CHECKOUT_SETTINGS.codReservationMinutes);
      const groupOrders = tx.select({ id: orders.id }).from(orders).where(eq(orders.groupId, p.groupId));
      await tx
        .update(reservations)
        .set({
          expiresAt: sql`greatest(${reservations.expiresAt}, now() + make_interval(mins => ${minutes}))`,
        })
        .where(and(eq(reservations.status, 'active'), inArray(reservations.orderId, groupOrders)));
    }
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
    if (to === 'paid') {
      // The receipt (billing) and the order confirmation of an online order, once each (dedupe) and only for a
      // committed capture: a replayed webhook returned above and a rolled-back one sends nothing.
      await queuePaymentReceivedEmail(tx, {
        paymentId: p.id,
        groupId: p.groupId,
        amountPaise: p.amountPaise,
        method: fact.method ?? null,
        providerPaymentId: fact.providerPaymentId,
      });
      await queueOrderPlacedEmail(tx, p.groupId);
    }
    return { outcome: to };
  });
}

/**
 * Online orders whose payment never completed within the window: their sub-orders are cancelled by the system
 * (reason `payment_not_completed`), the stock goes back on sale, and the group and its open payments expire.
 * The window is `checkout.online_payment_minutes` of the order's city (else global), the same value that set its
 * stock hold (final review 2026-11-12, finding 7). One group failing never stops the rest. Run by the worker.
 */
export async function expireUnpaidOnlineOrders(db: Tx): Promise<{ closed: number; failed: number }> {
  const key = CHECKOUT_SETTINGS.onlinePaymentMinutes.key;
  // Same choice as `settingOr`: the city row if there is one, else the global row; a value that is not a
  // non-negative integer falls back to the registry default. Deciding it in SQL means a batch holds only groups
  // that are due, so groups of a city with a long window never crowd out due ones (security review 2026-11-12).
  const valid = (v: SQL) =>
    sql`case when jsonb_typeof(${v}) = 'number' and (${v})::text ~ '^[0-9]{1,6}$' then ((${v})::text)::int end`;
  const due = rowsOf<{ id: string }>(
    await db.execute(sql`
      select g.id from order_groups g
      left join settings cs on cs.key = ${key} and cs.city_id = g.city_id
      left join settings gs on gs.key = ${key} and gs.city_id is null
      where g.payment_method = 'online'
        and g.payment_status in ('created', 'attempted', 'failed')
        and g.created_at < now() - make_interval(mins => coalesce(
          case when cs.id is not null then ${valid(sql`cs.value`)} else ${valid(sql`gs.value`)} end,
          ${CHECKOUT_SETTINGS.onlinePaymentMinutes.fallback}))
      order by g.created_at
      limit 100`),
  );
  let closed = 0;
  let failed = 0;
  for (const g of due) {
    try {
      if (await expireGroup(db, g.id)) closed += 1;
    } catch {
      failed += 1;
    }
  }
  return { closed, failed };
}

async function expireGroup(db: Tx, groupId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Order rows first (lock order), then the group: a capture racing this sees either state, never half.
    const subs = await tx
      .select({ id: orders.id, status: orders.status, version: orders.version })
      .from(orders)
      .where(eq(orders.groupId, groupId))
      .for('update');
    const [group] = await tx
      .update(orderGroups)
      .set({ paymentStatus: 'expired' })
      .where(and(eq(orderGroups.id, groupId), inArray(orderGroups.paymentStatus, [...OPEN])))
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
      .where(and(eq(payments.groupId, groupId), inArray(payments.status, [...OPEN])));
    return true;
  });
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

/** Audit a captured payment that must be refunded (once per Razorpay payment id). */
async function flagForRefund(tx: Tx, fact: RazorpayPaymentFact, groupCode: string): Promise<void> {
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
    after: { providerPaymentId: fact.providerPaymentId, amountPaise: fact.amountPaise, groupCode },
  });
}
