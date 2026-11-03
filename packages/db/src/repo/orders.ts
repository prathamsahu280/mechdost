import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { orderMachine, type OrderStatus } from '@mechdost/shared/state';
import { orders } from '../schema';
import { setActor, type ActorContext } from './actor';
import { ConflictError, NotFoundError } from './errors';
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
 * never sends. Out for delivery is queued by `issueDeliveryCode`, which holds the code.
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
    .returning({ id: orders.id, status: orders.status, version: orders.version, shopId: orders.shopId });
  const row = rows[0];
  if (!row)
    throw new ConflictError(
      `Order ${args.orderId} changed before ${args.from} → ${args.to} could apply`,
      'STALE_ORDER',
    );
  const event = WHATSAPP_ON[args.to];
  if (event) await queueOrderWhatsApp(tx, { orderId: row.id, event, orderVersion: row.version });
  return row;
}
