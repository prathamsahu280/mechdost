import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import {
  RefundDestination,
  type AdminRefund,
  type RefundDestinationInput,
} from '@mechdost/shared/refunds-api';
import type { RefundReason } from '@mechdost/shared/state';
import {
  maskRefundDestination,
  ORDER_ISSUE_CODES,
  SERVICE_ISSUE_CODES,
  SUPPORT_ATTACH_MAX,
  type SupportIssueCode,
} from '@mechdost/shared/support-thread';
import { decryptField, encryptField, type Keyring } from '../crypto';
import {
  auditLog,
  cities,
  mediaObjects,
  orderGroups,
  orders,
  refunds,
  serviceRequests,
  supportTickets,
  ticketMessages,
} from '../schema';
import { queueTicketEmail } from './email-events';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { firstReplyDueAt } from './support-sla';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';
import { createStaffRefund } from './refunds';
import type { CityScope } from './routing';
import type { StoredImage } from './service-photos';
import {
  attachMessageImages,
  cleanBody,
  customerReplyTicket,
  DAILY_TICKET_LIMIT,
  RESOLVE_MS,
  type TicketScope,
} from './support';

/**
 * Order and request threads with MechDost support, photo attachments and the COD refund destination (design
 * 2026-11-15 "Support next tier", items 1 to 3; spec 09). The customer talks to MechDost support only: nothing here
 * reads or returns a shop's or workshop's contact data, and nothing returns the customer's to them.
 *
 * - One open request per customer and order (or service job): opening again appends to it and, when it was resolved
 *   or waiting on the customer, moves it back to review through `ticketMachine` (inside `customerReplyTicket`). A
 *   closed request frees the slot; the partial unique indexes make a second open one impossible whatever the code does.
 * - The payout destination of a cash-on-delivery refund (UPI id or bank details) is encrypted with the data keyring
 *   (AAD `support_tickets.refund_destination_enc`) and shown back only masked. Staff turn it into the finance queue's
 *   `bank_upi` refund request from the ticket; it is copied (re-encrypted under the refund's own AAD) and, from then
 *   on, locked on the ticket.
 */
const DESTINATION_AAD = 'support_tickets.refund_destination_enc';

export interface OpenThreadInput {
  userId: string;
  issueCode: SupportIssueCode;
  /** The checkout group code (MD-…), for a part or order issue. */
  orderCode?: string | null | undefined;
  /** The service job code (SR-…), for a workshop issue. */
  serviceCode?: string | null | undefined;
  body: string;
  images?: readonly StoredImage[] | undefined;
  defaultCityCode: string;
}

const SUBJECTS_LIVE = ['open', 'in_review', 'awaiting_customer', 'resolved'];

/** Open the customer's thread for an order or a service job, or continue the one that is already open. */
export async function openSupportThread(
  db: Tx,
  input: OpenThreadInput,
): Promise<{ code: string; reopened: boolean }> {
  const orderCode = input.orderCode ?? null;
  const serviceCode = input.serviceCode ?? null;
  if ((orderCode === null) === (serviceCode === null))
    throw new ValidationError('Choose an order or a service job', 'SUBJECT_REQUIRED');
  const allowed = orderCode === null ? SERVICE_ISSUE_CODES : ORDER_ISSUE_CODES;
  if (!allowed.includes(input.issueCode))
    throw new ValidationError('This issue does not fit here', 'ISSUE_NOT_FOR_SUBJECT');
  const body = cleanBody(input.body);
  const images = input.images ?? [];
  if (images.length > SUPPORT_ATTACH_MAX)
    throw new ValidationError(`Up to ${String(SUPPORT_ATTACH_MAX)} photos per message`, 'ATTACHMENT_LIMIT');

  const found = await db.transaction(async (tx) => {
    // One request at a time per customer: two taps cannot open two threads or both pass the daily limit.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ticket-create:${input.userId}`}, 0))`,
    );
    const subject = await resolveSubject(tx, input.userId, orderCode, serviceCode);
    const [open] = await tx
      .select({ id: supportTickets.id, code: supportTickets.code })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.userId, input.userId),
          subject.orderId
            ? eq(supportTickets.orderId, subject.orderId)
            : eq(supportTickets.serviceRequestId, subject.serviceRequestId ?? ''),
          ne(supportTickets.kind, 'labour_redo'),
          inArray(supportTickets.status, SUBJECTS_LIVE),
        ),
      )
      .limit(1);
    if (open) return { code: open.code };

    const now = new Date();
    const recent = await tx.$count(
      supportTickets,
      and(
        eq(supportTickets.userId, input.userId),
        gt(supportTickets.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
    if (recent >= DAILY_TICKET_LIMIT)
      throw new ValidationError('You can raise up to 5 requests a day', 'TICKET_DAILY_LIMIT');
    const cityCode = subject.cityCode || input.defaultCityCode;
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        code: publicCode('REQ', cityCode, now),
        userId: input.userId,
        kind: subject.orderId ? 'order_issue' : 'service_issue',
        issueCode: input.issueCode,
        orderId: subject.orderId,
        serviceRequestId: subject.serviceRequestId,
        cityId: subject.cityId,
        channel: 'web',
        slaAckDue: await firstReplyDueAt(tx, now),
        slaResolveDue: new Date(now.getTime() + RESOLVE_MS),
      })
      .returning({ id: supportTickets.id, code: supportTickets.code });
    if (!ticket) throw new Error('ticket insert returned nothing');
    const [message] = await tx
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        authorUserId: input.userId,
        authorRole: 'customer',
        body,
        channel: 'web',
      })
      .returning({ id: ticketMessages.id });
    if (!message) throw new Error('message insert returned nothing');
    await attachMessageImages(tx, {
      messageId: message.id,
      ticketId: ticket.id,
      userId: input.userId,
      cityId: subject.cityId,
      images,
    });
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'ticket.created',
      entity: 'support_ticket',
      entityId: ticket.id,
      after: {
        code: ticket.code,
        kind: subject.orderId ? 'order_issue' : 'service_issue',
        issueCode: input.issueCode,
        channel: 'web',
        order: Boolean(subject.orderId),
      },
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
      cityId: subject.cityId,
      entityId: ticket.id,
      version: 1,
      params: { ticketCode: ticket.code },
    });
    await recordServerEvent(tx, 'support_thread_opened', {
      userId: input.userId,
      cityId: subject.cityId,
      props: {
        ticketCode: ticket.code,
        subject: subject.orderId ? 'order' : 'service',
        issueCode: input.issueCode,
        reopened: false,
        photos: images.length,
      },
    });
    return { code: ticket.code, created: true as const };
  });
  if ('created' in found) return { code: found.code, reopened: false };

  // The thread exists: this message continues it (a resolved or waiting one goes back to review).
  await customerReplyTicket(db, {
    userId: input.userId,
    code: found.code,
    body,
    images,
  });
  await recordServerEvent(db, 'support_thread_opened', {
    userId: input.userId,
    props: {
      ticketCode: found.code,
      subject: orderCode === null ? 'service' : 'order',
      issueCode: input.issueCode,
      reopened: true,
      photos: images.length,
    },
  });
  return { code: found.code, reopened: true };
}

interface Subject {
  orderId: string | null;
  serviceRequestId: string | null;
  cityId: string;
  cityCode: string;
}

/** The customer's own order or service job; anyone else's is "not found", never "forbidden". */
async function resolveSubject(
  tx: Tx,
  userId: string,
  orderCode: string | null,
  serviceCode: string | null,
): Promise<Subject> {
  if (orderCode !== null) {
    const [order] = await tx
      .select({ id: orders.id, cityId: orders.cityId, cityCode: cities.code })
      .from(orders)
      .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
      .innerJoin(cities, eq(cities.id, orders.cityId))
      .where(and(eq(orderGroups.code, orderCode), eq(orders.userId, userId)))
      // The first sub-order stands for the checkout: the same one every time.
      .orderBy(asc(orders.subNo))
      .limit(1);
    if (!order) throw new NotFoundError('Order not found');
    return { orderId: order.id, serviceRequestId: null, cityId: order.cityId, cityCode: order.cityCode };
  }
  const [job] = await tx
    .select({ id: serviceRequests.id, cityId: serviceRequests.cityId, cityCode: cities.code })
    .from(serviceRequests)
    .innerJoin(cities, eq(cities.id, serviceRequests.cityId))
    .where(and(eq(serviceRequests.code, serviceCode ?? ''), eq(serviceRequests.userId, userId)))
    .limit(1);
  if (!job) throw new NotFoundError('Service job not found');
  return { orderId: null, serviceRequestId: job.id, cityId: job.cityId, cityCode: job.cityCode };
}

// ── COD refund destination ────────────────────────────────────────────────────────────────────────────────────

/**
 * The customer gives a UPI id or bank account for a cash-on-delivery refund on their own request. Validated with the
 * finance formats, encrypted at rest, returned masked. Only for a cash-on-delivery order and an open request, and
 * locked once a manual refund has been requested for the order (the value is then already in the finance queue).
 */
export async function saveTicketRefundDestination(
  db: Tx,
  input: { userId: string; code: string; destination: RefundDestinationInput; keyring: Keyring },
): Promise<{ kind: 'upi' | 'bank'; masked: string }> {
  const destination = RefundDestination.parse(input.destination);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: supportTickets.id,
        status: supportTickets.status,
        orderId: supportTickets.orderId,
        cityId: supportTickets.cityId,
        had: supportTickets.refundDestinationEnc,
        method: orderGroups.paymentMethod,
        code: supportTickets.code,
      })
      .from(supportTickets)
      .leftJoin(orders, eq(orders.id, supportTickets.orderId))
      .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
      .where(and(eq(supportTickets.code, input.code), eq(supportTickets.userId, input.userId)))
      .limit(1)
      .for('update', { of: supportTickets });
    if (!t) throw new NotFoundError('Request not found');
    if (t.status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    if (!t.orderId || t.method !== 'cod')
      throw new ValidationError(
        'Only a cash on delivery order is refunded to a UPI id or bank account',
        'DESTINATION_NOT_COD',
      );
    const asked = await tx.$count(refunds, and(eq(refunds.orderId, t.orderId), eq(refunds.mode, 'bank_upi')));
    if (asked > 0)
      throw new ConflictError('A refund was already requested for this order', 'DESTINATION_LOCKED');
    const masked = maskRefundDestination(destination);
    await tx
      .update(supportTickets)
      .set({
        refundDestinationEnc: encryptField(JSON.stringify(destination), input.keyring, DESTINATION_AAD),
        refundDestinationMask: masked,
        refundDestinationAt: new Date(),
      })
      .where(eq(supportTickets.id, t.id));
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'ticket.refund_destination_saved',
      entity: 'support_ticket',
      entityId: t.id,
      // Never the value, not even masked: the kind and whether it replaced an earlier one.
      after: { kind: destination.kind, replaced: t.had !== null },
    });
    await recordServerEvent(tx, 'support_refund_destination_saved', {
      userId: input.userId,
      cityId: t.cityId,
      props: { ticketCode: t.code, kind: destination.kind, replaced: t.had !== null },
    });
    return { kind: destination.kind, masked };
  });
}

/**
 * Staff create the manual (`bank_upi`) refund request from the ticket: the amount, reason and an idempotency key are
 * theirs, the destination and the order are the ticket's. Finance approval, four-eyes and the ledger checks are the
 * refund repository's, exactly as for a refund made from the refunds screen.
 */
export async function createRefundFromTicket(
  db: Tx,
  input: {
    ticketScope: TicketScope;
    refundScope: CityScope;
    staffUserId: string;
    code: string;
    amountPaise: number;
    reasonCode: RefundReason;
    note?: string | undefined;
    idempotencyKey: string;
    keyring: Keyring;
  },
): Promise<{ refund: AdminRefund; replay: boolean }> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: supportTickets.id,
        code: supportTickets.code,
        orderCode: orders.code,
        enc: supportTickets.refundDestinationEnc,
        cityId: supportTickets.cityId,
      })
      .from(supportTickets)
      .leftJoin(orders, eq(orders.id, supportTickets.orderId))
      .where(
        and(
          eq(supportTickets.code, input.code),
          input.ticketScope.all
            ? undefined
            : input.ticketScope.cityIds.length === 0
              ? sql`false`
              : inArray(supportTickets.cityId, [...input.ticketScope.cityIds]),
        ),
      )
      .limit(1);
    if (!t) throw new NotFoundError('Request not found');
    if (!t.orderCode || !t.enc)
      throw new ValidationError(
        'The customer has not given a UPI id or bank account yet',
        'REFUND_NEEDS_DESTINATION',
      );
    const parsed = RefundDestination.safeParse(
      JSON.parse(decryptField(t.enc, input.keyring, DESTINATION_AAD)),
    );
    if (!parsed.success)
      throw new ConflictError('The stored destination is unreadable', 'DESTINATION_UNREADABLE');
    const made = await createStaffRefund(tx, {
      scope: input.refundScope,
      staffUserId: input.staffUserId,
      orderCode: t.orderCode,
      amountPaise: input.amountPaise,
      source: 'support_claim',
      reasonCode: input.reasonCode,
      note: input.note,
      destination: parsed.data,
      keyring: input.keyring,
      idempotencyKey: input.idempotencyKey,
    });
    if (!made.replay) {
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'staff',
        action: 'ticket.refund_requested',
        entity: 'support_ticket',
        entityId: t.id,
        after: { refundId: made.refund.id, amountPaise: input.amountPaise, reasonCode: input.reasonCode },
      });
      await recordServerEvent(tx, 'support_refund_from_ticket', {
        userId: input.staffUserId,
        cityId: t.cityId,
        props: {
          ticketCode: t.code,
          orderCode: t.orderCode,
          amountPaise: input.amountPaise,
          reasonCode: input.reasonCode,
        },
      });
    }
    return made;
  });
}

// ── reading attachments ───────────────────────────────────────────────────────────────────────────────────────

export interface ServedTicketMedia {
  bucket: string;
  path: string;
  thumbPath: string;
}

/** Object keys of one live ticket photo for the image route (which checks the signed URL), or null. */
export async function findTicketMediaForServing(db: Tx, mediaId: string): Promise<ServedTicketMedia | null> {
  const [row] = await db
    .select({ bucket: mediaObjects.bucket, path: mediaObjects.path, thumbPath: mediaObjects.thumbPath })
    .from(mediaObjects)
    .innerJoin(ticketMessages, eq(ticketMessages.id, mediaObjects.ownerId))
    .where(
      and(
        eq(mediaObjects.id, mediaId),
        eq(mediaObjects.ownerKind, 'ticket_message'),
        sql`${mediaObjects.deletedAt} is null`,
      ),
    )
    .limit(1);
  return row ?? null;
}
