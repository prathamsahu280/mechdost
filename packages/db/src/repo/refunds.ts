import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { formatINR } from '@mechdost/shared/money';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import {
  customerRefundStatus,
  type AdminRefund,
  type AdminRefundPage,
  type AdminRefundView,
  type CustomerRefund,
  type RefundDestinationInput,
  RefundDestination,
} from '@mechdost/shared/refunds-api';
import {
  REFUND_HOLDING_STATES,
  paymentMachine,
  refundMachine,
  type PaymentStatus,
  type RefundReason,
  type RefundRejectReason,
  type RefundSettleOutcome,
  type RefundSettleReason,
  type RefundSource,
  type RefundStatus,
} from '@mechdost/shared/state';
import { decryptField, encryptField, type Keyring } from '../crypto';
import {
  auditLog,
  orderGroups,
  orders,
  payments,
  refundEvents,
  refunds,
  serviceBills,
  serviceRequests,
  webhookEvents,
} from '../schema';
import { cancelPendingOrderRewards } from './coins';
import { releaseCouponIfOrderRefunded } from './coupons';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { issueCreditNoteForRefund } from './credit-notes';
import { queueRefundEmail } from './email-notifications';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { rowsOf } from './sql-rows';

/**
 * Refunds for prepaid orders (spec 05; decision 2026-11-15 "All need approval"; razorpay-payments skill).
 *
 * Every refund is a **request** (`requested`) that waits for a staff member with `refunds:approve`; only an approved
 * refund is sent to Razorpay. The amount is held on the payment (`refund_reserved_paise`, CHECK ≤ captured) at request
 * time, so two requests can never promise the same money. A request made by a staff member cannot be approved by that
 * member (four-eyes, also a CHECK). Sending is idempotent: `idem_key` is Razorpay's `X-Refund-Idempotency` header, and
 * the claim (`claimRefundDispatch`) lets one sender at a time work on a refund.
 *
 * Lock order (spec 14 rule 10): order → group → payment → refund. Approving touches only the refund row.
 * Notifications go through the outbox in the same transaction; events are append-only (`refund_events`) beside
 * `audit_log`. Staff reach only refunds of orders in their cities (404 otherwise); customers see only their own.
 */
export const REFUND_DISPATCH_MAX_ATTEMPTS = 8;
const PAID_LIKE: readonly string[] = ['paid', 'partially_refunded'];
const SLA = OPERATIONAL_SETTINGS['refunds.approval_sla_hours'];

/** AAD of the encrypted payout destination (`table.column`, like every encrypted column). */
const DESTINATION_AAD = 'refunds.destination_enc';

interface EventActor {
  type: 'admin' | 'system';
  id: string | null;
}
const sysActor = { type: 'system' as const, id: null };

// ── internals ─────────────────────────────────────────────────────────────────────────────────────────────────

async function recordRefundEvent(
  tx: Tx,
  input: {
    refund: { id: string };
    kind:
      | 'requested'
      | 'approved'
      | 'rejected'
      | 'initiated'
      | 'processed'
      | 'failed'
      | 'retry'
      | 'needs_reconciliation';
    from: RefundStatus | null;
    to: RefundStatus;
    actor: EventActor;
    payload?: Record<string, string | number | null>;
  },
): Promise<void> {
  await tx.insert(refundEvents).values({
    refundId: input.refund.id,
    kind: input.kind,
    fromStatus: input.from,
    toStatus: input.to,
    actorType: input.actor.type,
    actorId: input.actor.id,
    payload: input.payload ?? {},
  });
  await tx.insert(auditLog).values({
    actorUserId: input.actor.id,
    actorRole: input.actor.type === 'admin' ? 'staff' : 'system',
    action: `refund.${input.kind}`,
    entity: 'refund',
    entityId: input.refund.id,
    after: { from: input.from, to: input.to, ...input.payload },
  });
}

/** Group row, then payment row (lock order). Returns the payment as it is under the lock. */
async function lockLedger(tx: Tx, paymentId: string) {
  const [ref] = await tx
    .select({ groupId: payments.groupId, billId: payments.billId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!ref) throw new NotFoundError('Payment not found');
  if (ref.groupId)
    await tx
      .select({ id: orderGroups.id })
      .from(orderGroups)
      .where(eq(orderGroups.id, ref.groupId))
      .for('update');
  else if (ref.billId) {
    // A service bill: the request row first (spec 14 lock order request -> bill -> payment), then the bill.
    const [bill] = await tx
      .select({ requestId: serviceBills.requestId })
      .from(serviceBills)
      .where(eq(serviceBills.id, ref.billId))
      .limit(1);
    if (bill)
      await tx
        .select({ id: serviceRequests.id })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, bill.requestId))
        .for('update');
    await tx
      .select({ id: serviceBills.id })
      .from(serviceBills)
      .where(eq(serviceBills.id, ref.billId))
      .for('update');
  }
  const [p] = await tx
    .select({
      id: payments.id,
      groupId: payments.groupId,
      status: payments.status,
      amountPaise: payments.amountPaise,
      providerPaymentId: payments.providerPaymentId,
      reserved: payments.refundReservedPaise,
      refunded: payments.refundedPaise,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .for('update');
  if (!p) throw new NotFoundError('Payment not found');
  return p;
}

async function heldForOrder(tx: Tx, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ held: sql<string>`coalesce(sum(${refunds.amountPaise}), 0)` })
    .from(refunds)
    .where(and(eq(refunds.orderId, orderId), inArray(refunds.status, [...REFUND_HOLDING_STATES])));
  return Number(row?.held ?? 0);
}

async function releaseReservation(tx: Tx, paymentId: string, amountPaise: number): Promise<void> {
  const rows = await tx
    .update(payments)
    .set({ refundReservedPaise: sql`${payments.refundReservedPaise} - ${amountPaise}` })
    .where(and(eq(payments.id, paymentId), sql`${payments.refundReservedPaise} >= ${amountPaise}`))
    .returning({ id: payments.id });
  if (rows.length === 0) throw new ConflictError('The refund ledger is out of step', 'LEDGER_MISMATCH');
}

interface NewRefund {
  /** The locked payment ledger for a Razorpay refund; null for a cash-on-delivery refund paid by hand. */
  payment: { id: string } | null;
  /** The checkout (order refunds), or null with `billId` set (service bill refunds): exactly one (CHECK). */
  groupId: string | null;
  billId?: string | null;
  destinationEnc?: string | null;
  /** `id` is null for a service bill refund; `code` is then the request code. */
  order: { id: string | null; code: string; cityId: string; userId: string };
  amountPaise: number;
  source: RefundSource;
  reasonCode: RefundReason;
  note: string | null;
  requestedBy: string | null;
  idemKey: string;
}

/** Insert the request and hold its amount on the payment (the payment row is already locked by the caller). */
async function insertRequest(tx: Tx, input: NewRefund): Promise<{ id: string; fresh: boolean }> {
  const [row] = await tx
    .insert(refunds)
    .values({
      paymentId: input.payment?.id ?? null,
      groupId: input.groupId,
      billId: input.billId ?? null,
      mode: input.payment ? 'source' : 'bank_upi',
      destinationEnc: input.destinationEnc ?? null,
      orderId: input.order.id,
      amountPaise: input.amountPaise,
      source: input.source,
      reasonCode: input.reasonCode,
      note: input.note,
      requestedBy: input.requestedBy,
      idemKey: input.idemKey,
    })
    .onConflictDoNothing({ target: refunds.idemKey })
    .returning({ id: refunds.id });
  if (!row) {
    const [existing] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.idemKey, input.idemKey))
      .limit(1);
    if (!existing) throw new ConflictError('Refund request could not be stored', 'REFUND_NOT_STORED');
    return { id: existing.id, fresh: false };
  }
  if (input.payment) {
    const held = await tx
      .update(payments)
      .set({ refundReservedPaise: sql`${payments.refundReservedPaise} + ${input.amountPaise}` })
      .where(
        and(
          eq(payments.id, input.payment.id),
          sql`${payments.refundReservedPaise} + ${input.amountPaise} <= ${payments.amountPaise}`,
        ),
      )
      .returning({ id: payments.id });
    if (held.length === 0)
      throw new ConflictError('The refund is more than the payment still holds', 'REFUND_EXCEEDS_PAYMENT');
  }
  const by = input.requestedBy ? ('staff' as const) : ('system' as const);
  await recordRefundEvent(tx, {
    refund: row,
    kind: 'requested',
    from: null,
    to: 'requested',
    actor: input.requestedBy ? { type: 'admin', id: input.requestedBy } : sysActor,
    payload: { amountPaise: input.amountPaise, source: input.source, reasonCode: input.reasonCode },
  });
  await recordServerEvent(tx, 'refund_requested', {
    userId: input.requestedBy,
    cityId: input.order.cityId,
    props: {
      refundId: row.id,
      orderCode: input.order.code,
      amountPaise: input.amountPaise,
      source: input.source,
      reasonCode: input.reasonCode,
      by,
    },
  });
  await notifyCustomer(tx, {
    refundId: row.id,
    userId: input.order.userId,
    event: 'requested',
    orderCode: input.order.code,
    amountPaise: input.amountPaise,
  });
  return { id: row.id, fresh: true };
}

/**
 * Customer email through the outbox (spec 10). Only three moments are worth a message: asked (we are looking at it),
 * processed (the bank takes 5–7 working days) and declined. Never "refunded" or "instant" before Razorpay confirms.
 */
async function notifyCustomer(
  tx: Tx,
  input: {
    refundId: string;
    userId: string;
    event: 'requested' | 'processed' | 'declined';
    orderCode: string;
    amountPaise: number;
  },
): Promise<void> {
  // The shared email system (merge 2026-11-15): catalogue template, verified-email rule, language, dedupe. Each step
  // happens once per refund, so the step itself is the version. The customer sees the order (group) code.
  const orderCode = input.orderCode.replace(/-\d{1,2}$/, '');
  await queueRefundEmail(tx, {
    template: `refund_${input.event}`,
    refundId: input.refundId,
    refundVersion: 1,
    userId: input.userId,
    orderCode,
    amount: formatINR(input.amountPaise),
  });
}

// ── requests ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A sub-order was cancelled or rejected (`transitionOrder`, same transaction, order row already locked): when its
 * group was paid online, ask for what the customer paid for it that is not already being refunded. It still waits for
 * an approval. Returns the new refund id, or null when there is nothing to refund (COD, unpaid, already covered).
 */
export async function requestRefundForClosedOrder(
  tx: Tx,
  orderId: string,
  opts: { lateCapture?: boolean } = {},
): Promise<string | null> {
  const [o] = await tx
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      groupId: orders.groupId,
      cityId: orders.cityId,
      userId: orders.userId,
      totalPaise: orders.totalPaise,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!o || (o.status !== 'cancelled' && o.status !== 'rejected')) return null;
  const [group] = await tx
    .select({ method: orderGroups.paymentMethod })
    .from(orderGroups)
    .where(eq(orderGroups.id, o.groupId))
    .for('update');
  if (group?.method !== 'online') return null;
  const [paid] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.groupId, o.groupId), inArray(payments.status, [...PAID_LIKE])))
    .limit(1);
  if (!paid) return null;
  const payment = await lockLedger(tx, paid.id);
  const amount = o.totalPaise - (await heldForOrder(tx, o.id));
  if (amount <= 0) return null;
  // A capture after the payment window closed is its own source, so finance sees why money arrived for a dead order.
  const source: RefundSource = opts.lateCapture
    ? 'payment_after_close'
    : o.status === 'rejected'
      ? 'order_rejected'
      : 'order_cancelled';
  const made = await insertRequest(tx, {
    payment,
    groupId: o.groupId,
    order: o,
    amountPaise: amount,
    source,
    reasonCode: source,
    note: null,
    requestedBy: null,
    idemKey: opts.lateCapture ? `sys_late_${o.id}` : `sys_${o.id}`,
  });
  if (made.fresh && opts.lateCapture)
    await recordServerEvent(tx, 'refund_requested_after_close', {
      userId: o.userId,
      cityId: o.cityId,
      props: { refundId: made.id, paymentId: payment.id, amountPaise: amount },
    });
  return made.fresh ? made.id : null;
}

/** Staff ask for a refund (a support claim, a part refund, an order that could not be fulfilled). Idempotent per key. */
export async function createStaffRefund(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    orderCode: string;
    amountPaise: number;
    source: RefundSource;
    reasonCode: RefundReason;
    note?: string | undefined;
    /** Cash on delivery only: where finance pays by hand. Encrypted with `keyring` before it is stored. */
    destination?: RefundDestinationInput | undefined;
    keyring?: Keyring | undefined;
    idempotencyKey: string;
  },
): Promise<{ refund: AdminRefund; replay: boolean }> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0)
    throw new ValidationError('Invalid refund amount', 'REFUND_AMOUNT');
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({
        id: orders.id,
        code: orders.code,
        status: orders.status,
        groupId: orders.groupId,
        cityId: orders.cityId,
        userId: orders.userId,
        totalPaise: orders.totalPaise,
      })
      .from(orders)
      .where(eq(orders.code, input.orderCode))
      .for('update');
    if (!o || (!input.scope.all && !input.scope.cityIds.includes(o.cityId)))
      throw new NotFoundError('Order not found');
    const [group] = await tx
      .select({ method: orderGroups.paymentMethod })
      .from(orderGroups)
      .where(eq(orderGroups.id, o.groupId))
      .for('update');
    if (!group) throw new NotFoundError('Order not found');
    let payment: { id: string } | null = null;
    let destinationEnc: string | null = null;
    if (group.method === 'online') {
      if (input.destination)
        throw new ValidationError(
          'An order paid online is refunded to its payment method',
          'REFUND_DESTINATION',
        );
      const [paid] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.groupId, o.groupId), inArray(payments.status, [...PAID_LIKE])))
        .limit(1);
      if (!paid) throw new ConflictError('This order has no captured payment to refund', 'REFUND_NOT_PAID');
      payment = await lockLedger(tx, paid.id);
    } else {
      // Cash on delivery (Q104): only once the cash was collected, to a UPI id or bank account paid by hand.
      if (!input.destination || !input.keyring)
        throw new ValidationError('A UPI id or bank account is needed for this refund', 'REFUND_DESTINATION');
      if (o.status !== 'delivered')
        throw new ConflictError('Cash on delivery is refunded only after delivery', 'REFUND_NOT_COLLECTED');
      destinationEnc = encryptField(JSON.stringify(input.destination), input.keyring, DESTINATION_AAD);
    }
    const idemKey = `st_${input.idempotencyKey}`;
    const [same] = await tx.select().from(refunds).where(eq(refunds.idemKey, idemKey)).limit(1);
    if (same) {
      if (
        same.orderId !== o.id ||
        same.amountPaise !== input.amountPaise ||
        same.reasonCode !== input.reasonCode ||
        same.source !== input.source
      )
        throw new ConflictError(
          'This Idempotency-Key was used for a different refund',
          'IDEMPOTENCY_MISMATCH',
        );
      return { refund: await viewOf(tx, same.id, input.staffUserId, input.keyring), replay: true };
    }
    if (input.amountPaise + (await heldForOrder(tx, o.id)) > o.totalPaise)
      throw new ConflictError(
        'The refund is more than the customer paid for this order',
        'REFUND_EXCEEDS_ORDER',
      );
    const made = await insertRequest(tx, {
      payment,
      groupId: o.groupId,
      destinationEnc,
      order: o,
      amountPaise: input.amountPaise,
      source: input.source,
      reasonCode: input.reasonCode,
      note: input.note ?? null,
      requestedBy: input.staffUserId,
      idemKey,
    });
    return { refund: await viewOf(tx, made.id, input.staffUserId, input.keyring), replay: !made.fresh };
  });
}

// ── decisions ─────────────────────────────────────────────────────────────────────────────────────────────────

async function loadInScope(tx: Tx, scope: CityScope, refundId: string) {
  const [r] = await tx
    .select({
      id: refunds.id,
      status: refunds.status,
      version: refunds.version,
      paymentId: refunds.paymentId,
      orderId: refunds.orderId,
      amountPaise: refunds.amountPaise,
      requestedBy: refunds.requestedBy,
      createdAt: refunds.createdAt,
      billId: refunds.billId,
      cityId: sql<string>`coalesce(${orderGroups.cityId}, ${serviceRequests.cityId})`,
      userId: sql<string>`coalesce(${orderGroups.userId}, ${serviceRequests.userId})`,
    })
    .from(refunds)
    .leftJoin(orderGroups, eq(orderGroups.id, refunds.groupId))
    .leftJoin(serviceBills, eq(serviceBills.id, refunds.billId))
    .leftJoin(serviceRequests, eq(serviceRequests.id, serviceBills.requestId))
    .where(eq(refunds.id, refundId))
    .limit(1);
  if (!r || (!scope.all && !scope.cityIds.includes(r.cityId))) throw new NotFoundError('Refund not found');
  return r;
}

/** The code the customer sees: the order's, or the request's for a service bill refund. */
async function orderCodeOf(tx: Tx, orderId: string | null, billId: string | null = null): Promise<string> {
  if (billId) {
    const [b] = await tx
      .select({ code: serviceRequests.code })
      .from(serviceBills)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceBills.requestId))
      .where(eq(serviceBills.id, billId))
      .limit(1);
    return b?.code ?? '';
  }
  if (!orderId) return '';
  const [o] = await tx.select({ code: orders.code }).from(orders).where(eq(orders.id, orderId)).limit(1);
  return o?.code ?? '';
}

/**
 * Approve a waiting request (`refunds:approve` is checked by the API). Not the one who asked (`FOUR_EYES`). One
 * conditional UPDATE on (status, version): of two approvals at once exactly one matches, so only one is ever sent.
 */
export async function approveRefund(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; refundId: string; expectedVersion: number },
): Promise<AdminRefund> {
  return db.transaction(async (tx) => {
    const r = await loadInScope(tx, input.scope, input.refundId);
    if (r.requestedBy === input.staffUserId)
      throw new ForbiddenError('Another staff member must approve a refund you asked for', 'FOUR_EYES');
    const rows = await tx
      .update(refunds)
      .set({
        status: 'approved',
        approvedBy: input.staffUserId,
        decidedAt: sql`now()`,
        nextAttemptAt: sql`now()`,
      })
      .where(
        and(
          eq(refunds.id, r.id),
          eq(refunds.status, 'requested'),
          eq(refunds.version, input.expectedVersion),
        ),
      )
      .returning({ id: refunds.id });
    if (rows.length === 0) {
      const [now] = await tx.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, r.id));
      throw new ConflictError(
        now?.status === 'requested' ? 'The refund changed; reload it' : 'This refund was already decided',
        now?.status === 'requested' ? 'STALE_REFUND' : 'NOT_PENDING',
      );
    }
    refundMachine.assert('requested', 'approved', 'admin');
    const hours = Math.max(0, Math.floor((Date.now() - r.createdAt.getTime()) / 3_600_000));
    await recordRefundEvent(tx, {
      refund: r,
      kind: 'approved',
      from: 'requested',
      to: 'approved',
      actor: { type: 'admin', id: input.staffUserId },
      payload: { amountPaise: r.amountPaise },
    });
    await recordServerEvent(tx, 'refund_approved', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { refundId: r.id, amountPaise: r.amountPaise, hoursWaiting: hours },
    });
    return viewOf(tx, r.id, input.staffUserId);
  });
}

/** Decline a waiting request with a reason code; the held amount is freed and the customer is told. */
export async function rejectRefund(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    refundId: string;
    expectedVersion: number;
    reasonCode: RefundRejectReason;
    note?: string | undefined;
  },
): Promise<AdminRefund> {
  return db.transaction(async (tx) => {
    const r = await loadInScope(tx, input.scope, input.refundId);
    if (r.paymentId) await lockLedger(tx, r.paymentId);
    const rows = await tx
      .update(refunds)
      .set({
        status: 'rejected',
        rejectedBy: input.staffUserId,
        rejectReasonCode: input.reasonCode,
        decidedAt: sql`now()`,
        ...(input.note ? { note: input.note } : {}),
      })
      .where(
        and(
          eq(refunds.id, r.id),
          eq(refunds.status, 'requested'),
          eq(refunds.version, input.expectedVersion),
        ),
      )
      .returning({ id: refunds.id });
    if (rows.length === 0) {
      const [now] = await tx.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, r.id));
      throw new ConflictError(
        now?.status === 'requested' ? 'The refund changed; reload it' : 'This refund was already decided',
        now?.status === 'requested' ? 'STALE_REFUND' : 'NOT_PENDING',
      );
    }
    refundMachine.assert('requested', 'rejected', 'admin');
    if (r.paymentId) await releaseReservation(tx, r.paymentId, r.amountPaise);
    await recordRefundEvent(tx, {
      refund: r,
      kind: 'rejected',
      from: 'requested',
      to: 'rejected',
      actor: { type: 'admin', id: input.staffUserId },
      payload: { reasonCode: input.reasonCode },
    });
    await recordServerEvent(tx, 'refund_rejected', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { refundId: r.id, amountPaise: r.amountPaise, reasonCode: input.reasonCode },
    });
    await notifyCustomer(tx, {
      refundId: r.id,
      userId: r.userId,
      event: 'declined',
      orderCode: await orderCodeOf(tx, r.orderId, r.billId),
      amountPaise: r.amountPaise,
    });
    return viewOf(tx, r.id, input.staffUserId);
  });
}

// ── sending to Razorpay ───────────────────────────────────────────────────────────────────────────────────────

export interface RefundDispatchJob {
  refundId: string;
  amountPaise: number;
  idemKey: string;
  providerPaymentId: string;
  attempts: number;
}

/**
 * Let one sender work on an approved refund: bumps the attempt count and pushes the next try out (30 s, doubling, at
 * most an hour), all in one conditional UPDATE, so of two callers (the approving request and the worker) only one
 * gets the job. Razorpay's idempotency header covers the rest. Null when it is not approved, or not due.
 */
export async function claimRefundDispatch(db: Tx, refundId: string): Promise<RefundDispatchJob | null> {
  const [row] = rowsOf<{
    id: string;
    amount_paise: unknown;
    idem_key: string;
    payment_id: string;
    attempts: number;
  }>(
    await db.execute(sql`
      update refunds set dispatch_attempts = dispatch_attempts + 1,
        next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(dispatch_attempts, 7))))
      where id = ${refundId} and status = 'approved' and mode = 'source'
        and (next_attempt_at is null or next_attempt_at <= now())
      returning id, amount_paise, idem_key, payment_id, dispatch_attempts as attempts`),
  );
  if (!row) return null;
  const [p] = await db
    .select({ providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(eq(payments.id, row.payment_id))
    .limit(1);
  return {
    refundId: row.id,
    amountPaise: Number(row.amount_paise),
    idemKey: row.idem_key,
    providerPaymentId: p?.providerPaymentId ?? '',
    attempts: row.attempts,
  };
}

/** Approved refunds the worker should send now (never sent, or their backoff has passed). */
export async function dueRefundIds(db: Tx, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.status, 'approved'),
        eq(refunds.mode, 'source'),
        sql`(${refunds.nextAttemptAt} is null or ${refunds.nextAttemptAt} <= now())`,
      ),
    )
    .orderBy(refunds.nextAttemptAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Razorpay accepted the refund (or a lookup found it): store its id and move to `initiated`. From `approved`, or from
 * `needs_reconciliation` once the lookup finds the refund. False when it already moved on.
 */
export async function recordRefundSent(db: Tx, refundId: string, providerRefundId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: refunds.status })
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);
    const from = before?.status;
    if (from !== 'approved' && from !== 'needs_reconciliation') return false;
    const rows = await tx
      .update(refunds)
      .set({ status: 'initiated', providerRefundId, initiatedAt: sql`now()`, failureCode: null })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, from)))
      .returning({ id: refunds.id, amountPaise: refunds.amountPaise, orderId: refunds.orderId });
    const row = rows[0];
    if (!row) return false;
    refundMachine.assert(from, 'initiated', 'system');
    await recordRefundEvent(tx, {
      refund: row,
      kind: 'initiated',
      from,
      to: 'initiated',
      actor: sysActor,
      payload: { providerRefundId },
    });
    await recordServerEvent(tx, 'refund_initiated', {
      props: { refundId: row.id, amountPaise: row.amountPaise },
    });
    return true;
  });
}

/**
 * Razorpay did not take it. `permanent` is for a refusal that the caller has **double-checked at Razorpay** (a lookup
 * confirmed no such refund): it fails the refund and frees its amount. A temporary error leaves it `approved` for the
 * worker's next try; the eighth failed try does **not** free the money (a timeout can mean Razorpay did create the
 * refund): it becomes `needs_reconciliation`. The code is Razorpay's HTTP status or `network`.
 */
export async function recordRefundDispatchError(
  db: Tx,
  refundId: string,
  input: { permanent: boolean; code: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select({
        id: refunds.id,
        status: refunds.status,
        paymentId: refunds.paymentId,
        amountPaise: refunds.amountPaise,
        attempts: refunds.dispatchAttempts,
      })
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);
    if (r?.status !== 'approved') return;
    if (input.permanent) {
      await failInTx(tx, r, 'approved', input.code);
      return;
    }
    if (r.attempts >= REFUND_DISPATCH_MAX_ATTEMPTS) {
      await needsReconciliationInTx(tx, r, 'approved', { code: 'dispatch_exhausted' });
      return;
    }
    await tx
      .update(refunds)
      .set({ failureCode: input.code })
      .where(and(eq(refunds.id, r.id), eq(refunds.status, 'approved')));
    await recordRefundEvent(tx, {
      refund: r,
      kind: 'retry',
      from: 'approved',
      to: 'approved',
      actor: sysActor,
      payload: { code: input.code, attempts: r.attempts },
    });
  });
}

/**
 * We cannot tell whether Razorpay holds this refund (an amount that differs from ours, a refusal that could not be
 * double-checked, a give-up after timeouts). The amount **stays reserved** so it can never be refunded twice; a lookup,
 * the refund webhook, or a person settles it. Audited as an alert (`refund.alert.needs_reconciliation`).
 */
export async function recordRefundNeedsReconciliation(
  db: Tx,
  refundId: string,
  input: { code: string; providerRefundId?: string | undefined; reportedPaise?: number | undefined },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({
        id: refunds.id,
        status: refunds.status,
        paymentId: refunds.paymentId,
        amountPaise: refunds.amountPaise,
      })
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);
    // Already unsure and now a refund turned up with another amount: remember what Razorpay holds (no new transition).
    if (r?.status === 'needs_reconciliation' && input.providerRefundId) {
      const rows = await tx
        .update(refunds)
        .set({
          providerRefundId: input.providerRefundId,
          ...(input.reportedPaise ? { providerReportedPaise: input.reportedPaise } : {}),
          failureCode: input.code,
        })
        .where(and(eq(refunds.id, r.id), eq(refunds.status, 'needs_reconciliation')))
        .returning({ id: refunds.id });
      return rows.length > 0;
    }
    if (r?.status !== 'approved' && r?.status !== 'initiated') return false;
    return needsReconciliationInTx(tx, r, r.status, input);
  });
}

async function needsReconciliationInTx(
  tx: Tx,
  r: { id: string; paymentId: string | null; amountPaise: number },
  from: 'approved' | 'initiated',
  input: { code: string; providerRefundId?: string | undefined; reportedPaise?: number | undefined },
): Promise<boolean> {
  if (!r.paymentId) return false; // a manual payout is never sent
  const rows = await tx
    .update(refunds)
    .set({
      status: 'needs_reconciliation',
      failureCode: input.code,
      ...(input.providerRefundId ? { providerRefundId: input.providerRefundId } : {}),
      ...(input.reportedPaise ? { providerReportedPaise: input.reportedPaise } : {}),
      // The worker looks again in ten minutes.
      nextAttemptAt: sql`now() + interval '10 minutes'`,
    })
    .where(and(eq(refunds.id, r.id), eq(refunds.status, from)))
    .returning({ id: refunds.id });
  if (rows.length === 0) return false;
  refundMachine.assert(from, 'needs_reconciliation', 'system');
  await recordRefundEvent(tx, {
    refund: r,
    kind: 'needs_reconciliation',
    from,
    to: 'needs_reconciliation',
    actor: sysActor,
    payload: { code: input.code, reportedPaise: input.reportedPaise ?? null },
  });
  await auditMismatch(tx, r.id, 'refund.alert.needs_reconciliation', {
    code: input.code,
    expectedPaise: r.amountPaise,
    reportedPaise: input.reportedPaise ?? null,
  });
  await recordServerEvent(tx, 'refund_needs_reconciliation', {
    props: { refundId: r.id, amountPaise: r.amountPaise, code: input.code },
  });
  return true;
}

/** Unsure refunds without a Razorpay id the worker should look up again (their wait is over). */
export async function dueReconciliationIds(db: Tx, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.status, 'needs_reconciliation'),
        eq(refunds.mode, 'source'),
        sql`${refunds.providerRefundId} is null`,
        sql`${refunds.nextAttemptAt} <= now()`,
      ),
    )
    .orderBy(refunds.nextAttemptAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/** One checker at a time per unsure refund: pushes the next look an hour out in the same conditional UPDATE. */
export async function claimRefundReconcile(
  db: Tx,
  refundId: string,
): Promise<{ refundId: string; amountPaise: number; providerPaymentId: string } | null> {
  const [row] = rowsOf<{ id: string; amount_paise: unknown; payment_id: string }>(
    await db.execute(sql`
      update refunds set next_attempt_at = now() + interval '1 hour'
      where id = ${refundId} and status = 'needs_reconciliation' and mode = 'source' and provider_refund_id is null
        and next_attempt_at <= now()
      returning id, amount_paise, payment_id`),
  );
  if (!row) return null;
  const [p] = await db
    .select({ providerPaymentId: payments.providerPaymentId })
    .from(payments)
    .where(eq(payments.id, row.payment_id))
    .limit(1);
  return {
    refundId: row.id,
    amountPaise: Number(row.amount_paise),
    providerPaymentId: p?.providerPaymentId ?? '',
  };
}

/**
 * A lookup at Razorpay confirmed there is **no** refund for this one. Only an unsure refund without a Razorpay id can
 * be failed this way; the amount is freed. False for anything else (Razorpay does hold a refund, or it moved on).
 */
export async function resolveRefundAbsent(db: Tx, refundId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({
        id: refunds.id,
        status: refunds.status,
        paymentId: refunds.paymentId,
        amountPaise: refunds.amountPaise,
        providerRefundId: refunds.providerRefundId,
      })
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);
    if (r?.status !== 'needs_reconciliation' || r.providerRefundId !== null) return false;
    return failInTx(tx, r, 'needs_reconciliation', 'confirmed_not_sent');
  });
}

/** `approved|initiated|needs_reconciliation → failed`: payment (group first) locked, amount freed, event written. */
async function failInTx(
  tx: Tx,
  r: { id: string; paymentId: string | null; amountPaise: number },
  from: 'approved' | 'initiated' | 'needs_reconciliation',
  code: string,
): Promise<boolean> {
  if (!r.paymentId) return false; // a manual payout is never sent, so it never fails here
  await lockLedger(tx, r.paymentId);
  const rows = await tx
    .update(refunds)
    .set({ status: 'failed', failureCode: code, settledAt: sql`now()` })
    .where(and(eq(refunds.id, r.id), eq(refunds.status, from)))
    .returning({ id: refunds.id });
  if (rows.length === 0) return false;
  refundMachine.assert(from, 'failed', 'system');
  await releaseReservation(tx, r.paymentId, r.amountPaise);
  await recordRefundEvent(tx, {
    refund: r,
    kind: 'failed',
    from,
    to: 'failed',
    actor: sysActor,
    payload: { code },
  });
  await recordServerEvent(tx, 'refund_failed', {
    props: { refundId: r.id, amountPaise: r.amountPaise, failureCode: code },
  });
  return true;
}

// ── Razorpay refund webhooks ──────────────────────────────────────────────────────────────────────────────────

export interface RazorpayRefundFact {
  providerRefundId: string;
  providerPaymentId: string;
  /** Our refund id from the `notes` we sent (empty when Razorpay did not echo it). */
  refundId: string;
  status: 'processed' | 'failed';
  amountPaise: number;
  currency: string;
}

export type RefundOutcome = 'processed' | 'failed' | 'unchanged' | 'mismatch' | 'unknown_refund';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function auditMismatch(tx: Tx, refundId: string, action: string, after: Record<string, unknown>) {
  await tx.insert(auditLog).values({
    actorUserId: null,
    actorRole: 'system',
    action,
    entity: 'refund',
    entityId: refundId,
    after,
  });
  await alertFinance(tx, refundId, action);
}

/**
 * Every refund alert (`refund.alert.*`, `refund.amount_mismatch`) rings the bell of the finance staff of the refund's
 * city, once per refund and alert (the dedupe key carries the action), and links to Admin → Refunds. Same transaction
 * as the alert, so a rolled-back alert never rings.
 */
async function alertFinance(tx: Tx, refundId: string, action: string): Promise<void> {
  const [row] = rowsOf<{ city_id: string | null; code: string | null }>(
    await tx.execute(sql`select coalesce(g.city_id, sr.city_id) as city_id, coalesce(g.code, sr.code) as code
      from refunds r
      left join order_groups g on g.id = r.group_id
      left join service_bills sb on sb.id = r.bill_id
      left join service_requests sr on sr.id = sb.request_id
      where r.id = ${refundId}`),
  );
  if (!row) return;
  await queueStaffNotice(tx, {
    kind: 'staff.refund_alert',
    cityId: row.city_id,
    entityId: refundId,
    version: action,
    params: { orderCode: row.code ?? '' },
  });
}

/**
 * Apply one Razorpay refund fact: amount and payment asserted, replays change nothing. A refund is found by Razorpay's
 * id, else by **our** id in the notes whatever its state: a processed event for one we had failed or were unsure about
 * (and had sent at least once) moves it to processed and holds its amount again (the CHECK still caps the sum). One of
 * our own ids is never silently parked: anything that cannot be applied is an audited alert (`refund.alert.*`) with
 * outcome `mismatch`, which the webhook route logs as an error for finance.
 */
export async function applyRazorpayRefund(
  tx: Tx,
  fact: RazorpayRefundFact,
): Promise<{ outcome: RefundOutcome }> {
  return tx.transaction(async (inner) => {
    let [found] = await inner
      .select({ id: refunds.id, paymentId: refunds.paymentId })
      .from(refunds)
      .where(eq(refunds.providerRefundId, fact.providerRefundId))
      .limit(1);
    // Razorpay may tell us before we have stored its refund id: our own id travels in the refund's notes.
    if (!found && UUID.test(fact.refundId))
      [found] = await inner
        .select({ id: refunds.id, paymentId: refunds.paymentId })
        .from(refunds)
        .where(eq(refunds.id, fact.refundId))
        .limit(1);
    if (!found?.paymentId) return { outcome: 'unknown_refund' as const };
    const payment = await lockLedger(inner, found.paymentId);
    const [r] = await inner.select().from(refunds).where(eq(refunds.id, found.id)).for('update');
    if (!r) return { outcome: 'unknown_refund' as const };
    if (
      fact.currency !== 'INR' ||
      fact.amountPaise !== r.amountPaise ||
      payment.providerPaymentId !== fact.providerPaymentId ||
      (r.providerRefundId !== null && r.providerRefundId !== fact.providerRefundId)
    ) {
      await auditMismatch(inner, r.id, 'refund.amount_mismatch', {
        expectedPaise: r.amountPaise,
        gotPaise: fact.amountPaise,
        providerRefundId: fact.providerRefundId,
      });
      return { outcome: 'mismatch' as const };
    }
    const from = r.status as RefundStatus;
    // A refund that was never sent (or never approved) cannot have a Razorpay refund: someone created it elsewhere.
    if (
      from === 'requested' ||
      from === 'rejected' ||
      (r.dispatchAttempts === 0 && r.providerRefundId === null)
    ) {
      await auditMismatch(inner, r.id, 'refund.alert.unexpected_provider_refund', {
        status: from,
        providerRefundId: fact.providerRefundId,
        amountPaise: fact.amountPaise,
      });
      return { outcome: 'mismatch' as const };
    }
    if (from === fact.status || !refundMachine.canActor(from, fact.status, 'system'))
      return { outcome: 'unchanged' as const };
    // Money moved for a refund we had failed: hold its amount again first (the CHECK keeps the sum within the capture).
    if (from === 'failed' && fact.status === 'processed') {
      const held = await inner
        .update(payments)
        .set({ refundReservedPaise: sql`${payments.refundReservedPaise} + ${r.amountPaise}` })
        .where(
          and(
            eq(payments.id, payment.id),
            sql`${payments.refundReservedPaise} + ${r.amountPaise} <= ${payments.amountPaise}`,
          ),
        )
        .returning({ id: payments.id });
      if (held.length === 0) {
        await auditMismatch(inner, r.id, 'refund.alert.ledger_full', {
          providerRefundId: fact.providerRefundId,
          amountPaise: r.amountPaise,
        });
        return { outcome: 'mismatch' as const };
      }
    }
    const rows = await inner
      .update(refunds)
      .set({
        status: fact.status,
        providerRefundId: r.providerRefundId ?? fact.providerRefundId,
        settledAt: sql`now()`,
        initiatedAt: r.initiatedAt ?? sql`now()`,
        failureCode: fact.status === 'failed' ? 'razorpay_failed' : null,
      })
      .where(and(eq(refunds.id, r.id), eq(refunds.status, from)))
      .returning({ id: refunds.id });
    if (rows.length === 0) return { outcome: 'unchanged' as const };
    if (fact.status === 'failed') {
      await releaseReservation(inner, payment.id, r.amountPaise);
      await recordRefundEvent(inner, {
        refund: r,
        kind: 'failed',
        from,
        to: 'failed',
        actor: sysActor,
        payload: { code: 'razorpay_failed' },
      });
      await recordServerEvent(inner, 'refund_failed', {
        props: { refundId: r.id, amountPaise: r.amountPaise, failureCode: 'razorpay_failed' },
      });
      return { outcome: 'failed' as const };
    }
    if (from === 'failed')
      await auditMismatch(inner, r.id, 'refund.alert.processed_after_failed', {
        providerRefundId: fact.providerRefundId,
        amountPaise: r.amountPaise,
      });
    await settleProcessed(inner, r, from, payment);
    return { outcome: 'processed' as const };
  });
}

/** A Razorpay refund is confirmed: the payment ledger and status follow, then the common tail. */
async function settleProcessed(
  tx: Tx,
  r: { id: string; orderId: string | null; billId?: string | null; amountPaise: number; createdAt: Date },
  from: RefundStatus,
  payment: { id: string; groupId: string | null; status: string; amountPaise: number; refunded: number },
  by: { actor: EventActor; payload: Record<string, string | number | null> } = {
    actor: sysActor,
    payload: {},
  },
): Promise<void> {
  const refunded = payment.refunded + r.amountPaise;
  await tx.update(payments).set({ refundedPaise: refunded }).where(eq(payments.id, payment.id));
  const to: PaymentStatus = refunded >= payment.amountPaise ? 'refunded' : 'partially_refunded';
  const was = payment.status as PaymentStatus;
  if (was !== to && paymentMachine.canActor(was, to, 'system')) {
    await tx
      .update(payments)
      .set({ status: to })
      .where(and(eq(payments.id, payment.id), eq(payments.status, was)));
    if (payment.groupId)
      await tx
        .update(orderGroups)
        .set({ paymentStatus: to })
        .where(
          and(
            eq(orderGroups.id, payment.groupId),
            inArray(orderGroups.paymentStatus, ['paid', 'partially_refunded']),
          ),
        );
  }
  await afterProcessed(tx, r, from, by.actor, by.payload);
}

/** Common to both modes once the money is confirmed gone: event, analytics, customer email, coin rewards (spec 20). */
async function afterProcessed(
  tx: Tx,
  r: { id: string; orderId: string | null; billId?: string | null; amountPaise: number; createdAt: Date },
  from: RefundStatus,
  actor: EventActor,
  payload: Record<string, string | number | null>,
): Promise<void> {
  const days = Math.max(0, Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000));
  await recordRefundEvent(tx, {
    refund: r,
    kind: 'processed',
    from,
    to: 'processed',
    actor,
    payload: { amountPaise: r.amountPaise, ...payload },
  });
  // Paperwork for an invoiced order (the savepoint inside keeps a failure from undoing the settled money).
  if (r.orderId)
    await issueCreditNoteForRefund(tx, { refundId: r.id, orderId: r.orderId, amountPaise: r.amountPaise });
  const order = r.orderId
    ? (
        await tx
          .select({
            code: orders.code,
            cityId: orders.cityId,
            userId: orders.userId,
            totalPaise: orders.totalPaise,
          })
          .from(orders)
          .where(eq(orders.id, r.orderId))
          .limit(1)
      )[0]
    : undefined;
  await recordServerEvent(tx, 'refund_processed', {
    userId: order?.userId ?? null,
    cityId: order?.cityId ?? null,
    props: { refundId: r.id, amountPaise: r.amountPaise, daysFromRequest: days },
  });
  if (!order && r.billId) {
    // A service bill refund: the customer is told once it is processed, with the request code (no order, no coins).
    const [bill] = await tx
      .select({ code: serviceRequests.code, userId: serviceRequests.userId })
      .from(serviceBills)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceBills.requestId))
      .where(eq(serviceBills.id, r.billId))
      .limit(1);
    if (bill)
      await notifyCustomer(tx, {
        refundId: r.id,
        userId: bill.userId,
        event: 'processed',
        orderCode: bill.code,
        amountPaise: r.amountPaise,
      });
    return;
  }
  if (!order || !r.orderId) return;
  await notifyCustomer(tx, {
    refundId: r.id,
    userId: order.userId,
    event: 'processed',
    orderCode: order.code,
    amountPaise: r.amountPaise,
  });
  // Spec 20: an order refunded in full never earns its reward (the 8-day wait outlasts the 7-day claim window).
  const [done] = await tx
    .select({ sum: sql<string>`coalesce(sum(${refunds.amountPaise}), 0)` })
    .from(refunds)
    .where(and(eq(refunds.orderId, r.orderId), eq(refunds.status, 'processed')));
  if (Number(done?.sum ?? 0) >= order.totalPaise)
    await cancelPendingOrderRewards(tx, { orderId: r.orderId, reasonCode: 'order_refunded' });
  // 2026-11-16: when every live part of the order is refunded in full, the coupon's use goes back (once, idempotent).
  await releaseCouponIfOrderRefunded(tx, r.orderId);
}

/**
 * A webhook event is recorded together with its refund fact (one transaction): if applying fails, the event is not
 * marked as seen, so Razorpay's retry can still apply it. A refund we do not know is parked for staff, not dropped.
 */
export async function recordAndApplyRazorpayRefundEvent(
  db: Tx,
  input: { eventId: string; type: string; payload: Record<string, unknown>; fact: RazorpayRefundFact | null },
): Promise<{ fresh: boolean; outcome: RefundOutcome | null }> {
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
    const { outcome } = await applyRazorpayRefund(tx, input.fact);
    if (outcome === 'unknown_refund')
      await tx.update(webhookEvents).set({ status: 'parked' }).where(eq(webhookEvents.id, input.eventId));
    return { fresh: true, outcome };
  });
}

// ── views ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface RefundRow {
  id: string;
  status: RefundStatus;
  version: number;
  source: string;
  reason_code: string;
  note: string | null;
  amount_paise: unknown;
  order_code: string | null;
  group_code: string;
  payment_method: string | null;
  requested_by: string | null;
  approved_by: string | null;
  created_at: Date | string;
  decided_at: Date | string | null;
  settled_at: Date | string | null;
  reject_reason_code: string | null;
  failure_code: string | null;
  provider_refund_id: string | null;
  mode: AdminRefund['mode'];
  destination_enc: string | null;
  manual_reference: string | null;
  provider_reported_paise: unknown;
  settle_reason_code: string | null;
  cn_number: string | null;
  cn_total_paise: unknown;
  cn_issued_at: Date | string | null;
  overdue: boolean;
  created_key: string;
}

const iso = (v: Date | string): string => new Date(v).toISOString();

/** The validity rule of `settingOr` in SQL: a non-negative integer, else the registry default. */
const slaHours = sql`coalesce(
  case when cs.id is not null then case when jsonb_typeof(cs.value) = 'number' and cs.value::text ~ '^[0-9]{1,6}$' then (cs.value::text)::int end
       else case when jsonb_typeof(gs.value) = 'number' and gs.value::text ~ '^[0-9]{1,6}$' then (gs.value::text)::int end end,
  ${SLA.default})`;

const FROM = sql`from refunds r
  left join order_groups g on g.id = r.group_id
  left join service_bills sb on sb.id = r.bill_id
  left join service_requests sr on sr.id = sb.request_id
  left join orders o on o.id = r.order_id
  left join invoices cn on cn.refund_id = r.id and cn.kind = 'credit_note'
  left join settings cs on cs.key = 'refunds.approval_sla_hours' and cs.city_id = coalesce(g.city_id, sr.city_id)
  left join settings gs on gs.key = 'refunds.approval_sla_hours' and gs.city_id is null`;

const SELECT = sql`select r.id, r.status, r.version, r.source, r.reason_code, r.reason as note, r.amount_paise,
  o.code as order_code, coalesce(g.code, sr.code) as group_code, coalesce(g.payment_method, 'online') as payment_method, r.requested_by, r.approved_by, r.created_at,
  r.decided_at, r.settled_at, r.reject_reason_code, r.failure_code, r.provider_refund_id,
  r.mode, r.destination_enc, r.manual_reference, r.provider_reported_paise, r.settle_reason_code,
  cn.number as cn_number, cn.total_paise as cn_total_paise, cn.issued_at as cn_issued_at,
  (r.status = 'requested' and r.created_at < now() - make_interval(hours => ${slaHours})) as overdue,
  r.created_at::text as created_key
  ${FROM}`;

function parseDestination(json: string): RefundDestinationInput | null {
  const parsed = RefundDestination.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

/** `ra***@okhdfcbank`, `••••1234 · HDFC0001234`: enough for finance to recognise it, never the whole thing. */
function maskDestination(enc: string | null, keyring: Keyring | undefined): string | null {
  if (!enc || !keyring) return null;
  try {
    const d = parseDestination(decryptField(enc, keyring, DESTINATION_AAD));
    if (!d) return null;
    if (d.kind === 'upi') {
      const [name = '', handle = ''] = d.upiId.split('@');
      return `${name.slice(0, 2)}***@${handle}`;
    }
    return `••••${d.accountNumber.slice(-4)} · ${d.ifsc}`;
  } catch {
    return null;
  }
}

function toView(r: RefundRow, staffUserId: string, keyring?: Keyring): AdminRefund {
  return {
    mode: r.mode,
    destinationMasked: maskDestination(r.destination_enc, keyring),
    manualReference: r.manual_reference,
    id: r.id,
    status: r.status,
    version: r.version,
    source: r.source as AdminRefund['source'],
    reasonCode: r.reason_code as AdminRefund['reasonCode'],
    note: r.note,
    amountPaise: Number(r.amount_paise),
    orderCode: r.order_code,
    groupCode: r.group_code,
    paymentMethod: r.payment_method,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    requestedAt: iso(r.created_at),
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
    processedAt: r.status === 'processed' && r.settled_at ? iso(r.settled_at) : null,
    rejectReasonCode: r.reject_reason_code as AdminRefund['rejectReasonCode'],
    failureCode: r.failure_code,
    providerRefundId: r.provider_refund_id,
    providerReportedPaise: r.provider_reported_paise === null ? null : Number(r.provider_reported_paise),
    settleReasonCode: r.settle_reason_code as AdminRefund['settleReasonCode'],
    creditNote:
      r.cn_number && r.cn_issued_at
        ? { number: r.cn_number, totalPaise: Number(r.cn_total_paise), issuedAt: iso(r.cn_issued_at) }
        : null,
    overdue: r.overdue,
    canApprove: r.status === 'requested' && r.requested_by !== staffUserId,
    canSettle: r.status === 'needs_reconciliation' && r.requested_by !== staffUserId,
  };
}

async function viewOf(
  tx: Tx,
  refundId: string,
  staffUserId: string,
  keyring?: Keyring,
): Promise<AdminRefund> {
  const [row] = rowsOf<RefundRow>(await tx.execute(sql`${SELECT} where r.id = ${refundId}`));
  if (!row) throw new NotFoundError('Refund not found');
  return toView(row, staffUserId, keyring);
}

const scopeSql = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`coalesce(g.city_id, sr.city_id) in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

export async function getAdminRefund(
  db: Tx,
  scope: CityScope,
  staffUserId: string,
  refundId: string,
  keyring?: Keyring,
): Promise<AdminRefund> {
  const [row] = rowsOf<RefundRow>(
    await db.execute(sql`${SELECT} where r.id = ${refundId} and ${scopeSql(scope)}`),
  );
  if (!row) throw new NotFoundError('Refund not found');
  return toView(row, staffUserId, keyring);
}

/**
 * Finance is about to pay a cash-on-delivery refund by hand: the whole destination, only once it is approved (before
 * that a request could still be declined), and every look is audited (`refund.destination_viewed`).
 */
export async function revealRefundDestination(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; refundId: string; keyring: Keyring },
): Promise<RefundDestinationInput> {
  return db.transaction(async (tx) => {
    const r = await loadInScope(tx, input.scope, input.refundId);
    const [row] = await tx
      .select({ mode: refunds.mode, status: refunds.status, enc: refunds.destinationEnc })
      .from(refunds)
      .where(eq(refunds.id, r.id))
      .limit(1);
    if (row?.mode !== 'bank_upi' || !row.enc) throw new NotFoundError('Refund not found');
    if (row.status !== 'approved')
      throw new ConflictError('The destination is shown once the refund is approved', 'NOT_APPROVED');
    const d = parseDestination(decryptField(row.enc, input.keyring, DESTINATION_AAD));
    if (!d) throw new ConflictError('The stored destination is unreadable', 'DESTINATION_UNREADABLE');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'refund.destination_viewed',
      entity: 'refund',
      entityId: r.id,
    });
    return d;
  });
}

/** Finance paid an approved cash-on-delivery refund by hand and records the UTR / bank reference. */
export async function markRefundPaid(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    refundId: string;
    expectedVersion: number;
    reference: string;
    keyring?: Keyring;
  },
): Promise<AdminRefund> {
  if (!/^[A-Za-z0-9]{6,35}$/.test(input.reference))
    throw new ValidationError('Enter the UTR or bank reference (letters and digits)', 'REFUND_REFERENCE');
  return db.transaction(async (tx) => {
    const r = await loadInScope(tx, input.scope, input.refundId);
    const [row] = await tx
      .select({
        mode: refunds.mode,
        orderId: refunds.orderId,
        status: refunds.status,
        createdAt: refunds.createdAt,
      })
      .from(refunds)
      .where(eq(refunds.id, r.id))
      .for('update');
    if (row?.mode !== 'bank_upi')
      throw new ConflictError('Razorpay refunds are paid by Razorpay', 'NOT_MANUAL');
    if (row.status !== 'approved')
      throw new ConflictError('The refund must be approved before it is paid', 'NOT_APPROVED');
    const rows = await tx
      .update(refunds)
      .set({ status: 'processed', manualReference: input.reference, settledAt: sql`now()` })
      .where(
        and(
          eq(refunds.id, r.id),
          eq(refunds.status, 'approved'),
          eq(refunds.mode, 'bank_upi'),
          eq(refunds.version, input.expectedVersion),
        ),
      )
      .returning({ id: refunds.id });
    if (rows.length === 0) throw new ConflictError('The refund changed; reload it', 'STALE_REFUND');
    refundMachine.assert('approved', 'processed', 'admin');
    await afterProcessed(
      tx,
      { id: r.id, orderId: r.orderId, amountPaise: r.amountPaise, createdAt: row.createdAt },
      'approved',
      { type: 'admin', id: input.staffUserId },
      { reference: input.reference },
    );
    return viewOf(tx, r.id, input.staffUserId, input.keyring);
  });
}

export interface SettleRefundInput {
  scope: CityScope;
  staffUserId: string;
  refundId: string;
  expectedVersion: number;
  outcome: RefundSettleOutcome;
  reasonCode: RefundSettleReason;
  note: string;
  /** Razorpay's refund id (`rfnd_...`) from the dashboard; needed unless we already stored one. */
  providerRefundId?: string | undefined;
  /** The amount Razorpay refunded when it is not ours (`refunded_other_amount`). */
  providerAmountPaise?: number | undefined;
  keyring?: Keyring | undefined;
}

/**
 * Finance settles a refund stuck in `needs_reconciliation` by hand, after checking the Razorpay dashboard (spec 05
 * "Settling by hand", decision 2026-11-16). One conditional UPDATE on (status, version) decides between two people;
 * the requester can never settle (four-eyes, also a CHECK); a reason code and a written note are required and kept on
 * the row, in `refund_events` and in `audit_log` (`refund.reconciled`).
 *
 * - `not_refunded`: Razorpay holds no refund, so it fails and the amount is freed. Refused when Razorpay already
 *   reported a refund id: that money did move.
 * - `refunded_full`: Razorpay refunded exactly our amount, so it is processed; the id is required.
 * - `refunded_other_amount`: Razorpay refunded another amount (typed, and equal to what it reported when we know it):
 *   the refund takes that amount, the ledger is moved to match (never above the capture), and it is processed.
 * Lock order: payment, then refund (spec 14 rule 10).
 */
export async function settleUnsureRefund(db: Tx, input: SettleRefundInput): Promise<AdminRefund> {
  const note = input.note.trim();
  if (note.length < 10 || note.length > 300)
    throw new ValidationError('Write a note of 10 to 300 characters', 'VALIDATION');
  return db.transaction(async (tx) => {
    const found = await loadInScope(tx, input.scope, input.refundId);
    if (found.requestedBy === input.staffUserId)
      throw new ForbiddenError('Another staff member must settle a refund you asked for', 'FOUR_EYES');
    if (!found.paymentId) throw new ConflictError('Only a Razorpay refund can be unsure', 'NOT_UNSURE');
    const payment = await lockLedger(tx, found.paymentId);
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, found.id)).for('update');
    if (r?.status !== 'needs_reconciliation')
      throw new ConflictError('This refund is not waiting to be settled', 'NOT_UNSURE');
    if (r.version !== input.expectedVersion)
      throw new ConflictError('The refund changed; reload it', 'STALE_REFUND');

    const settleFields = {
      settledAt: sql`now()`,
      settledBy: input.staffUserId,
      settleReasonCode: input.reasonCode,
      settleNote: note,
    };
    const actor: EventActor = { type: 'admin', id: input.staffUserId };
    let amountPaise = r.amountPaise;

    if (input.outcome === 'not_refunded') {
      if (r.providerRefundId !== null)
        throw new ConflictError(
          'Razorpay already reported a refund for it; it cannot be "not refunded"',
          'PROVIDER_HOLDS_REFUND',
        );
      const rows = await tx
        .update(refunds)
        .set({ status: 'failed', failureCode: 'settled_by_hand', ...settleFields })
        .where(
          and(
            eq(refunds.id, r.id),
            eq(refunds.status, 'needs_reconciliation'),
            eq(refunds.version, input.expectedVersion),
          ),
        )
        .returning({ id: refunds.id });
      if (rows.length === 0) throw new ConflictError('The refund changed; reload it', 'STALE_REFUND');
      refundMachine.assert('needs_reconciliation', 'failed', 'admin');
      await releaseReservation(tx, payment.id, r.amountPaise);
      await recordRefundEvent(tx, {
        refund: r,
        kind: 'failed',
        from: 'needs_reconciliation',
        to: 'failed',
        actor,
        payload: { code: 'settled_by_hand', outcome: input.outcome, reasonCode: input.reasonCode },
      });
      await recordServerEvent(tx, 'refund_failed', {
        userId: input.staffUserId,
        props: { refundId: r.id, amountPaise: r.amountPaise, failureCode: 'settled_by_hand' },
      });
    } else {
      const providerRefundId = r.providerRefundId ?? input.providerRefundId ?? null;
      if (providerRefundId === null)
        throw new ValidationError("Enter Razorpay's refund id (rfnd_...)", 'PROVIDER_REFUND_ID_REQUIRED');
      if (
        r.providerRefundId !== null &&
        input.providerRefundId &&
        input.providerRefundId !== r.providerRefundId
      )
        throw new ConflictError('Razorpay reported another refund id for it', 'PROVIDER_ID_DIFFERS');
      if (input.outcome === 'refunded_other_amount') {
        const typed = input.providerAmountPaise;
        if (typed === undefined || !Number.isInteger(typed) || typed < 1)
          throw new ValidationError('Enter the amount Razorpay refunded', 'PROVIDER_AMOUNT_REQUIRED');
        if (typed > payment.amountPaise)
          throw new ConflictError('The refund is more than the payment holds', 'REFUND_EXCEEDS_PAYMENT');
        if (typed === r.amountPaise)
          throw new ValidationError('That is our amount: settle it as "refunded in full"', 'AMOUNT_SAME');
        if (r.providerReportedPaise !== null && r.providerReportedPaise !== typed)
          throw new ConflictError('Razorpay reported a different amount', 'AMOUNT_DIFFERS_FROM_REPORT');
        amountPaise = typed;
      } else if (r.providerReportedPaise !== null && r.providerReportedPaise !== r.amountPaise) {
        throw new ConflictError(
          'Razorpay reported another amount: settle it as "another amount"',
          'AMOUNT_DIFFERS_FROM_REPORT',
        );
      }
      // Hold the real amount on the payment first (a conditional UPDATE under the payment lock: never above the capture).
      if (amountPaise !== r.amountPaise) {
        const moved = await tx
          .update(payments)
          .set({
            refundReservedPaise: sql`${payments.refundReservedPaise} - ${r.amountPaise} + ${amountPaise}`,
          })
          .where(
            and(
              eq(payments.id, payment.id),
              sql`${payments.refundReservedPaise} - ${r.amountPaise} + ${amountPaise} <= ${payments.amountPaise}`,
            ),
          )
          .returning({ id: payments.id });
        if (moved.length === 0)
          throw new ConflictError(
            'The refund is more than the payment still holds',
            'REFUND_EXCEEDS_PAYMENT',
          );
      }
      const rows = await tx
        .update(refunds)
        .set({
          status: 'processed',
          amountPaise,
          providerRefundId,
          initiatedAt: r.initiatedAt ?? sql`now()`,
          failureCode: null,
          ...settleFields,
        })
        .where(
          and(
            eq(refunds.id, r.id),
            eq(refunds.status, 'needs_reconciliation'),
            eq(refunds.version, input.expectedVersion),
          ),
        )
        .returning({ id: refunds.id });
      if (rows.length === 0) throw new ConflictError('The refund changed; reload it', 'STALE_REFUND');
      refundMachine.assert('needs_reconciliation', 'processed', 'admin');
      await settleProcessed(
        tx,
        { id: r.id, orderId: r.orderId, billId: r.billId, amountPaise, createdAt: r.createdAt },
        'needs_reconciliation',
        payment,
        { actor, payload: { outcome: input.outcome, reasonCode: input.reasonCode, providerRefundId } },
      );
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'refund.reconciled',
      entity: 'refund',
      entityId: r.id,
      after: {
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        amountPaise,
        previousAmountPaise: r.amountPaise,
      },
    });
    await recordServerEvent(tx, 'refund_reconciled', {
      userId: input.staffUserId,
      cityId: found.cityId,
      props: { refundId: r.id, amountPaise, outcome: input.outcome, reasonCode: input.reasonCode },
    });
    return viewOf(tx, r.id, input.staffUserId, input.keyring);
  });
}

const VIEW_WHERE: Record<AdminRefundView, SQL> = {
  waiting: sql`r.status = 'requested'`,
  overdue: sql`r.status = 'requested' and r.created_at < now() - make_interval(hours => ${slaHours})`,
  in_progress: sql`r.status in ('approved', 'initiated')`,
  attention: sql`r.status = 'needs_reconciliation'`,
  closed: sql`r.status in ('processed', 'rejected', 'failed')`,
};

/** The finance queue, keyset-paged: waiting and overdue oldest first, the rest newest first. */
export async function listAdminRefunds(
  db: Tx,
  scope: CityScope,
  input: {
    view: AdminRefundView;
    cursor: string | null;
    limit?: number;
    staffUserId: string;
    keyring?: Keyring;
  },
): Promise<AdminRefundPage> {
  const limit = pageSize(input.limit, 20, 50);
  const oldestFirst = input.view === 'waiting' || input.view === 'overdue';
  const after = input.cursor ? decodeCursor(input.cursor, 'timestamp') : null;
  const keyset = after
    ? oldestFirst
      ? sql`and (r.created_at, r.id) > (${after.k}::timestamptz, ${after.id}::uuid)`
      : sql`and (r.created_at, r.id) < (${after.k}::timestamptz, ${after.id}::uuid)`
    : sql``;
  const rows = rowsOf<RefundRow>(
    await db.execute(sql`${SELECT}
      where ${VIEW_WHERE[input.view]} and ${scopeSql(scope)} ${keyset}
      order by r.created_at ${oldestFirst ? sql`asc` : sql`desc`}, r.id ${oldestFirst ? sql`asc` : sql`desc`}
      limit ${limit + 1}`),
  );
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  const [counts] = rowsOf<{ waiting: number; overdue: number; attention: number }>(
    await db.execute(sql`select count(*) filter (where r.status = 'requested')::int as waiting,
        count(*) filter (where r.status = 'requested' and r.created_at < now() - make_interval(hours => ${slaHours}))::int as overdue,
        count(*) filter (where r.status = 'needs_reconciliation')::int as attention
      ${FROM} where r.status in ('requested', 'needs_reconciliation') and ${scopeSql(scope)}`),
  );
  return {
    items: rows.slice(0, limit).map((r) => toView(r, input.staffUserId, input.keyring)),
    nextCursor: last ? encodeCursor({ k: last.created_key, id: last.id }) : null,
    counts: {
      waiting: counts?.waiting ?? 0,
      overdue: counts?.overdue ?? 0,
      attention: counts?.attention ?? 0,
    },
  };
}

/** What a customer sees of the refunds on their own sub-orders (never the staff, notes or reasons of the decision). */
export async function customerRefundsByOrder(
  db: Tx,
  userId: string,
  orderIds: readonly string[],
): Promise<Map<string, CustomerRefund[]>> {
  const out = new Map<string, CustomerRefund[]>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({
      orderId: refunds.orderId,
      status: refunds.status,
      amountPaise: refunds.amountPaise,
      createdAt: refunds.createdAt,
      settledAt: refunds.settledAt,
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(and(inArray(refunds.orderId, [...orderIds]), eq(orders.userId, userId)))
    .orderBy(refunds.createdAt);
  for (const r of rows) {
    if (!r.orderId) continue;
    const list = out.get(r.orderId) ?? [];
    list.push({
      status: customerRefundStatus(r.status as RefundStatus),
      amountPaise: r.amountPaise,
      requestedAt: r.createdAt.toISOString(),
      processedAt: r.status === 'processed' && r.settledAt ? r.settledAt.toISOString() : null,
    });
    out.set(r.orderId, list);
  }
  return out;
}

const BILL_REFUNDABLE = ['paid', 'partially_refunded'];

/**
 * A service bill was paid online and the money must go back (the request was cancelled by staff, or the customer paid
 * twice / after the bill was settled another way): one approval-first refund request for what the payment still holds
 * (idempotent per bill and reason, so a retry or a second cancel never makes a second one). Locks request, bill and
 * payment in that order; the caller already holds the request row. Returns the refund id, or null when nothing is held.
 */
export async function requestRefundForServiceBill(
  tx: Tx,
  input: { billId: string; paymentId?: string; source: 'service_cancelled' | 'duplicate_payment' },
): Promise<string | null> {
  const [bill] = await tx
    .select({
      requestId: serviceBills.requestId,
      code: serviceRequests.code,
      cityId: serviceRequests.cityId,
      userId: serviceRequests.userId,
    })
    .from(serviceBills)
    .innerJoin(serviceRequests, eq(serviceRequests.id, serviceBills.requestId))
    .where(eq(serviceBills.id, input.billId))
    .limit(1);
  if (!bill) return null;
  let paymentId = input.paymentId ?? null;
  if (!paymentId) {
    const [paid] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.billId, input.billId), inArray(payments.status, BILL_REFUNDABLE)))
      .limit(1);
    paymentId = paid?.id ?? null;
  }
  if (!paymentId) return null;
  const payment = await lockLedger(tx, paymentId);
  const amount = payment.amountPaise - payment.reserved;
  if (amount <= 0) return null;
  const made = await insertRequest(tx, {
    payment,
    groupId: null,
    billId: input.billId,
    order: { id: null, code: bill.code, cityId: bill.cityId, userId: bill.userId },
    amountPaise: amount,
    source: input.source,
    reasonCode: input.source,
    note: null,
    requestedBy: null,
    // One per payment and reason: a repeated cancel, retry or late webhook finds this one instead of making another.
    idemKey: `sys_svc_${input.source}_${paymentId}`,
  });
  return made.fresh ? made.id : null;
}
