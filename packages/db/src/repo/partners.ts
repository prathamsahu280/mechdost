import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { auditLog, partnerStatusEvents, shops } from '../schema';
import { ConflictError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * Partner standing (decision 2026-11-01; research/admin-console.md "availability vs standing"): staff pause,
 * suspend or reactivate a shop with a partner-visible reason. One transaction: compare-and-set on `version`, an
 * append-only `partner_status_events` row and an audit entry. Permission `partners:approve` is checked in the API.
 * Paused/suspended shops are excluded from routing by `status = 'approved'` filters; in-flight orders continue.
 */
export type Standing = 'approved' | 'paused' | 'suspended';

const ALLOWED: Record<string, readonly Standing[]> = {
  approved: ['paused', 'suspended'],
  paused: ['approved', 'suspended'],
  suspended: ['approved'],
};

export async function setShopStanding(
  db: Tx,
  input: {
    shopId: string;
    to: Standing;
    reason: string;
    staffUserId: string;
    expectedVersion: number;
    internalNote?: string;
    pausedUntil?: Date | null;
  },
): Promise<{ version: number }> {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new ValidationError('Give a reason the partner will see (5 to 300 characters)', 'STATUS_REASON');
  }
  if (input.pausedUntil && input.to !== 'paused') {
    throw new ValidationError('Only a pause can have an end date', 'STATUS_ENDS_AT');
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: shops.status, version: shops.version })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1);
    if (!current) throw new ConflictError('Shop not found', 'NOT_FOUND');
    if (!(ALLOWED[current.status] ?? []).includes(input.to)) {
      throw new ConflictError(`A ${current.status} shop cannot become ${input.to}`, 'STATUS_TRANSITION');
    }
    const [updated] = await tx
      .update(shops)
      .set({
        status: input.to,
        statusReason: reason,
        statusChangedBy: input.staffUserId,
        statusChangedAt: sql`now()`,
        pausedUntil: input.to === 'paused' ? (input.pausedUntil ?? null) : null,
        version: sql`${shops.version} + 1`,
      })
      .where(and(eq(shops.id, input.shopId), eq(shops.version, input.expectedVersion)))
      .returning({ version: shops.version });
    if (!updated)
      throw new ConflictError('Someone else changed this shop; reload and try again', 'STALE_VERSION');

    await tx.insert(partnerStatusEvents).values({
      partnerKind: 'shop',
      partnerId: input.shopId,
      fromStatus: current.status,
      toStatus: input.to,
      reason,
      internalNote: input.internalNote?.trim() ? input.internalNote.trim() : null,
      endsAt: input.to === 'paused' ? (input.pausedUntil ?? null) : null,
      changedBy: input.staffUserId,
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'partner.status_changed',
      entity: 'shop',
      entityId: input.shopId,
      before: { status: current.status },
      after: { status: input.to },
    });
    return updated;
  });
}

/**
 * Background sweep (worker): pauses with an end date resume by themselves once it has passed (Q28, user
 * 2026-11-13). Each shop is resumed with a compare-and-set on its version, so a staff change at the same moment
 * wins; the history row names the staff member who set the pause (it was their scheduled end), the audit entry is
 * the system. Returns how many shops resumed.
 */
export async function resumeEndedPauses(db: Tx, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: shops.id, version: shops.version, by: shops.statusChangedBy })
    .from(shops)
    .where(and(eq(shops.status, 'paused'), isNotNull(shops.pausedUntil), lte(shops.pausedUntil, now)));
  let resumed = 0;
  for (const shop of due) {
    const done = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(shops)
        .set({
          status: 'approved',
          statusReason: 'The pause ended',
          statusChangedAt: sql`now()`,
          pausedUntil: null,
          version: sql`${shops.version} + 1`,
        })
        .where(and(eq(shops.id, shop.id), eq(shops.version, shop.version), eq(shops.status, 'paused')))
        .returning({ id: shops.id });
      if (!updated) return false;
      if (shop.by)
        await tx.insert(partnerStatusEvents).values({
          partnerKind: 'shop',
          partnerId: shop.id,
          fromStatus: 'paused',
          toStatus: 'approved',
          reason: 'The pause ended',
          changedBy: shop.by,
        });
      await tx.insert(auditLog).values({
        actorUserId: null,
        actorRole: 'system',
        action: 'partner.pause_ended',
        entity: 'shop',
        entityId: shop.id,
        before: { status: 'paused' },
        after: { status: 'approved' },
      });
      return true;
    });
    if (done) resumed += 1;
  }
  return resumed;
}
