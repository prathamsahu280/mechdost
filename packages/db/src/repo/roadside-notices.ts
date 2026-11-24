import { eq } from 'drizzle-orm';
import { userRoles } from '../schema';
import { queueNotice } from './notices';
import type { Tx } from './orders';

/**
 * Roadside notices (spec 10, spec 22). Bell plus push through `queueNotice`, inside the transaction of the change they
 * announce (a rolled-back change never notifies). Texts carry codes and the workshop name the customer already sees;
 * never the arrival code, an address or an amount (lock-screen rule). WhatsApp and email templates for roadside are
 * not built in phase 1 (the Meta templates need approval first; spec 22 "Not built").
 */
export async function queueRsaCustomerNotice(
  tx: Tx,
  input: {
    kind: 'rsa.accepted' | 'rsa.arrived' | 'rsa.bill_ready';
    requestId: string;
    userId: string;
    code: string;
    workshopName: string;
    version: number;
  },
): Promise<void> {
  await queueNotice(tx, {
    kind: input.kind,
    userId: input.userId,
    entityId: input.requestId,
    version: input.version,
    params: { requestCode: input.code, workshopName: input.workshopName },
  });
}

export async function queueRsaRefundedNotice(
  tx: Tx,
  input: { requestId: string; userId: string; code: string; refundId: string },
): Promise<void> {
  await queueNotice(tx, {
    kind: 'rsa.refunded',
    userId: input.userId,
    entityId: input.requestId,
    version: input.refundId,
    params: { requestCode: input.code },
  });
}

/** An offer reaches every person who runs the workshop's roadside jobs (push + bell). */
export async function queueRsaOfferNotice(
  tx: Tx,
  input: { requestId: string; offerId: string; workshopId: string; code: string; minutes: number },
): Promise<void> {
  const people = await tx
    .selectDistinct({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.workshopId, input.workshopId));
  for (const p of people)
    await queueNotice(tx, {
      kind: 'rsa.offer',
      userId: p.userId,
      entityId: input.requestId,
      version: input.offerId,
      params: { requestCode: input.code, minutes: input.minutes },
    });
}
