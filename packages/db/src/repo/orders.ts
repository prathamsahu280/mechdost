import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { orderMachine, type OrderStatus } from '@mechdost/shared/state';
import { orders } from '../schema';
import { setActor, type ActorContext } from './actor';
import { ConflictError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = PgDatabase<PgQueryResultHKT, any, any>;

type OrderPatch = Partial<Pick<typeof orders.$inferInsert, 'shopId' | 'confirmedAt' | 'deliveredAt'>>;

/**
 * The only way to change an order's status (docs/specs/14-data-integrity.md):
 * 1. the state machine checks the move and the actor;
 * 2. a conditional UPDATE … WHERE status = $from AND version = $expected applies it atomically;
 * 3. zero rows updated ⇒ someone else changed it first ⇒ ConflictError (HTTP 409).
 * The `orders_status_event` trigger writes the timeline row; the bump_version trigger increments `version`.
 */
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
  return row;
}
