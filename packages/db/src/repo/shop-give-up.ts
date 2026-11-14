import { and, eq, sql } from 'drizzle-orm';
import {
  ASSIGNMENT_GIVE_UP_REASONS,
  assignmentMachine,
  type AssignmentGiveUpReason,
} from '@mechdost/shared/state';
import { auditLog, orderAssignments, orders } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { restoreCommittedStock } from './inventory';
import { queueStaffOrderNotice } from './notice-events';
import { lockOrder, transitionOrder, type Tx } from './orders';
import { numOrNull, rowsOf } from './sql-rows';

/**
 * A shop gives up an order it accepted (spec 04, user ruling 2026-11-15): allowed only while the order is
 * `confirmed` (before packing). One transaction, order row locked first (lock order, spec 14):
 * 1. the accepted assignment becomes `given_up` with a reason code (+ optional note), compare-and-set on its status;
 * 2. the order goes confirmed → needs_rerouting (conditional UPDATE on status + version), shop and confirmation
 *    time cleared, so admin reroutes it (never auto-cancelled; the customer's timeline hides the step, migration 0054);
 * 3. the stock accept took goes back to the shop (the exact reverse of the commit);
 * 4. audit entry, analytics event, and the staff hook.
 * Another shop's order is a 404. The shop's score counts it (given up = answered, not accepted).
 */
export async function giveUpShopOrder(
  db: Tx,
  input: {
    shopIds: readonly string[];
    code: string;
    expectedVersion: number;
    reasonCode: AssignmentGiveUpReason;
    note?: string | null;
    staffUserId: string;
  },
): Promise<{ status: string; version: number }> {
  if (!(ASSIGNMENT_GIVE_UP_REASONS as readonly string[]).includes(input.reasonCode))
    throw new ValidationError('Choose a reason', 'GIVE_UP_REASON');
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note !== null && note.length > 300)
    throw new ValidationError('The note is at most 300 characters', 'GIVE_UP_NOTE');
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({ id: orders.id, shopId: orders.shopId, cityId: orders.cityId })
      .from(orders)
      .where(eq(orders.code, input.code))
      .limit(1);
    if (!o?.shopId || !input.shopIds.includes(o.shopId)) throw new NotFoundError('Order not found');
    const shopId = o.shopId;
    const locked = await lockOrder(tx, o.id);
    if (locked.status !== 'confirmed')
      throw new ConflictError(
        `Order is ${locked.status}; it can only be given up before packing`,
        'WRONG_STEP',
      );
    assignmentMachine.assert('accepted', 'given_up', 'shop');
    const [a] = await tx
      .update(orderAssignments)
      .set({
        status: 'given_up',
        givenUpAt: sql`now()`,
        giveUpReason: input.reasonCode,
        giveUpNote: note,
      })
      .where(
        and(
          eq(orderAssignments.orderId, o.id),
          eq(orderAssignments.shopId, shopId),
          eq(orderAssignments.status, 'accepted'),
        ),
      )
      .returning({ id: orderAssignments.id });
    if (!a)
      throw new ConflictError('This order no longer has an accepted offer from your shop', 'WRONG_STEP');
    const row = await transitionOrder(tx, {
      orderId: o.id,
      from: 'confirmed',
      to: 'needs_rerouting',
      expectedVersion: input.expectedVersion,
      actor: { type: 'shop', userId: input.staffUserId },
      patch: { shopId: null, confirmedAt: null },
    });
    await restoreCommittedStock(tx, o.id);
    const [t] = rowsOf<{ minutes: unknown }>(
      await tx.execute(sql`select extract(epoch from (now() - responded_at)) / 60 as minutes
        from order_assignments where id = ${a.id}`),
    );
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'shop',
      action: 'order.given_up_by_shop',
      entity: 'order',
      entityId: o.id,
      after: { shopId, reasonCode: input.reasonCode },
      reason: input.reasonCode,
    });
    await recordServerEvent(tx, 'seller_order_given_up', {
      userId: input.staffUserId,
      cityId: o.cityId,
      props: {
        orderCode: input.code,
        shopId,
        reasonCode: input.reasonCode,
        minutesSinceAccept: Math.max(0, Math.round(numOrNull(t?.minutes) ?? 0)),
      },
    });
    await notifyStaffShopGaveUp(tx, {
      orderId: o.id,
      shopId,
      cityId: o.cityId,
      reasonCode: input.reasonCode,
      version: row.version,
    });
    return { status: row.status, version: row.version };
  });
}

/**
 * Staff hook for "a shop gave an order up" (spec 04, 10). Staff who can route orders in the city get a bell notice
 * (and a push where they turned it on), in the same transaction as the give-up; the live pings the order and
 * assignment triggers write keep the routing queue fresh. The order code only: no customer or reason text.
 */
export async function notifyStaffShopGaveUp(
  tx: Tx,
  info: {
    orderId: string;
    shopId: string;
    cityId: string;
    reasonCode: AssignmentGiveUpReason;
    version: number;
  },
): Promise<void> {
  await queueStaffOrderNotice(tx, {
    kind: 'staff.shop_gave_up',
    orderId: info.orderId,
    version: info.version,
  });
}
