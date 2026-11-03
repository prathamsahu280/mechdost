import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import {
  CUSTOMER_BLOCK_LEVELS,
  CUSTOMER_BLOCK_REASONS,
  type CustomerBlockLevel,
  type CustomerBlockReason,
} from '@mechdost/shared/customers';
import { auditLog, customerBlocks, users } from '../schema';
import { ROLES } from '@mechdost/shared/rbac';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { loadGrants } from './rbac';
import type { Tx } from './orders';

/**
 * Customer blocks (shared/customers.ts, research/admin-console.md §5). Staff with `customers:block` (checked in
 * the API) block a customer at one level with a reason code; lifting needs a reason and compare-and-set on
 * `version`. Every change writes an audit row in the same transaction. Staff cannot block themselves.
 */
const STAFF_ROLES = new Set(
  Object.entries(ROLES)
    .filter(([, r]) => r.staff)
    .map(([key]) => key),
);

const active = and(
  isNull(customerBlocks.liftedAt),
  or(isNull(customerBlocks.endsAt), gt(customerBlocks.endsAt, sql`now()`)),
);

/** Levels currently in force for a user (not lifted, not expired). One indexed query. */
export async function activeBlockLevels(db: Tx, userId: string): Promise<CustomerBlockLevel[]> {
  const rows = await db
    .select({ level: customerBlocks.level })
    .from(customerBlocks)
    .where(and(eq(customerBlocks.userId, userId), active));
  return rows
    .map((r) => r.level)
    .filter((l): l is CustomerBlockLevel => (CUSTOMER_BLOCK_LEVELS as readonly string[]).includes(l));
}

export async function blockCustomer(
  db: Tx,
  input: {
    userId: string;
    level: CustomerBlockLevel;
    reasonCode: CustomerBlockReason;
    note: string | null;
    endsAt: Date | null;
    staffUserId: string;
  },
): Promise<{ id: string; version: number }> {
  if (!CUSTOMER_BLOCK_LEVELS.includes(input.level))
    throw new ValidationError('Unknown block level', 'BLOCK_LEVEL');
  if (!CUSTOMER_BLOCK_REASONS.includes(input.reasonCode))
    throw new ValidationError('Unknown reason', 'BLOCK_REASON');
  if (input.userId === input.staffUserId)
    throw new ValidationError('You cannot block yourself', 'BLOCK_SELF');
  if (input.endsAt && input.endsAt.getTime() <= Date.now())
    throw new ValidationError('The end date must be in the future', 'BLOCK_ENDS_AT');
  const note = input.note?.trim() ? input.note.trim() : null;
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId));
    if (!user) throw new NotFoundError('Customer not found');
    // Security review 2026-11-03: this is for customers. Staff access is removed by revoking roles (spec 13,
    // audited and four-eyes for offboarding), never by a block that could lock out another admin. Partner users
    // may lose ordering or COD, but a full block would cut off their portal: suspend the partner instead.
    const grants = await loadGrants(tx, input.userId);
    const isStaff = grants.some((g) => STAFF_ROLES.has(g.role));
    if (isStaff)
      throw new ForbiddenError('Staff accounts cannot be blocked; revoke their roles', 'BLOCK_NOT_CUSTOMER');
    if (input.level === 'full' && grants.some((g) => g.shopId !== null || g.workshopId !== null))
      throw new ValidationError(
        'Suspend the shop or workshop instead of fully blocking its user',
        'BLOCK_PARTNER_FULL',
      );
    // An expired, never-lifted block still holds the unique slot: close it first so a new one can start
    // (audited like any other change).
    const closed = await tx
      .update(customerBlocks)
      .set({
        liftedAt: sql`now()`,
        liftedBy: input.staffUserId,
        liftedReason: 'expired; replaced by a new block',
      })
      .where(
        and(
          eq(customerBlocks.userId, input.userId),
          eq(customerBlocks.level, input.level),
          isNull(customerBlocks.liftedAt),
          sql`${customerBlocks.endsAt} <= now()`,
        ),
      )
      .returning({ id: customerBlocks.id, version: customerBlocks.version });
    for (const c of closed)
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'staff',
        action: 'customer.block_expired_closed',
        entity: 'user',
        entityId: input.userId,
        after: { blockId: c.id, version: c.version, reason: 'expired; replaced by a new block' },
      });
    let row: { id: string; version: number } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(customerBlocks)
          .values({
            userId: input.userId,
            level: input.level,
            reasonCode: input.reasonCode,
            note,
            endsAt: input.endsAt,
            createdBy: input.staffUserId,
          })
          .returning({ id: customerBlocks.id, version: customerBlocks.version }),
      );
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('This customer already has a block at this level', 'ALREADY_BLOCKED');
      throw err;
    }
    if (!row) throw new Error('block insert returned no row');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'customer.blocked',
      entity: 'user',
      entityId: input.userId,
      after: { blockId: row.id, level: input.level, reasonCode: input.reasonCode, endsAt: input.endsAt },
      reason: input.reasonCode,
    });
    await recordServerEvent(tx, 'admin_customer_blocked', {
      userId: input.staffUserId,
      props: { customerId: input.userId, level: input.level, reasonCode: input.reasonCode },
    });
    return row;
  });
}

export async function liftCustomerBlock(
  db: Tx,
  input: { blockId: string; expectedVersion: number; reason: string; staffUserId: string },
): Promise<{ version: number }> {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300)
    throw new ValidationError('Say why the block is lifted (5 to 300 characters)', 'LIFT_REASON');
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customerBlocks)
      .set({ liftedAt: sql`now()`, liftedBy: input.staffUserId, liftedReason: reason })
      .where(
        and(
          eq(customerBlocks.id, input.blockId),
          eq(customerBlocks.version, input.expectedVersion),
          isNull(customerBlocks.liftedAt),
        ),
      )
      .returning({
        version: customerBlocks.version,
        userId: customerBlocks.userId,
        level: customerBlocks.level,
      });
    if (!updated) {
      const [exists] = await tx
        .select({ id: customerBlocks.id })
        .from(customerBlocks)
        .where(eq(customerBlocks.id, input.blockId));
      if (!exists) throw new NotFoundError('Block not found');
      throw new ConflictError('This block was changed or lifted meanwhile; reload', 'STALE_BLOCK');
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'customer.unblocked',
      entity: 'user',
      entityId: updated.userId,
      after: { blockId: input.blockId, level: updated.level },
      reason,
    });
    await recordServerEvent(tx, 'admin_customer_unblocked', {
      userId: input.staffUserId,
      props: { customerId: updated.userId, level: updated.level },
    });
    return { version: updated.version };
  });
}

export interface CustomerBlockView {
  id: string;
  level: string;
  reasonCode: string;
  note: string | null;
  endsAt: Date | null;
  createdAt: Date;
  liftedAt: Date | null;
  liftedReason: string | null;
  inForce: boolean;
  version: number;
}

/** Block history for the customer 360 (newest first, bounded). */
export async function listCustomerBlocks(db: Tx, userId: string): Promise<CustomerBlockView[]> {
  const rows = await db
    .select({
      id: customerBlocks.id,
      level: customerBlocks.level,
      reasonCode: customerBlocks.reasonCode,
      note: customerBlocks.note,
      endsAt: customerBlocks.endsAt,
      createdAt: customerBlocks.createdAt,
      liftedAt: customerBlocks.liftedAt,
      liftedReason: customerBlocks.liftedReason,
      version: customerBlocks.version,
      inForce: sql<boolean>`(${customerBlocks.liftedAt} is null and (${customerBlocks.endsAt} is null or ${customerBlocks.endsAt} > now()))`,
    })
    .from(customerBlocks)
    .where(eq(customerBlocks.userId, userId))
    .orderBy(desc(customerBlocks.createdAt))
    .limit(100);
  return rows;
}
