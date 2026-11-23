import { and, eq, inArray } from 'drizzle-orm';
import type { OrderStatus } from '@mechdost/shared/state';
import { orderAssignments, orderGroups, orders } from '../schema';
import { queueStaffNotice, resolveNotices, type StaffNoticeKind } from './notices';
import type { Tx } from './orders';

/**
 * Staff notices about one order (spec 10, design 2026-11-15): "needs routing", "a shop declined / did not respond /
 * gave the order back". Each runs inside the transaction of the change it announces and tells the staff who can route
 * orders in the order's city. Only the order code travels in the text (no customer or shop details).
 */
export async function queueStaffOrderNotice(
  tx: Tx,
  input: {
    kind: Extract<StaffNoticeKind, 'staff.shop_declined' | 'staff.shop_timed_out' | 'staff.shop_gave_up'>;
    orderId: string;
    version: number;
  },
): Promise<void> {
  const [row] = await tx
    .select({ code: orderGroups.code, cityId: orders.cityId })
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!row) return;
  await queueStaffNotice(tx, {
    kind: input.kind,
    cityId: row.cityId,
    entityId: input.orderId,
    version: input.version,
    params: { orderCode: row.code },
  });
}

/** A checkout is placed (cash on delivery, or paid online): its orders now wait for routing. One notice per checkout. */
export async function queueStaffOrderPlaced(tx: Tx, groupId: string): Promise<void> {
  // Nothing to route (the orders were cancelled or rejected before this ran): no notice that could never be cleared.
  if (!(await groupAwaitsRouting(tx, groupId))) return;
  const [row] = await tx
    .select({ code: orderGroups.code, cityId: orders.cityId })
    .from(orderGroups)
    .innerJoin(orders, eq(orders.groupId, orderGroups.id))
    .where(eq(orderGroups.id, groupId))
    .limit(1);
  if (!row) return;
  await queueStaffNotice(tx, {
    kind: 'staff.order_needs_routing',
    cityId: row.cityId,
    entityId: groupId,
    version: 1,
    params: { orderCode: row.code },
  });
}

const AWAITING_ROUTING = ['placed', 'needs_rerouting'] as const satisfies readonly OrderStatus[];

/** Does any order of the checkout still wait for staff to pick a shop (first routing or a new shop)? */
async function groupAwaitsRouting(tx: Tx, groupId: string): Promise<boolean> {
  const n = await tx.$count(
    orders,
    and(eq(orders.groupId, groupId), inArray(orders.status, [...AWAITING_ROUTING])),
  );
  return n > 0;
}

/**
 * Clears the notices that asked someone to act on an order the moment that action stops being needed. Called by
 * `transitionOrder` right after the status change, in the same transaction (every order move goes through it):
 * - the order left `placed` / `needs_rerouting` (routed, rejected or cancelled, also by payment expiry): staff
 *   "shop declined / did not respond / gave the order back" for it are done; "needs routing" is done once no order of
 *   the checkout waits for a shop any more;
 * - the order left `awaiting_shop` (accepted, declined, expired, cancelled): the shop's "new order" and "offer ends soon"
 *   notices for its assignments are done, for every person of the shop.
 */
export async function resolveOrderNotices(
  tx: Tx,
  input: { orderId: string; groupId: string; from: OrderStatus },
): Promise<void> {
  if (AWAITING_ROUTING.some((s) => s === input.from)) {
    await resolveNotices(tx, {
      kinds: ['staff.shop_declined', 'staff.shop_timed_out', 'staff.shop_gave_up'],
      entityIds: [input.orderId],
    });
    if (!(await groupAwaitsRouting(tx, input.groupId)))
      await resolveNotices(tx, { kinds: ['staff.order_needs_routing'], entityIds: [input.groupId] });
  }
  if (input.from === 'awaiting_shop') {
    const offers = await tx
      .select({ id: orderAssignments.id })
      .from(orderAssignments)
      .where(eq(orderAssignments.orderId, input.orderId));
    await resolveNotices(tx, {
      kinds: ['shop.order_routed', 'shop.offer_expiring'],
      entityIds: offers.map((o) => o.id),
      prefixed: true,
    });
  }
}
