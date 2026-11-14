import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { assignmentMachine } from '@mechdost/shared/state';
import { orderAssignments, orders } from '../schema';
import type { ActorContext } from './actor';
import { ConflictError, mapPgError, NotFoundError, ValidationError } from './errors';
import { lockOrder, transitionOrder, type Tx } from './orders';

/** The order behind an assignment, locked first (lock order: order row, then assignment — see `lockOrder`). */
async function lockOrderOf(tx: Tx, assignmentId: string) {
  const [a] = await tx
    .select({ orderId: orderAssignments.orderId })
    .from(orderAssignments)
    .where(eq(orderAssignments.id, assignmentId));
  if (!a) return null;
  return { orderId: a.orderId, ...(await lockOrder(tx, a.orderId)) };
}

/**
 * Admin routes an order to a shop (docs/specs/04). Order: placed|needs_rerouting → awaiting_shop, and one
 * `offered` assignment with a DB-clock expiry. The partial unique index guarantees one active assignment.
 */
export async function offerOrderToShop(
  tx: Tx,
  args: {
    orderId: string;
    shopId: string;
    expectedOrderVersion: number;
    timeoutMinutes: number;
    /**
     * A fixed deadline instead of `now() + timeoutMinutes`: the shop is closed, so the offer waits until it opens
     * plus the grace setting (`acceptanceDeadline` in `@mechdost/shared/shop-hours`). At most 8 days ahead.
     */
    expiresAt?: Date | null;
    actor: ActorContext;
  },
) {
  if (!Number.isInteger(args.timeoutMinutes) || args.timeoutMinutes < 1 || args.timeoutMinutes > 24 * 60) {
    throw new ValidationError('timeoutMinutes must be 1..1440');
  }
  const fixed = args.expiresAt ?? null;
  if (fixed && (Number.isNaN(fixed.getTime()) || fixed.getTime() > Date.now() + 8 * 24 * 60 * 60_000)) {
    throw new ValidationError('expiresAt must be within 8 days');
  }
  const [current] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, args.orderId));
  if (!current) throw new NotFoundError('Order not found');
  if (current.status !== 'placed' && current.status !== 'needs_rerouting') {
    throw new ConflictError(
      `Order is ${current.status}; it can only be routed from placed or needs_rerouting`,
      'NOT_ROUTABLE',
    );
  }
  await transitionOrder(tx, {
    orderId: args.orderId,
    from: current.status,
    to: 'awaiting_shop',
    expectedVersion: args.expectedOrderVersion,
    actor: args.actor,
  });
  try {
    const [assignment] = await tx
      .insert(orderAssignments)
      .values({
        orderId: args.orderId,
        shopId: args.shopId,
        offeredBy: args.actor.userId ?? null,
        offeredAt: sql`now()`,
        // A fixed deadline is never earlier than the normal timeout (and the CHECK keeps it after the offer).
        expiresAt: fixed
          ? sql`greatest(${fixed.toISOString()}::timestamptz, now() + make_interval(mins => ${args.timeoutMinutes}))`
          : sql`now() + make_interval(mins => ${args.timeoutMinutes})`,
      })
      .returning();
    if (!assignment) throw new Error('assignment insert returned no row');
    return assignment;
  } catch (err) {
    mapPgError(err);
  }
}

/**
 * Shop accepts. Compare-and-set on the assignment (still offered, not expired by the DB clock, belongs to this
 * shop), then the order moves awaiting_shop → confirmed with shop_id set. A late accept after expiry fails.
 */
export async function acceptAssignment(
  tx: Tx,
  args: { assignmentId: string; shopId: string; actor: ActorContext },
) {
  assignmentMachine.assert('offered', 'accepted', args.actor.type);
  const order = await lockOrderOf(tx, args.assignmentId);
  if (!order)
    throw new ConflictError('This order is no longer available to accept', 'ASSIGNMENT_UNAVAILABLE');
  const [a] = await tx
    .update(orderAssignments)
    .set({ status: 'accepted', respondedAt: sql`now()` })
    .where(
      and(
        eq(orderAssignments.id, args.assignmentId),
        eq(orderAssignments.shopId, args.shopId),
        eq(orderAssignments.status, 'offered'),
        gt(orderAssignments.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!a) throw new ConflictError('This order is no longer available to accept', 'ASSIGNMENT_UNAVAILABLE');
  return transitionOrder(tx, {
    orderId: a.orderId,
    from: 'awaiting_shop',
    to: 'confirmed',
    expectedVersion: order.version,
    actor: args.actor,
    patch: { shopId: args.shopId, confirmedAt: new Date() },
  });
}

/** Shop declines with a reason; the order returns to admin (needs_rerouting). */
export async function declineAssignment(
  tx: Tx,
  args: { assignmentId: string; shopId: string; reason: string; actor: ActorContext },
) {
  assignmentMachine.assert('offered', 'declined', args.actor.type);
  if (args.reason.trim().length < 3) throw new ValidationError('A decline reason is required');
  const order = await lockOrderOf(tx, args.assignmentId);
  if (!order)
    throw new ConflictError('This order is no longer awaiting your response', 'ASSIGNMENT_UNAVAILABLE');
  const [a] = await tx
    .update(orderAssignments)
    .set({ status: 'declined', respondedAt: sql`now()`, declineReason: args.reason.trim() })
    .where(
      and(
        eq(orderAssignments.id, args.assignmentId),
        eq(orderAssignments.shopId, args.shopId),
        eq(orderAssignments.status, 'offered'),
      ),
    )
    .returning();
  if (!a) throw new ConflictError('This order is no longer awaiting your response', 'ASSIGNMENT_UNAVAILABLE');
  return transitionOrder(tx, {
    orderId: a.orderId,
    from: 'awaiting_shop',
    to: 'needs_rerouting',
    expectedVersion: order.version,
    actor: args.actor,
  });
}

/**
 * Timer job (pg-boss, at-least-once): expire only if still offered AND past expiry by the DB clock.
 * Returns null when there is nothing to do (already accepted/declined/expired) — safe to run twice. An offer
 * whose order is no longer awaiting a shop (drift) is withdrawn instead of failing the job on every run.
 */
export async function expireAssignment(tx: Tx, args: { assignmentId: string }) {
  const order = await lockOrderOf(tx, args.assignmentId);
  if (!order) return null;
  if (order.status !== 'awaiting_shop') {
    await tx
      .update(orderAssignments)
      .set({ status: 'withdrawn', respondedAt: sql`now()` })
      .where(and(eq(orderAssignments.id, args.assignmentId), eq(orderAssignments.status, 'offered')));
    return null;
  }
  const [a] = await tx
    .update(orderAssignments)
    .set({ status: 'expired', respondedAt: sql`now()` })
    .where(
      and(
        eq(orderAssignments.id, args.assignmentId),
        eq(orderAssignments.status, 'offered'),
        lte(orderAssignments.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!a) return null;
  return transitionOrder(tx, {
    orderId: a.orderId,
    from: 'awaiting_shop',
    to: 'needs_rerouting',
    expectedVersion: order.version,
    actor: { type: 'system' },
  });
}
