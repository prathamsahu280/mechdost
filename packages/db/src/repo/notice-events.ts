import { eq } from 'drizzle-orm';
import { orderGroups, orders } from '../schema';
import { queueStaffNotice, type StaffNoticeKind } from './notices';
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
