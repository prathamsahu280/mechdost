import { and, eq, inArray } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { orderMachine, type OrderStatus } from '@mechdost/shared/state';
import { orderGroups, orders, payments } from '../schema';
import { setActor, type ActorContext } from './actor';
import { ConflictError, NotFoundError } from './errors';
import { requestRefundForClosedOrder } from './refunds';
import { createOrderRewards, recordShopCoinDiscount, restoreCoinsForSubOrder } from './coins';
import { queueOrderWhatsApp, type OrderWhatsAppEvent } from './order-notifications';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = PgDatabase<PgQueryResultHKT, any, any>;

type OrderPatch = Partial<
  Pick<
    typeof orders.$inferInsert,
    'shopId' | 'confirmedAt' | 'deliveredAt' | 'statusReasonCode' | 'customerMessage'
  >
>;

/**
 * The only way to change an order's status (docs/specs/14-data-integrity.md):
 * 1. the state machine checks the move and the actor;
 * 2. a conditional UPDATE … WHERE status = $from AND version = $expected applies it atomically;
 * 3. zero rows updated ⇒ someone else changed it first ⇒ ConflictError (HTTP 409).
 * The `orders_status_event` trigger writes the timeline row; the bump_version trigger increments `version`.
 * Customer WhatsApp updates for milestones are queued in the same transaction (spec 10): a rolled-back change
 * never sends. Coins are restored (cancelled/rejected) or rewarded (delivered) in the same transaction too. Out for delivery is queued by `issueDeliveryCode`, which holds the code.
 */
/**
 * Lock order (docs/specs/14-data-integrity.md "Lock order"): every transaction that changes an order and its
 * assignments, reservations or stock locks the **order row first**, then the rest. Cancel, reject, route,
 * accept, decline, expiry and the shop steps all follow it, so two of them can never wait on each other in a
 * cycle (deadlock → 500). Returns the locked status and version.
 */
export async function lockOrder(tx: Tx, orderId: string): Promise<{ status: OrderStatus; version: number }> {
  const [o] = await tx
    .select({ status: orders.status, version: orders.version })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for('update');
  if (!o) throw new NotFoundError('Order not found');
  return { status: o.status as OrderStatus, version: o.version };
}

const WHATSAPP_ON: Partial<Record<OrderStatus, OrderWhatsAppEvent>> = {
  confirmed: 'order.confirmed',
  rejected: 'order.rejected',
};

export async function transitionOrder(
  tx: Tx,
  args: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    expectedVersion: number;
    actor: ActorContext;
    patch?: OrderPatch;
  },
) {
  orderMachine.assert(args.from, args.to, args.actor.type);
  await setActor(tx, args.actor);
  const rows = await tx
    .update(orders)
    .set({ status: args.to, ...args.patch })
    .where(
      and(
        eq(orders.id, args.orderId),
        eq(orders.status, args.from),
        eq(orders.version, args.expectedVersion),
      ),
    )
    .returning({
      id: orders.id,
      status: orders.status,
      version: orders.version,
      shopId: orders.shopId,
      groupId: orders.groupId,
    });
  const row = rows[0];
  if (!row)
    throw new ConflictError(
      `Order ${args.orderId} changed before ${args.from} → ${args.to} could apply`,
      'STALE_ORDER',
    );
  const event = WHATSAPP_ON[args.to];
  if (event) await queueOrderWhatsApp(tx, { orderId: row.id, event, orderVersion: row.version });
  // MechDost Coins (spec 20), same transaction: a cancelled or rejected part gives its coins back (as coins, once);
  // a delivered part earns the admin-set reward, usable after the unlock days.
  if (args.to === 'cancelled' || args.to === 'rejected') {
    await restoreCoinsForSubOrder(tx, row.id);
    // A paid online part waits in the finance queue for a refund approval (spec 05, decision 2026-11-15).
    await requestRefundForClosedOrder(tx, row.id);
  }
  if (args.to === 'delivered') {
    await createOrderRewards(tx, row.id);
    await recordShopCoinDiscount(tx, row.id);
  }
  if (orderMachine.isTerminal(args.to)) await settleGroupPayment(tx, row.groupId);
  return row;
}

/**
 * After a terminal order move, settle the group's payment status (group row locked after the order row):
 * - COD: `cod_collected` once no sub-order is still open and at least one was delivered (review B7). A COD group
 *   whose parts were all cancelled keeps `cod_pending` until the COD payment states are designed (Q74).
 * - Online, not yet paid: when no sub-order is still live (all cancelled or rejected) the group and its open
 *   Razorpay orders expire, so a later capture is flagged for a refund instead of completing a cancelled order
 *   (security review 2026-11-12).
 */
async function settleGroupPayment(tx: Tx, groupId: string): Promise<void> {
  const [g] = await tx
    .select({ method: orderGroups.paymentMethod, status: orderGroups.paymentStatus })
    .from(orderGroups)
    .where(eq(orderGroups.id, groupId))
    .for('update');
  if (!g) return;
  const subs = await tx.select({ status: orders.status }).from(orders).where(eq(orders.groupId, groupId));
  if (subs.some((s) => !orderMachine.isTerminal(s.status as OrderStatus))) {
    // A part was cancelled or rejected before paying: the open Razorpay order still asks for the old total. Close
    // it, so the next payment asks only for what is left (final review 2026-11-12, finding 3).
    if (
      g.method === 'online' &&
      UNPAID.includes(g.status) &&
      subs.some((s) => s.status === 'cancelled' || s.status === 'rejected')
    )
      await tx
        .update(payments)
        .set({ status: 'expired' })
        .where(and(eq(payments.groupId, groupId), inArray(payments.status, [...UNPAID])));
    return;
  }
  if (g.method === 'cod' && g.status === 'cod_pending' && subs.some((s) => s.status === 'delivered')) {
    await tx
      .update(orderGroups)
      .set({ paymentStatus: 'cod_collected' }) // the version trigger (0031) bumps `version`
      .where(and(eq(orderGroups.id, groupId), eq(orderGroups.paymentStatus, 'cod_pending')));
    return;
  }
  if (g.method === 'online' && UNPAID.includes(g.status)) {
    await tx
      .update(orderGroups)
      .set({ paymentStatus: 'expired' })
      .where(and(eq(orderGroups.id, groupId), inArray(orderGroups.paymentStatus, [...UNPAID])));
    await tx
      .update(payments)
      .set({ status: 'expired' })
      .where(and(eq(payments.groupId, groupId), inArray(payments.status, [...UNPAID])));
  }
}

const UNPAID: readonly string[] = ['created', 'attempted', 'failed'];
