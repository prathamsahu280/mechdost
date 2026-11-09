import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { reservations, shopInventory } from '../schema';
import { ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * Reserve stock atomically (docs/research/data-integrity.md §3). Never read-then-write: the conditional
 * UPDATE only succeeds while on_hand - reserved >= qty, and the CHECK constraint is the last line of defence.
 * Returns the reservation, or null when there is not enough stock.
 */
export async function reserveStock(
  tx: Tx,
  args: { inventoryId: string; orderId: string; qty: number; ttlMinutes?: number },
) {
  if (!Number.isInteger(args.qty) || args.qty < 1 || args.qty > 99)
    throw new ValidationError('qty must be 1..99');
  const ttl = args.ttlMinutes ?? 15;
  const updated = await tx
    .update(shopInventory)
    .set({ reserved: sql`${shopInventory.reserved} + ${args.qty}` })
    .where(
      and(
        eq(shopInventory.id, args.inventoryId),
        eq(shopInventory.active, true),
        gte(sql`${shopInventory.onHand} - ${shopInventory.reserved}`, args.qty),
      ),
    )
    .returning({ id: shopInventory.id });
  if (updated.length === 0) return null;
  const [r] = await tx
    .insert(reservations)
    .values({
      orderId: args.orderId,
      inventoryId: args.inventoryId,
      qty: args.qty,
      createdAt: sql`now()`,
      expiresAt: sql`now() + make_interval(mins => ${ttl})`,
    })
    .returning();
  if (!r) throw new Error('reservation insert returned no row');
  return r;
}

/** Convert a reservation into a sale (shop accepted / payment captured). Idempotent. */
export async function commitReservation(tx: Tx, reservationId: string) {
  const [r] = await tx
    .update(reservations)
    .set({ status: 'committed' })
    .where(and(eq(reservations.id, reservationId), eq(reservations.status, 'active')))
    .returning();
  if (!r) return false;
  await tx
    .update(shopInventory)
    .set({
      onHand: sql`${shopInventory.onHand} - ${r.qty}`,
      reserved: sql`${shopInventory.reserved} - ${r.qty}`,
    })
    .where(eq(shopInventory.id, r.inventoryId));
  return true;
}

/** Release a reservation (cancel/decline). Idempotent. */
export async function releaseReservation(
  tx: Tx,
  reservationId: string,
  to: 'released' | 'expired' = 'released',
) {
  const [r] = await tx
    .update(reservations)
    .set({ status: to })
    .where(and(eq(reservations.id, reservationId), eq(reservations.status, 'active')))
    .returning();
  if (!r) return false;
  await tx
    .update(shopInventory)
    .set({ reserved: sql`${shopInventory.reserved} - ${r.qty}` })
    .where(eq(shopInventory.id, r.inventoryId));
  return true;
}

/**
 * Hold-expiry job (worker, every 60 s; spec 04): frees active holds past their DB-clock expiry, so stock held by
 * an order nobody routed or accepted goes back on sale. One transaction per hold, locking the **order row first**
 * (spec 14 lock order — the same order as accept and cancel, so they cannot deadlock), and a failure on one hold
 * never blocks the rest. Accepting later re-reserves a lapsed hold or is refused (`acceptShopOffer`). Safe to run
 * concurrently or twice: `releaseReservation` is a compare-and-set on `status = 'active'`.
 */
export async function releaseExpiredReservations(
  db: Tx,
  limit = 100,
): Promise<{ released: number; failed: { reservationId: string; error: unknown }[] }> {
  const due = await db
    .select({ id: reservations.id, orderId: reservations.orderId })
    .from(reservations)
    .where(and(eq(reservations.status, 'active'), lte(reservations.expiresAt, sql`now()`)))
    .orderBy(reservations.expiresAt)
    .limit(limit);
  let released = 0;
  const failed: { reservationId: string; error: unknown }[] = [];
  for (const r of due) {
    try {
      const done = await db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from orders where id = ${r.orderId} for update`);
        return releaseReservation(tx, r.id, 'expired');
      });
      if (done) released += 1;
    } catch (error) {
      failed.push({ reservationId: r.id, error });
    }
  }
  return { released, failed };
}
