import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  DeliverySwitchDeclineReason,
  DeliverySwitchReason,
  ShopDeliveryMode,
  ShopModeRejectReason,
  ShopModeRequestReason,
} from '@mechdost/shared/delivery/codes';
import { cities, orderDeliverySwitches, orders, shopDeliveryModeRequests, shops } from '../schema';
import { auditDelivery, deliverySettings } from './delivery-common';
import { cancelActiveDeliveryJob } from './delivery-jobs';
import { ConflictError, NotFoundError, ValidationError, pgCode } from './errors';
import { recordServerEvent } from './events';
import { queueNotice, queueStaffNotice } from './notices';
import { lockOrder, transitionOrder, type Tx } from './orders';
import type { CityScope } from './routing';
import { shopUsers } from '../schema';

/**
 * Who delivers (spec 24; Lead's calls 3, 9, 11): a shop's standing mode (`agents` | `self`) is staff-set only — the
 * shop asks, staff approve or reject with a reason, and every change is kept as a row (history). Staff can also ask
 * the shop to deliver one agent-mode sub-order itself; the shop confirms (the sub-order becomes `shop` mode and, if it
 * was ready for pickup, goes back to packed) or declines (back to staff).
 */

const inScope = (scope: CityScope, cityId: string) => scope.all || scope.cityIds.includes(cityId);

async function members(tx: Tx, shopId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: shopUsers.userId })
    .from(shopUsers)
    .where(eq(shopUsers.shopId, shopId));
  return [...new Set(rows.map((r) => r.userId))];
}

export async function getShopDeliveryMode(db: Tx, input: { shopIds: readonly string[]; shopId: string }) {
  if (!input.shopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  const [shop] = await db
    .select({ mode: shops.deliveryMode, cityId: shops.cityId })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) throw new NotFoundError('Shop not found');
  const settings = await deliverySettings(db, shop.cityId);
  const requests = await db
    .select()
    .from(shopDeliveryModeRequests)
    .where(eq(shopDeliveryModeRequests.shopId, input.shopId))
    .orderBy(desc(shopDeliveryModeRequests.createdAt))
    .limit(20);
  return {
    mode: shop.mode as ShopDeliveryMode,
    agentsEnabled: settings.agentsEnabled,
    requests: requests.map((r) => ({
      id: r.id,
      requestedMode: r.requestedMode as ShopDeliveryMode,
      reasonCode: r.reasonCode,
      note: r.note,
      status: r.status,
      decisionReason: r.decisionReason,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      version: r.version,
    })),
  };
}

/** The shop asks to deliver itself (or to go back to agents); one pending request per shop. */
export async function requestShopDeliveryMode(
  db: Tx,
  input: {
    shopIds: readonly string[];
    shopId: string;
    staffUserId: string;
    requestedMode: ShopDeliveryMode;
    reasonCode: ShopModeRequestReason;
    note?: string | undefined;
  },
): Promise<{ id: string }> {
  if (!input.shopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  return db.transaction(async (tx) => {
    const [shop] = await tx
      .select({ mode: shops.deliveryMode, cityId: shops.cityId })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for('share');
    if (!shop) throw new NotFoundError('Shop not found');
    if (shop.mode === input.requestedMode)
      throw new ConflictError('The shop already works this way', 'SAME_MODE');
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(shopDeliveryModeRequests)
          .values({
            shopId: input.shopId,
            requestedMode: input.requestedMode,
            reasonCode: input.reasonCode,
            note: input.note ?? null,
            requestedBy: input.staffUserId,
          })
          .returning({ id: shopDeliveryModeRequests.id }),
      );
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictError('A request is already waiting', 'REQUEST_PENDING');
      throw err;
    }
    if (!row) throw new Error('request insert returned no row');
    await queueStaffNotice(tx, {
      kind: 'staff.shop_delivery_mode_request',
      cityId: shop.cityId,
      entityId: row.id,
      version: 1,
    });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'shop',
      action: 'shop.delivery_mode_requested',
      entity: 'shop',
      entityId: input.shopId,
      after: { requestedMode: input.requestedMode, reasonCode: input.reasonCode },
    });
    await recordServerEvent(tx, 'shop_delivery_mode_requested', {
      userId: input.staffUserId,
      cityId: shop.cityId,
      props: { shopId: input.shopId, requestedMode: input.requestedMode, reasonCode: input.reasonCode },
    });
    return row;
  });
}

export async function withdrawShopDeliveryModeRequest(
  db: Tx,
  input: { shopIds: readonly string[]; requestId: string; staffUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(shopDeliveryModeRequests)
      .where(eq(shopDeliveryModeRequests.id, input.requestId))
      .for('update');
    if (!r || !input.shopIds.includes(r.shopId)) throw new NotFoundError('Request not found');
    const done = await tx
      .update(shopDeliveryModeRequests)
      .set({ status: 'withdrawn', decidedAt: sql`now()` })
      .where(and(eq(shopDeliveryModeRequests.id, r.id), eq(shopDeliveryModeRequests.status, 'pending')))
      .returning({ id: shopDeliveryModeRequests.id });
    if (done.length === 0)
      throw new ConflictError('Only a waiting request can be withdrawn', 'REQUEST_DECIDED');
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'shop',
      action: 'shop.delivery_mode_withdrawn',
      entity: 'shop',
      entityId: r.shopId,
    });
  });
}

export async function listShopModeRequests(
  db: Tx,
  input: { scope: CityScope; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; limit: number },
) {
  const rows = await db
    .select({
      r: shopDeliveryModeRequests,
      shopName: shops.name,
      cityId: shops.cityId,
      cityCode: cities.code,
      currentMode: shops.deliveryMode,
    })
    .from(shopDeliveryModeRequests)
    .innerJoin(shops, eq(shops.id, shopDeliveryModeRequests.shopId))
    .innerJoin(cities, eq(cities.id, shops.cityId))
    .where(eq(shopDeliveryModeRequests.status, input.status))
    .orderBy(desc(shopDeliveryModeRequests.createdAt))
    .limit(500);
  return rows
    .filter((x) => inScope(input.scope, x.cityId))
    .slice(0, input.limit)
    .map((x) => ({
      id: x.r.id,
      shopId: x.r.shopId,
      shopName: x.shopName,
      cityCode: x.cityCode,
      currentMode: x.currentMode as ShopDeliveryMode,
      requestedMode: x.r.requestedMode as ShopDeliveryMode,
      reasonCode: x.r.reasonCode,
      note: x.r.note,
      status: x.r.status,
      decisionReason: x.r.decisionReason,
      createdAt: x.r.createdAt,
      decidedAt: x.r.decidedAt,
      version: x.r.version,
    }));
}

async function applyShopMode(tx: Tx, shopId: string, mode: ShopDeliveryMode): Promise<void> {
  await tx.update(shops).set({ deliveryMode: mode }).where(eq(shops.id, shopId));
}

/** Staff approve or reject a shop's request (history kept; the shop is told). */
export async function decideShopModeRequest(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    requestId: string;
    decision: 'approved' | 'rejected';
    reasonCode?: ShopModeRejectReason | undefined;
    note?: string | undefined;
    expectedVersion: number;
  },
): Promise<void> {
  if (input.decision === 'rejected' && !input.reasonCode)
    throw new ValidationError('Pick a reason', 'REASON_REQUIRED');
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(shopDeliveryModeRequests)
      .where(eq(shopDeliveryModeRequests.id, input.requestId))
      .for('update');
    if (!r) throw new NotFoundError('Request not found');
    const [shop] = await tx
      .select({ cityId: shops.cityId })
      .from(shops)
      .where(eq(shops.id, r.shopId))
      .for('update');
    if (!shop || !inScope(input.scope, shop.cityId)) throw new NotFoundError('Request not found');
    const done = await tx
      .update(shopDeliveryModeRequests)
      .set({
        status: input.decision,
        decisionReason: input.decision === 'rejected' ? (input.reasonCode ?? null) : null,
        decisionNote: input.note ?? null,
        decidedBy: input.staffUserId,
        decidedAt: sql`now()`,
      })
      .where(
        and(
          eq(shopDeliveryModeRequests.id, r.id),
          eq(shopDeliveryModeRequests.status, 'pending'),
          eq(shopDeliveryModeRequests.version, input.expectedVersion),
        ),
      )
      .returning({ version: shopDeliveryModeRequests.version });
    if (done.length === 0) throw new ConflictError('This request changed meanwhile', 'STALE');
    if (input.decision === 'approved') await applyShopMode(tx, r.shopId, r.requestedMode as ShopDeliveryMode);
    for (const userId of await members(tx, r.shopId))
      await queueNotice(tx, {
        kind: 'shop.delivery_mode_decided',
        userId,
        entityId: r.id,
        version: done[0]?.version ?? 0,
        params: {},
      });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `shop.delivery_mode_${input.decision}`,
      entity: 'shop',
      entityId: r.shopId,
      after: { requestedMode: r.requestedMode, reasonCode: input.reasonCode ?? null },
    });
    await recordServerEvent(tx, 'shop_delivery_mode_decided', {
      userId: input.staffUserId,
      cityId: shop.cityId,
      props: {
        shopId: r.shopId,
        mode: r.requestedMode,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
      },
    });
  });
}

/** Staff set or revoke a shop's mode directly (recorded as an approved `staff` row, so history stays in one place). */
export async function setShopDeliveryMode(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    shopId: string;
    mode: ShopDeliveryMode;
    note: string;
    expectedVersion: number;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [shop] = await tx
      .select({ cityId: shops.cityId, mode: shops.deliveryMode, version: shops.version })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for('update');
    if (!shop || !inScope(input.scope, shop.cityId)) throw new NotFoundError('Shop not found');
    if (shop.version !== input.expectedVersion)
      throw new ConflictError('The shop changed meanwhile', 'STALE');
    if (shop.mode === input.mode) return { version: shop.version };
    const [row] = await tx
      .update(shops)
      .set({ deliveryMode: input.mode })
      .where(and(eq(shops.id, input.shopId), eq(shops.version, input.expectedVersion)))
      .returning({ version: shops.version });
    if (!row) throw new ConflictError('The shop changed meanwhile', 'STALE');
    // A pending shop request is settled by this decision.
    await tx
      .update(shopDeliveryModeRequests)
      .set({ status: 'withdrawn', decidedBy: input.staffUserId, decidedAt: sql`now()` })
      .where(
        and(
          eq(shopDeliveryModeRequests.shopId, input.shopId),
          eq(shopDeliveryModeRequests.status, 'pending'),
        ),
      );
    await tx.insert(shopDeliveryModeRequests).values({
      shopId: input.shopId,
      requestedMode: input.mode,
      source: 'staff',
      note: input.note,
      status: 'approved',
      requestedBy: input.staffUserId,
      decidedBy: input.staffUserId,
      decidedAt: new Date(),
    });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'shop.delivery_mode_set',
      entity: 'shop',
      entityId: input.shopId,
      after: { from: shop.mode, to: input.mode },
      reason: input.note,
    });
    await recordServerEvent(tx, 'shop_delivery_mode_decided', {
      userId: input.staffUserId,
      cityId: shop.cityId,
      props: { shopId: input.shopId, mode: input.mode, decision: 'set', reasonCode: null },
    });
    return { version: row.version };
  });
}

// ── one sub-order switched to the shop's own delivery (Lead's call 9) ─────────────────────────────────────────────

export async function requestDeliverySwitch(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    orderCode: string;
    reasonCode: DeliverySwitchReason;
    note?: string | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const [probe] = await tx
      .select({ id: orders.id, cityId: orders.cityId, shopId: orders.shopId, mode: orders.deliveryMode })
      .from(orders)
      .where(eq(orders.code, input.orderCode))
      .limit(1);
    const shopId = probe?.shopId;
    if (!probe || !shopId || !inScope(input.scope, probe.cityId)) throw new NotFoundError('Order not found');
    const o = await lockOrder(tx, probe.id);
    if (probe.mode !== 'agent' || !['confirmed', 'packed', 'ready_for_pickup'].includes(o.status))
      throw new ConflictError('Only an agent-mode order before pickup can be switched', 'NOT_SWITCHABLE');
    let row;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(orderDeliverySwitches)
          .values({
            orderId: probe.id,
            shopId,
            reasonCode: input.reasonCode,
            note: input.note ?? null,
            requestedBy: input.staffUserId,
          })
          .returning(),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('A switch is already waiting for the shop', 'SWITCH_PENDING');
      throw err;
    }
    if (!row) throw new Error('switch insert returned no row');
    for (const userId of await members(tx, shopId))
      await queueNotice(tx, {
        kind: 'shop.delivery_switch',
        userId,
        entityId: row.id,
        version: 1,
        params: { orderCode: input.orderCode },
      });
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'order.delivery_switch_requested',
      entity: 'order',
      entityId: probe.id,
      after: { reasonCode: input.reasonCode },
    });
    await recordServerEvent(tx, 'delivery_switch_requested', {
      userId: input.staffUserId,
      cityId: probe.cityId,
      props: { orderCode: input.orderCode, reasonCode: input.reasonCode },
    });
    return {
      id: row.id,
      orderCode: input.orderCode,
      status: row.status,
      reasonCode: input.reasonCode,
      declineReason: null,
      createdAt: row.createdAt,
      version: row.version,
    };
  });
}

/** The shop answers a switch: confirm (deliver itself) or decline with a reason (back to staff). */
export async function answerDeliverySwitch(
  db: Tx,
  input: {
    shopIds: readonly string[];
    staffUserId: string;
    orderCode: string;
    switchId: string;
    decision: 'confirmed' | 'declined';
    reasonCode?: DeliverySwitchDeclineReason | undefined;
    note?: string | undefined;
    expectedVersion: number;
  },
): Promise<void> {
  if (input.decision === 'declined' && !input.reasonCode)
    throw new ValidationError('Pick a reason', 'REASON_REQUIRED');
  await db.transaction(async (tx) => {
    const [probe] = await tx
      .select({ id: orders.id, code: orders.code, cityId: orders.cityId, shopId: orders.shopId })
      .from(orders)
      .where(eq(orders.code, input.orderCode))
      .limit(1);
    if (!probe?.shopId || !input.shopIds.includes(probe.shopId)) throw new NotFoundError('Order not found');
    const o = await lockOrder(tx, probe.id);
    const [sw] = await tx
      .select()
      .from(orderDeliverySwitches)
      .where(and(eq(orderDeliverySwitches.id, input.switchId), eq(orderDeliverySwitches.orderId, probe.id)))
      .for('update');
    if (!sw) throw new NotFoundError('Request not found');
    const done = await tx
      .update(orderDeliverySwitches)
      .set({
        status: input.decision,
        declineReason: input.decision === 'declined' ? (input.reasonCode ?? null) : null,
        declineNote: input.note ?? null,
        decidedBy: input.staffUserId,
        decidedAt: sql`now()`,
      })
      .where(
        and(
          eq(orderDeliverySwitches.id, sw.id),
          eq(orderDeliverySwitches.status, 'requested'),
          eq(orderDeliverySwitches.version, input.expectedVersion),
        ),
      )
      .returning({ id: orderDeliverySwitches.id });
    if (done.length === 0) throw new ConflictError('This request changed meanwhile', 'STALE');
    if (input.decision === 'confirmed') {
      if (!['confirmed', 'packed', 'ready_for_pickup'].includes(o.status))
        throw new ConflictError('The parcel is already with an agent', 'NOT_SWITCHABLE');
      await cancelActiveDeliveryJob(tx, {
        orderId: probe.id,
        reason: 'switched_to_shop',
        actor: 'shop',
        actorId: input.staffUserId,
      });
      if (o.status === 'ready_for_pickup')
        await transitionOrder(tx, {
          orderId: probe.id,
          from: 'ready_for_pickup',
          to: 'packed',
          expectedVersion: o.version,
          actor: { type: 'shop', userId: input.staffUserId },
          patch: { deliveryMode: 'shop' },
        });
      else
        await tx
          .update(orders)
          .set({ deliveryMode: 'shop' })
          .where(and(eq(orders.id, probe.id), eq(orders.version, o.version)));
    } else {
      await queueStaffNotice(tx, {
        kind: 'staff.delivery_switch_declined',
        cityId: probe.cityId,
        entityId: sw.id,
        version: 2,
        params: { orderCode: probe.code },
      });
    }
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'shop',
      action: `order.delivery_switch_${input.decision}`,
      entity: 'order',
      entityId: probe.id,
      after: { reasonCode: input.reasonCode ?? null },
    });
    await recordServerEvent(tx, 'delivery_switch_decided', {
      userId: input.staffUserId,
      cityId: probe.cityId,
      props: { orderCode: probe.code, decision: input.decision, reasonCode: input.reasonCode ?? null },
    });
  });
}
