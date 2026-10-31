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
  if (!Number.isInteger(args.qty) || args.qty < 1 || args.qty > 99) throw new ValidationError('qty must be 1..99');
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
  return r!;
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
    .set({ onHand: sql`${shopInventory.onHand} - ${r.qty}`, reserved: sql`${shopInventory.reserved} - ${r.qty}` })
    .where(eq(shopInventory.id, r.inventoryId));
  return true;
}

/** Release a reservation (cancel/decline). Idempotent. */
export async function releaseReservation(tx: Tx, reservationId: string, to: 'released' | 'expired' = 'released') {
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

/** TTL job: expire every active reservation past its expiry (DB clock). Safe to run concurrently/twice. */
export async function releaseExpiredReservations(tx: Tx) {
  const due = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.status, 'active'), lte(reservations.expiresAt, sql`now()`)));
  let released = 0;
  for (const r of due) if (await releaseReservation(tx, r.id, 'expired')) released++;
  return released;
}
