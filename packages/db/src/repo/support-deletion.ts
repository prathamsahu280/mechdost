import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import {
  auditLog,
  cities,
  orderGroups,
  orders,
  refunds,
  serviceRequests,
  supportTickets,
  ticketMessages,
  users,
} from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { queueTicketEmail } from './email-events';
import { recordServerEvent } from './events';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';
import { cleanBody, RESOLVE_MS, type TicketScope } from './support';
import { firstReplyDueAt } from './support-sla';

/**
 * Account deletion request (design 2026-11-15 item 7; specs 01 and 09). The customer asks from the account; that opens
 * a `deletion_request` ticket (one open per customer) and stamps `users.deletion_requested_at`. Support confirms
 * (a step of its own, audited); what the deletion actually erases is not decided yet (Q122), so confirming only
 * records the step: no account data is changed or removed here. A customer with an open order, service job or refund
 * is refused with the reasons as codes (spec 01: "deletion with open orders/refunds is blocked with reason").
 */
export const DELETION_BLOCKERS = ['OPEN_ORDERS', 'OPEN_SERVICE', 'OPEN_REFUND'] as const;
export type DeletionBlocker = (typeof DELETION_BLOCKERS)[number];

export class DeletionBlockedError extends ConflictError {
  readonly blockers: DeletionBlocker[];
  constructor(blockers: DeletionBlocker[]) {
    super('Finish or cancel your open orders, service jobs and refunds first', 'DELETION_BLOCKED');
    this.blockers = blockers;
  }
}

const ORDER_DONE = ['delivered', 'cancelled', 'rejected', 'returned'];
const SERVICE_DONE = ['completed', 'cancelled', 'rejected'];
/** A refund is still owed while it is asked for, approved, being paid or being reconciled. */
const REFUND_OPEN = ['requested', 'approved', 'initiated', 'needs_reconciliation'];

async function blockersOf(tx: Tx, userId: string): Promise<DeletionBlocker[]> {
  const [orderCount, serviceCount, refundCount] = await Promise.all([
    tx.$count(orders, and(eq(orders.userId, userId), notInArray(orders.status, ORDER_DONE))),
    tx.$count(
      serviceRequests,
      and(eq(serviceRequests.userId, userId), notInArray(serviceRequests.status, SERVICE_DONE)),
    ),
    tx
      .select({ id: refunds.id })
      .from(refunds)
      .innerJoin(orderGroups, eq(orderGroups.id, refunds.groupId))
      .where(and(eq(orderGroups.userId, userId), inArray(refunds.status, REFUND_OPEN)))
      .limit(1)
      .then((r) => r.length),
  ]);
  const out: DeletionBlocker[] = [];
  if (orderCount > 0) out.push('OPEN_ORDERS');
  if (serviceCount > 0) out.push('OPEN_SERVICE');
  if (refundCount > 0) out.push('OPEN_REFUND');
  return out;
}

export async function requestAccountDeletion(
  db: Tx,
  input: { userId: string; defaultCityCode: string; note: string | null; now?: Date },
): Promise<{ code: string; created: boolean }> {
  const note = input.note?.trim() ? cleanBody(input.note) : null;
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // One request at a time per customer: the user row is the lock (the partial unique index is the backstop).
    const [user] = await tx
      .select({ id: users.id, requestedAt: users.deletionRequestedAt })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1)
      .for('update');
    if (!user) throw new NotFoundError('Account not found');
    const [open] = await tx
      .select({ code: supportTickets.code })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.userId, input.userId),
          eq(supportTickets.kind, 'deletion_request'),
          sql`${supportTickets.status} <> 'closed'`,
        ),
      )
      .limit(1);
    if (open) return { code: open.code, created: false };
    const blockers = await blockersOf(tx, input.userId);
    if (blockers.length > 0) throw new DeletionBlockedError(blockers);
    const [city] = await tx
      .select({ code: cities.code })
      .from(cities)
      .where(eq(cities.code, input.defaultCityCode))
      .limit(1);
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        code: publicCode('REQ', city?.code ?? input.defaultCityCode, now),
        userId: input.userId,
        kind: 'deletion_request',
        channel: 'web',
        slaAckDue: await firstReplyDueAt(tx, now),
        slaResolveDue: new Date(now.getTime() + RESOLVE_MS),
      })
      .returning({ id: supportTickets.id, code: supportTickets.code });
    if (!ticket) throw new Error('ticket insert returned nothing');
    if (note)
      await tx.insert(ticketMessages).values({
        ticketId: ticket.id,
        authorUserId: input.userId,
        authorRole: 'customer',
        body: note,
        channel: 'web',
      });
    await tx.update(users).set({ deletionRequestedAt: now }).where(eq(users.id, input.userId));
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'user.deletion_requested',
      entity: 'support_ticket',
      entityId: ticket.id,
      after: { code: ticket.code },
    });
    await recordServerEvent(tx, 'support_deletion_requested', {
      userId: input.userId,
      props: { ticketCode: ticket.code },
    });
    await queueTicketEmail(tx, {
      template: 'ticket_received',
      entityId: ticket.id,
      version: 1,
      userId: input.userId,
      ticketCode: ticket.code,
    });
    await queueStaffNotice(tx, {
      kind: 'staff.new_ticket',
      cityId: null,
      entityId: ticket.id,
      version: 1,
      params: { ticketCode: ticket.code },
    });
    return { code: ticket.code, created: true };
  });
}

/** Support confirms the request after checking who asked. Compare-and-set on `version`; once only; blockers re-checked. */
export async function confirmAccountDeletion(
  db: Tx,
  scope: TicketScope,
  input: { staffUserId: string; code: string; expectedVersion: number },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: supportTickets.id,
        kind: supportTickets.kind,
        status: supportTickets.status,
        userId: supportTickets.userId,
        confirmedAt: supportTickets.deletionConfirmedAt,
        cityId: supportTickets.cityId,
      })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.code, input.code),
          scope.all
            ? undefined
            : scope.cityIds.length
              ? inArray(supportTickets.cityId, [...scope.cityIds])
              : sql`false`,
        ),
      )
      .limit(1)
      .for('update');
    if (!t) throw new NotFoundError('Request not found');
    if (t.kind !== 'deletion_request' || !t.userId)
      throw new ConflictError('This is not a deletion request', 'NOT_A_DELETION_REQUEST');
    if (t.status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    if (t.confirmedAt) throw new ConflictError('Already confirmed', 'DELETION_ALREADY_CONFIRMED');
    const blockers = await blockersOf(tx, t.userId);
    if (blockers.length > 0) throw new DeletionBlockedError(blockers);
    const [row] = await tx
      .update(supportTickets)
      .set({ deletionConfirmedAt: new Date(), deletionConfirmedBy: input.staffUserId })
      .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, input.expectedVersion)))
      .returning({ version: supportTickets.version });
    if (!row) throw new ConflictError('This request changed; reload and try again', 'STALE_TICKET');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'user.deletion_confirmed',
      entity: 'support_ticket',
      entityId: t.id,
      after: { code: input.code },
    });
    await recordServerEvent(tx, 'support_deletion_confirmed', {
      userId: input.staffUserId,
      cityId: t.cityId,
      props: { ticketCode: input.code },
    });
    // The customer is told through the usual "reply on your request" email (existing template).
    await queueTicketEmail(tx, {
      template: 'ticket_reply',
      entityId: `${t.id}:deletion`,
      version: row.version,
      userId: t.userId,
      ticketCode: input.code,
    });
    return { version: row.version };
  });
}
