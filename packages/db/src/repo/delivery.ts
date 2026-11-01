import { randomInt } from 'node:crypto';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { decryptField, encryptField, safeEqual, type Keyring } from '../crypto';
import { auditLog, shipments } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * Proof of delivery (decision 2026-11-01, "like any e-commerce site"): when an order goes out for delivery the
 * customer gets a 4-digit code; the delivery person enters it to mark the shipment delivered. The code is stored
 * encrypted (the customer can see it again), compared in constant time, and locked after 5 wrong tries. Admins can
 * confirm without the code only with a reason, audited in the same transaction. A DB CHECK refuses "delivered"
 * without one of the two proofs. The caller moves the order to `delivered` in the same transaction.
 */
export const DELIVERY_CODE_MAX_ATTEMPTS = 5;
const AAD = 'shipments.delivery_code_enc';

/** Issues (or re-issues) the code for a shipment that is not yet delivered; returns it for the customer only. */
export async function issueDeliveryCode(db: Tx, keyring: Keyring, shipmentId: string): Promise<string> {
  const code = String(randomInt(0, 10_000)).padStart(4, '0');
  const rows = await db
    .update(shipments)
    .set({ deliveryCodeEnc: encryptField(code, keyring, AAD), deliveryCodeAttempts: 0 })
    .where(and(eq(shipments.id, shipmentId), ne(shipments.status, 'delivered')))
    .returning({ id: shipments.id });
  if (rows.length === 0) throw new ConflictError('This shipment is already delivered', 'ALREADY_DELIVERED');
  return code;
}

/** The customer's code, decrypted for their own order page (actor-scoped by the caller). */
export async function deliveryCodeFor(db: Tx, keyring: Keyring, shipmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ enc: shipments.deliveryCodeEnc, status: shipments.status })
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  if (!row?.enc || row.status === 'delivered') return null;
  return decryptField(row.enc, keyring, AAD);
}

export type DeliveryCheck =
  { ok: true } | { ok: false; reason: 'wrong'; attemptsLeft: number } | { ok: false; reason: 'locked' };

export async function verifyDeliveryCode(
  db: Tx,
  keyring: Keyring,
  shipmentId: string,
  entered: string,
): Promise<DeliveryCheck> {
  if (!/^\d{4}$/.test(entered)) throw new ValidationError('Enter the 4-digit code', 'DELIVERY_CODE_FORMAT');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        enc: shipments.deliveryCodeEnc,
        attempts: shipments.deliveryCodeAttempts,
        status: shipments.status,
      })
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
    if (!row) throw new NotFoundError('Shipment not found');
    if (row.status === 'delivered') return { ok: true };
    if (!row.enc) throw new ConflictError('No delivery code was issued', 'NO_DELIVERY_CODE');
    if (row.attempts >= DELIVERY_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

    if (safeEqual(entered, decryptField(row.enc, keyring, AAD))) {
      const done = await tx
        .update(shipments)
        .set({ status: 'delivered', deliveredVia: 'code', deliveredAt: sql`now()` })
        .where(
          and(
            eq(shipments.id, shipmentId),
            ne(shipments.status, 'delivered'),
            lt(shipments.deliveryCodeAttempts, DELIVERY_CODE_MAX_ATTEMPTS),
          ),
        )
        .returning({ id: shipments.id });
      return done.length > 0 ? { ok: true } : { ok: false, reason: 'locked' };
    }

    // Wrong code: count it with compare-and-set so parallel guesses cannot exceed the limit.
    const [counted] = await tx
      .update(shipments)
      .set({ deliveryCodeAttempts: row.attempts + 1 })
      .where(and(eq(shipments.id, shipmentId), eq(shipments.deliveryCodeAttempts, row.attempts)))
      .returning({ attempts: shipments.deliveryCodeAttempts });
    const attempts = counted?.attempts ?? DELIVERY_CODE_MAX_ATTEMPTS;
    return attempts >= DELIVERY_CODE_MAX_ATTEMPTS
      ? { ok: false, reason: 'locked' }
      : { ok: false, reason: 'wrong', attemptsLeft: DELIVERY_CODE_MAX_ATTEMPTS - attempts };
  });
}

/** Staff confirm delivery without the code (customer unreachable, code lost or locked). Audited atomically. */
export async function overrideDelivery(
  db: Tx,
  input: { shipmentId: string; staffUserId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new ValidationError('Give a reason (5 to 300 characters)', 'OVERRIDE_REASON');
  }
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(shipments)
      .set({
        status: 'delivered',
        deliveredVia: 'override',
        deliveredAt: sql`now()`,
        overrideReason: reason,
        overrideBy: input.staffUserId,
      })
      .where(and(eq(shipments.id, input.shipmentId), ne(shipments.status, 'delivered')))
      .returning({ id: shipments.id });
    if (rows.length === 0) throw new ConflictError('This shipment is already delivered', 'ALREADY_DELIVERED');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery.override',
      entity: 'shipment',
      entityId: input.shipmentId,
      after: { deliveredVia: 'override' },
    });
  });
}
