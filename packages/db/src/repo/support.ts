import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { maskPhone } from '@mechdost/shared/contact-mask';
import { firstReplySla, type SlaState } from '@mechdost/shared/support-sla';
import { publicCode } from '@mechdost/shared/ids';
import { labourPromiseOpen } from '@mechdost/shared/service-bill';
import { ticketMachine, type TicketStatus } from '@mechdost/shared/state';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { SUPPORT_ATTACH_MAX } from '@mechdost/shared/support-thread';
import {
  auditLog,
  cities,
  mediaObjects,
  orderGroups,
  orders,
  serviceBills,
  rsaRequests,
  serviceRequests,
  settings,
  supportTickets,
  ticketMessages,
  users,
} from '../schema';
import { queueTicketEmail } from './email-events';
import { resolveTicketReplyNotices } from './notice-events';
import { queueStaffNotice, resolveNotices } from './notices';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { firstReplyDueAt } from './support-sla';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification } from './notify';
import type { Tx } from './orders';
import type { StoredImage } from './service-photos';

/**
 * Support tickets (spec 09) — the real counterpart of the demo store. Customers raise and follow their own
 * requests (foreign codes are 404); staff work an inbox scoped by city (rule 7: all-city staff see everything,
 * city staff see requests about their cities' orders). Every status change goes through `ticketMachine` as a
 * compare-and-set; every creation is audited. Customer limit: 5 requests per 24 h (serialised per user).
 */
/** `labour_redo` = a customer claims the workshop's labour promise on one of their billed jobs (user 2026-11-15, Q105). */
export const TICKET_KINDS = [
  'order_issue',
  'refund',
  'fitment',
  'account',
  'labour_redo',
  'rsa_bill_dispute',
  'other',
] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
/** Kinds only the server opens (never offered in the support form): the Ustaad appeal (SIM-P24). */
export const INTERNAL_TICKET_KINDS = ['ustaad_appeal'] as const;
export type AnyTicketKind = TicketKind | (typeof INTERNAL_TICKET_KINDS)[number];
export const DAILY_TICKET_LIMIT = 5;
export const TICKET_BODY_MAX = 2000;
export const RESOLVE_MS = 30 * 86_400_000;
const ACTIVE: TicketStatus[] = ['open', 'in_review', 'awaiting_customer'];
export const ACTIVE_STATUSES: readonly TicketStatus[] = ACTIVE;

/** Staff scope from their grants: every city, or a list of city ids. */
export type TicketScope = { all: true } | { all: false; cityIds: readonly string[] };

/** A stored photo of one message; the API turns it into short-lived URLs after its own rights check. */
export interface MessageAttachment {
  mediaId: string;
  width: number;
  height: number;
}

export interface TicketMessageView {
  id: string;
  role: string;
  body: string;
  internal: boolean;
  channel: string;
  createdAt: Date;
  attachments: MessageAttachment[];
}

export interface TicketView {
  code: string;
  kind: string;
  status: TicketStatus;
  channel: string;
  orderCode: string | null;
  /** Quick issue code of an order/request thread; null on older, free-form requests. */
  issueCode: string | null;
  /** The service job (SR-…) a request thread or labour redo is about. */
  serviceCode: string | null;
  /** COD refund: whether the order was cash on delivery, and the masked destination the customer gave (never the full value). */
  refund: { eligible: boolean; destination: { kind: 'upi' | 'bank'; masked: string } | null };
  /** Account deletion requests: when support confirmed it (nothing is deleted by this step yet; Q122). */
  deletionConfirmedAt: Date | null;
  slaAckDue: Date;
  slaResolveDue: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  version: number;
  messages: TicketMessageView[];
}

export function cleanBody(body: string): string {
  const text = body.trim();
  if (text.length === 0) throw new ValidationError('Write a message', 'TICKET_BODY_EMPTY');
  if (text.length > TICKET_BODY_MAX) throw new ValidationError('Message is too long', 'TICKET_BODY_TOO_LONG');
  return text;
}

function scopeFilter(scope: TicketScope) {
  if (scope.all) return undefined;
  if (scope.cityIds.length === 0) return sql`false`;
  return inArray(supportTickets.cityId, [...scope.cityIds]);
}

async function messagesOf(db: Tx, ticketId: string, includeInternal: boolean): Promise<TicketMessageView[]> {
  const rows = await db
    .select({
      id: ticketMessages.id,
      role: ticketMessages.authorRole,
      body: ticketMessages.body,
      internal: ticketMessages.internal,
      channel: ticketMessages.channel,
      createdAt: ticketMessages.createdAt,
    })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        includeInternal ? undefined : eq(ticketMessages.internal, false),
      ),
    )
    .orderBy(desc(ticketMessages.createdAt), desc(ticketMessages.id))
    .limit(THREAD_LIMIT);
  const messages = rows.reverse();
  const media =
    messages.length === 0
      ? []
      : await db
          .select({
            id: mediaObjects.id,
            ownerId: mediaObjects.ownerId,
            width: mediaObjects.width,
            height: mediaObjects.height,
          })
          .from(mediaObjects)
          .where(
            and(
              eq(mediaObjects.ownerKind, 'ticket_message'),
              inArray(
                mediaObjects.ownerId,
                messages.map((m) => m.id),
              ),
              isNull(mediaObjects.deletedAt),
            ),
          )
          .orderBy(mediaObjects.createdAt, mediaObjects.id);
  return messages.map((m) => ({
    ...m,
    attachments: media
      .filter((a) => a.ownerId === m.id)
      .map((a) => ({ mediaId: a.id, width: a.width, height: a.height })),
  }));
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A thread shows its newest messages (review B9: no unbounded reads); older ones stay in the database. */
const THREAD_LIMIT = 200;
const REPLY_CAP_KEY = 'support.customer_messages_per_ticket_per_day';

/** The admin's reply cap (global setting), else the registry default. */
export async function replyCap(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, REPLY_CAP_KEY), isNull(settings.cityId)))
    .limit(1);
  const v = row?.value;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0
    ? v
    : OPERATIONAL_SETTINGS[REPLY_CAP_KEY].default;
}

const baseColumns = {
  id: supportTickets.id,
  code: supportTickets.code,
  kind: supportTickets.kind,
  status: supportTickets.status,
  channel: supportTickets.channel,
  orderCode: orderGroups.code,
  slaAckDue: supportTickets.slaAckDue,
  slaResolveDue: supportTickets.slaResolveDue,
  resolvedAt: supportTickets.resolvedAt,
  createdAt: supportTickets.createdAt,
  version: supportTickets.version,
};

/** What the thread views add: the issue code, the service job, and what the customer needs for a COD refund. */
const ticketColumns = {
  ...baseColumns,
  issueCode: supportTickets.issueCode,
  serviceCode: serviceRequests.code,
  paymentMethod: orderGroups.paymentMethod,
  destinationMask: supportTickets.refundDestinationMask,
  deletionConfirmedAt: supportTickets.deletionConfirmedAt,
};

async function view(
  db: Tx,
  row: {
    id: string;
    code: string;
    kind: string;
    status: TicketStatus;
    channel: string;
    orderCode: string | null;
    slaAckDue: Date;
    slaResolveDue: Date;
    resolvedAt: Date | null;
    createdAt: Date;
    version: number;
    issueCode: string | null;
    serviceCode: string | null;
    paymentMethod: string | null;
    destinationMask: string | null;
    deletionConfirmedAt: Date | null;
  },
  internal: boolean,
): Promise<TicketView> {
  const { id, paymentMethod, destinationMask, ...rest } = row;
  return {
    ...rest,
    refund: {
      eligible: paymentMethod === 'cod',
      destination: destinationMask
        ? { kind: destinationMask.includes('@') ? 'upi' : 'bank', masked: destinationMask }
        : null,
    },
    messages: await messagesOf(db, id, internal),
  };
}

// ── customer ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function createSupportTicket(
  db: Tx,
  input: {
    userId: string;
    kind: AnyTicketKind;
    orderCode: string | null;
    /** Required for `labour_redo` (the service job, SR-…); ignored for other kinds. */
    serviceCode?: string | null;
    /** Required for `rsa_bill_dispute` (the roadside request, RSA-…); ignored for other kinds. */
    rsaCode?: string | null;
    body: string;
    defaultCityCode: string;
    /** The clock; tests pass a fixed instant (first-reply deadline in support hours). */
    now?: Date;
  },
): Promise<{ code: string }> {
  if (![...TICKET_KINDS, ...INTERNAL_TICKET_KINDS].some((k) => k === input.kind))
    throw new ValidationError('Unknown request type', 'TICKET_KIND');
  const body = cleanBody(input.body);
  return db.transaction(async (tx) => {
    // Serialise per user so two parallel requests cannot both pass the daily limit.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ticket-create:${input.userId}`}, 0))`,
    );
    const now = input.now ?? new Date();
    const recent = await tx.$count(
      supportTickets,
      and(
        eq(supportTickets.userId, input.userId),
        gt(supportTickets.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
    if (recent >= DAILY_TICKET_LIMIT) {
      throw new ValidationError('You can raise up to 5 requests a day', 'TICKET_DAILY_LIMIT');
    }
    let orderId: string | null = null;
    let cityId: string | null = null;
    let cityCode = input.defaultCityCode;
    if (input.orderCode) {
      // Actor-scoped: someone else's order code is "not found", never "forbidden".
      const [order] = await tx
        .select({ id: orders.id, cityId: orders.cityId, cityCode: cities.code })
        .from(orders)
        .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
        .innerJoin(cities, eq(cities.id, orders.cityId))
        .where(and(eq(orderGroups.code, input.orderCode), eq(orders.userId, input.userId)))
        .limit(1);
      if (!order) throw new NotFoundError('Order not found');
      orderId = order.id;
      cityId = order.cityId;
      cityCode = order.cityCode;
    }
    let serviceRequestId: string | null = null;
    if (input.kind === 'labour_redo') {
      if (!input.serviceCode) {
        throw new ValidationError('Choose the service job to redo', 'SERVICE_CODE_REQUIRED');
      }
      // Actor-scoped like orders: someone else's job is "not found".
      const [job] = await tx
        .select({
          id: serviceRequests.id,
          cityId: serviceRequests.cityId,
          cityCode: cities.code,
          billedAt: serviceBills.billedAt,
          days: serviceBills.labourPromiseDays,
        })
        .from(serviceRequests)
        .innerJoin(cities, eq(cities.id, serviceRequests.cityId))
        .leftJoin(serviceBills, eq(serviceBills.requestId, serviceRequests.id))
        .where(and(eq(serviceRequests.code, input.serviceCode), eq(serviceRequests.userId, input.userId)))
        .limit(1);
      if (!job) throw new NotFoundError('Service job not found');
      if (!job.billedAt || !labourPromiseOpen(job.billedAt, job.days, now)) {
        throw new ValidationError(
          'This job has no labour promise, or it has ended',
          'LABOUR_PROMISE_UNAVAILABLE',
        );
      }
      const open = await tx.$count(
        supportTickets,
        and(
          eq(supportTickets.serviceRequestId, job.id),
          eq(supportTickets.kind, 'labour_redo'),
          inArray(supportTickets.status, ACTIVE),
        ),
      );
      if (open > 0)
        throw new ConflictError('A redo request for this job is already open', 'LABOUR_REDO_OPEN');
      serviceRequestId = job.id;
      cityId = job.cityId;
      cityCode = job.cityCode;
    }
    let rsaRequestId: string | null = null;
    if (input.kind === 'rsa_bill_dispute') {
      if (!input.rsaCode) throw new ValidationError('Choose the roadside request', 'RSA_CODE_REQUIRED');
      // Actor-scoped like orders: someone else's request is "not found". Only a bill that is ready can be questioned.
      const [q] = await tx
        .select({
          id: rsaRequests.id,
          status: rsaRequests.status,
          cityId: rsaRequests.cityId,
          cityCode: cities.code,
        })
        .from(rsaRequests)
        .innerJoin(cities, eq(cities.id, rsaRequests.cityId))
        .where(and(eq(rsaRequests.code, input.rsaCode), eq(rsaRequests.userId, input.userId)))
        .limit(1);
      if (!q) throw new NotFoundError('Roadside request not found');
      if (q.status !== 'billed' && q.status !== 'completed')
        throw new ConflictError('There is no bill to question yet', 'RSA_NOT_BILLED');
      const open = await tx.$count(
        supportTickets,
        and(
          eq(supportTickets.rsaRequestId, q.id),
          eq(supportTickets.kind, 'rsa_bill_dispute'),
          inArray(supportTickets.status, ACTIVE),
        ),
      );
      if (open > 0) throw new ConflictError('A question about this bill is already open', 'RSA_DISPUTE_OPEN');
      rsaRequestId = q.id;
      cityId = q.cityId;
      cityCode = q.cityCode;
    }
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        code: publicCode('REQ', cityCode, now),
        userId: input.userId,
        kind: input.kind,
        orderId,
        serviceRequestId,
        rsaRequestId,
        cityId,
        channel: 'web',
        slaAckDue: await firstReplyDueAt(tx, now),
        slaResolveDue: new Date(now.getTime() + RESOLVE_MS),
      })
      .returning({ id: supportTickets.id, code: supportTickets.code });
    if (!ticket) throw new Error('ticket insert returned nothing');
    await tx.insert(ticketMessages).values({
      ticketId: ticket.id,
      authorUserId: input.userId,
      authorRole: 'customer',
      body,
      channel: 'web',
    });
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'ticket.created',
      entity: 'support_ticket',
      entityId: ticket.id,
      after: { code: ticket.code, kind: input.kind, channel: 'web', order: Boolean(orderId) },
    });
    // Email confirmation (spec 10), same transaction.
    await queueTicketEmail(tx, {
      template: 'ticket_received',
      entityId: ticket.id,
      version: 1,
      userId: input.userId,
      ticketCode: ticket.code,
    });
    // Support staff of the order's city (or all-city staff when there is no order) see it in their bell.
    await queueStaffNotice(tx, {
      kind: 'staff.new_ticket',
      cityId,
      entityId: ticket.id,
      version: 1,
      params: { ticketCode: ticket.code },
    });
    return { code: ticket.code };
  });
}

export async function listMyTickets(
  db: Tx,
  userId: string,
  opts: { limit?: number; before?: Date } = {},
): Promise<TicketView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await db
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .leftJoin(serviceRequests, eq(serviceRequests.id, supportTickets.serviceRequestId))
    .where(
      and(
        eq(supportTickets.userId, userId),
        opts.before ? lt(supportTickets.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(supportTickets.createdAt))
    .limit(limit);
  return Promise.all(rows.map((r) => view(db, { ...r, status: r.status as TicketStatus }, false)));
}

/** One request's customer-facing view by id (no internal notes), for the guest repository after its key check. */
export async function getTicketViewById(db: Tx, ticketId: string): Promise<TicketView> {
  const [row] = await db
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .leftJoin(serviceRequests, eq(serviceRequests.id, supportTickets.serviceRequestId))
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!row) throw new NotFoundError('Request not found');
  return view(db, { ...row, status: row.status as TicketStatus }, false);
}

export async function getMyTicket(db: Tx, userId: string, code: string): Promise<TicketView> {
  const [row] = await db
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .leftJoin(serviceRequests, eq(serviceRequests.id, supportTickets.serviceRequestId))
    .where(and(eq(supportTickets.code, code), eq(supportTickets.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError('Request not found');
  return view(db, { ...row, status: row.status as TicketStatus }, false);
}

/** Photos of one message: at most `SUPPORT_ATTACH_MAX`, each stored privately by the API before this call. */
export async function attachMessageImages(
  tx: Tx,
  input: {
    messageId: string;
    ticketId: string;
    userId: string;
    cityId: string | null;
    images: readonly StoredImage[];
  },
): Promise<void> {
  if (input.images.length === 0) return;
  if (input.images.length > SUPPORT_ATTACH_MAX)
    throw new ValidationError(`Up to ${String(SUPPORT_ATTACH_MAX)} photos per message`, 'ATTACHMENT_LIMIT');
  // The thread lists photos by (created_at, id); one insert shares created_at, so only time-ordered (v7) ids keep
  // the order the customer attached them in.
  if (input.images.some((img) => !UUID_V7.test(img.mediaId)))
    throw new ValidationError('Photo ids must be uuid v7', 'ATTACHMENT_ID');
  await tx.insert(mediaObjects).values(
    input.images.map((img) => ({
      id: img.mediaId,
      ownerKind: 'ticket_message',
      ownerId: input.messageId,
      bucket: img.bucket,
      path: img.path,
      thumbPath: img.thumbPath,
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      thumbBytes: img.thumbBytes,
      sha256: img.sha256,
      uploadedBy: input.userId,
    })),
  );
  await tx.insert(auditLog).values({
    actorUserId: input.userId,
    actorRole: 'customer',
    action: 'ticket.photos_added',
    entity: 'support_ticket',
    entityId: input.ticketId,
    after: { messageId: input.messageId, count: input.images.length },
  });
  await recordServerEvent(tx, 'support_attachment_added', {
    userId: input.userId,
    cityId: input.cityId,
    props: {
      count: input.images.length,
      bytes: input.images.reduce((sum, img) => sum + img.bytes, 0),
    },
  });
}

/**
 * Before any image work: the request must be the caller's own (404 otherwise) and still open to messages
 * (409 `TICKET_CLOSED`). The message limit is checked again under the lock when the message is saved.
 */
export async function assertCanAttach(db: Tx, userId: string, code: string): Promise<void> {
  const [t] = await db
    .select({ status: supportTickets.status })
    .from(supportTickets)
    .where(and(eq(supportTickets.code, code), eq(supportTickets.userId, userId)))
    .limit(1);
  if (!t) throw new NotFoundError('Request not found');
  if (t.status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
}

/** The customer writes again; a ticket waiting on them or resolved returns to review (state machine). */
export async function customerReplyTicket(
  db: Tx,
  input: { userId: string; code: string; body: string; images?: readonly StoredImage[] },
): Promise<{ status: TicketStatus }> {
  const body = cleanBody(input.body);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: supportTickets.id,
        status: supportTickets.status,
        version: supportTickets.version,
        cityId: supportTickets.cityId,
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.code, input.code), eq(supportTickets.userId, input.userId)))
      .limit(1)
      .for('update');
    if (!t) throw new NotFoundError('Request not found');
    let status = t.status as TicketStatus;
    if (status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    // The ticket row is locked above, so concurrent replies count each other.
    const today = await tx.$count(
      ticketMessages,
      and(
        eq(ticketMessages.ticketId, t.id),
        eq(ticketMessages.authorRole, 'customer'),
        gt(ticketMessages.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    );
    if (today >= (await replyCap(tx)))
      throw new ValidationError(
        'Too many messages on this request today; we will answer soon',
        'REPLY_LIMIT',
      );
    if (status === 'awaiting_customer' || status === 'resolved') {
      ticketMachine.assert(status, 'in_review', 'customer');
      await tx
        .update(supportTickets)
        .set({ status: 'in_review', resolvedAt: null })
        .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, t.version)));
      status = 'in_review';
    }
    const [message] = await tx
      .insert(ticketMessages)
      .values({
        ticketId: t.id,
        authorUserId: input.userId,
        authorRole: 'customer',
        body,
        channel: 'web',
      })
      .returning({ id: ticketMessages.id });
    // The customer answered: the support reply that waited for them is done.
    await resolveTicketReplyNotices(tx, t.id);
    if (message && input.images?.length)
      await attachMessageImages(tx, {
        messageId: message.id,
        ticketId: t.id,
        userId: input.userId,
        cityId: t.cityId,
        images: input.images,
      });
    return { status };
  });
}

// ── staff ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface InboxRow {
  code: string;
  kind: string;
  status: TicketStatus;
  channel: string;
  orderCode: string | null;
  slaAckDue: Date;
  slaResolveDue: Date;
  createdAt: Date;
  version: number;
  issueCode: string | null;
  serviceCode: string | null;
  /** True once staff have replied to the customer at least once (acknowledged). */
  acknowledged: boolean;
  firstRepliedAt: Date | null;
  /** First-reply SLA at the time of the read: met, on track, or overdue (support hours, IST). */
  sla: SlaState;
  /** The signed-in customer's name, or the guest's; the phone is masked (`+91 98•••••11`) and only for guests. */
  customerName: string | null;
  customerPhoneMasked: string | null;
  isGuest: boolean;
  assignee: { id: string; name: string | null } | null;
}

export interface InboxFilter {
  view?: 'active' | 'done';
  limit?: number;
  /** `me` needs `staffUserId`; `unassigned`; or a staff user id. */
  assignee?: string;
  staffUserId?: string;
  /** Only requests of this status (inside the chosen view). */
  status?: TicketStatus;
}

export async function listInbox(db: Tx, scope: TicketScope, opts: InboxFilter = {}): Promise<InboxRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const viewFilter =
    (opts.view ?? 'active') === 'active'
      ? inArray(supportTickets.status, ACTIVE)
      : inArray(supportTickets.status, ['resolved', 'closed']);
  const assigneeFilter =
    opts.assignee === 'unassigned'
      ? isNull(supportTickets.assigneeId)
      : opts.assignee === 'me'
        ? opts.staffUserId
          ? eq(supportTickets.assigneeId, opts.staffUserId)
          : sql`false`
        : opts.assignee
          ? eq(supportTickets.assigneeId, opts.assignee)
          : undefined;
  const assignee = alias(users, 'assignee');
  const rows = await db
    .select({
      ...baseColumns,
      issueCode: supportTickets.issueCode,
      serviceCode: serviceRequests.code,
      firstRepliedAt: supportTickets.firstRepliedAt,
      acknowledged: sql<boolean>`exists (select 1 from ${ticketMessages} m where m.ticket_id = ${supportTickets.id} and m.author_role = 'staff' and m.internal = false)`,
      userId: supportTickets.userId,
      userName: users.name,
      guestName: supportTickets.guestName,
      guestPhone: supportTickets.guestPhone,
      assigneeId: supportTickets.assigneeId,
      assigneeName: assignee.name,
    })
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .leftJoin(serviceRequests, eq(serviceRequests.id, supportTickets.serviceRequestId))
    .leftJoin(users, eq(users.id, supportTickets.userId))
    .leftJoin(assignee, eq(assignee.id, supportTickets.assigneeId))
    .where(
      and(
        viewFilter,
        opts.status ? eq(supportTickets.status, opts.status) : undefined,
        assigneeFilter,
        scopeFilter(scope),
      ),
    )
    .orderBy(supportTickets.slaAckDue)
    .limit(limit);
  const now = new Date();
  return rows.map(({ id: _id, userId, userName, guestName, guestPhone, assigneeId, assigneeName, ...r }) => ({
    ...r,
    status: r.status as TicketStatus,
    sla: firstReplySla(now, r.slaAckDue, r.firstRepliedAt),
    customerName: userId ? userName : guestName,
    customerPhoneMasked: userId || !guestPhone ? null : maskPhone(guestPhone),
    isGuest: userId === null,
    assignee: assigneeId ? { id: assigneeId, name: assigneeName } : null,
  }));
}

async function lockScoped(tx: Tx, scope: TicketScope, code: string) {
  const [t] = await tx
    .select({
      id: supportTickets.id,
      status: supportTickets.status,
      version: supportTickets.version,
      channel: supportTickets.channel,
      userId: supportTickets.userId,
      guestPhone: supportTickets.guestPhone,
      code: supportTickets.code,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.code, code), scopeFilter(scope)))
    .limit(1)
    .for('update');
  if (!t) throw new NotFoundError('Request not found');
  return t;
}

/** What staff see besides the conversation: who asked, who owns it, the SLA, the deletion step. */
export interface InboxTicketView extends TicketView {
  staff: {
    customerName: string | null;
    customerPhoneMasked: string | null;
    isGuest: boolean;
    assignee: { id: string; name: string | null } | null;
    assignedAt: Date | null;
    firstRepliedAt: Date | null;
    sla: SlaState;
    deletionConfirmedAt: Date | null;
  };
}

export async function getInboxTicket(db: Tx, scope: TicketScope, code: string): Promise<InboxTicketView> {
  const assignee = alias(users, 'assignee');
  const [row] = await db
    .select({
      ...ticketColumns,
      userId: supportTickets.userId,
      userName: users.name,
      guestName: supportTickets.guestName,
      guestPhone: supportTickets.guestPhone,
      assigneeId: supportTickets.assigneeId,
      assigneeName: assignee.name,
      assignedAt: supportTickets.assignedAt,
      firstRepliedAt: supportTickets.firstRepliedAt,
    })
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .leftJoin(serviceRequests, eq(serviceRequests.id, supportTickets.serviceRequestId))
    .leftJoin(users, eq(users.id, supportTickets.userId))
    .leftJoin(assignee, eq(assignee.id, supportTickets.assigneeId))
    .where(and(eq(supportTickets.code, code), scopeFilter(scope)))
    .limit(1);
  if (!row) throw new NotFoundError('Request not found');
  const {
    userId,
    userName,
    guestName,
    guestPhone,
    assigneeId,
    assigneeName,
    assignedAt,
    firstRepliedAt,
    ...ticketRow
  } = row;
  const base = await view(db, { ...ticketRow, status: ticketRow.status as TicketStatus }, true);
  return {
    ...base,
    staff: {
      customerName: userId ? userName : guestName,
      customerPhoneMasked: userId || !guestPhone ? null : maskPhone(guestPhone),
      isGuest: userId === null,
      assignee: assigneeId ? { id: assigneeId, name: assigneeName } : null,
      assignedAt,
      firstRepliedAt,
      sla: firstReplySla(new Date(), base.slaAckDue, firstRepliedAt),
      deletionConfirmedAt: base.deletionConfirmedAt,
    },
  };
}

/**
 * Staff reply or internal note. A customer-facing reply moves an open / in-review request to "waiting for the
 * customer"; on a WhatsApp request it also queues the `ticket.replied` WhatsApp (when switched on), in the same
 * transaction, to the customer's or guest's number.
 */
export async function staffReplyTicket(
  db: Tx,
  scope: TicketScope,
  input: { staffUserId: string; code: string; body: string; internal: boolean },
): Promise<{ status: TicketStatus }> {
  const body = cleanBody(input.body);
  return db.transaction(async (tx) => {
    const t = await lockScoped(tx, scope, input.code);
    let status = t.status as TicketStatus;
    if (status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    if (!input.internal && (status === 'open' || status === 'in_review')) {
      ticketMachine.assert(status, 'awaiting_customer', 'admin');
      await tx
        .update(supportTickets)
        .set({ status: 'awaiting_customer' })
        .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, t.version)));
      status = 'awaiting_customer';
    }
    const [message] = await tx
      .insert(ticketMessages)
      .values({
        ticketId: t.id,
        authorUserId: input.staffUserId,
        authorRole: 'staff',
        body,
        internal: input.internal,
        channel: 'console',
      })
      .returning({ id: ticketMessages.id });
    // The first public answer stops the first-reply clock and clears the "new request" notice; a note never does.
    if (!input.internal) {
      await tx
        .update(supportTickets)
        .set({ firstRepliedAt: new Date() })
        .where(and(eq(supportTickets.id, t.id), isNull(supportTickets.firstRepliedAt)));
      await resolveNotices(tx, { kinds: ['staff.new_ticket'], entityIds: [t.id] });
    }
    if (
      !input.internal &&
      message &&
      t.channel === 'whatsapp' &&
      (await notificationChannelEnabled(tx, 'ticket.replied', 'whatsapp'))
    ) {
      const [person] = t.userId
        ? await tx
            .select({ phone: users.phone, language: users.language })
            .from(users)
            .where(eq(users.id, t.userId))
        : [{ phone: t.guestPhone, language: 'en' }];
      if (person?.phone) {
        await enqueueNotification(tx, {
          dedupeKey: `ticket.replied:${message.id}:whatsapp`,
          channel: 'whatsapp',
          recipientUserId: t.userId,
          recipient: person.phone,
          templateKey: 'ticket.replied',
          locale: person.language === 'hi' ? 'hi' : 'en',
          payload: { ticketCode: t.code },
        });
      }
    }
    // A reply on a ticket raised on WhatsApp is answered there; web and app tickets get the email.
    if (!input.internal && message && t.channel !== 'whatsapp')
      await queueTicketEmail(tx, {
        template: 'ticket_reply',
        entityId: message.id,
        version: 1,
        userId: t.userId,
        ticketCode: t.code,
      });
    return { status };
  });
}

export async function setTicketStatus(
  db: Tx,
  scope: TicketScope,
  input: { staffUserId: string; code: string; to: TicketStatus; expectedVersion: number },
): Promise<{ status: TicketStatus; version: number }> {
  return db.transaction(async (tx) => {
    const t = await lockScoped(tx, scope, input.code);
    const from = t.status as TicketStatus;
    ticketMachine.assert(from, input.to, 'admin');
    const [row] = await tx
      .update(supportTickets)
      .set({
        status: input.to,
        resolvedAt: input.to === 'resolved' ? new Date() : input.to === 'in_review' ? null : undefined,
        closedAt: input.to === 'closed' ? new Date() : undefined,
        closeReason: input.to === 'closed' ? 'staff' : undefined,
      })
      .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, input.expectedVersion)))
      .returning({ version: supportTickets.version });
    if (!row) throw new ConflictError('This request changed; reload and try again', 'STALE_TICKET');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'ticket.status_changed',
      entity: 'support_ticket',
      entityId: t.id,
      before: { status: from },
      after: { status: input.to },
    });
    // Any staff status change means someone picked the request up (the "new request" notice is done).
    await resolveNotices(tx, { kinds: ['staff.new_ticket'], entityIds: [t.id] });
    if (input.to === 'resolved' || input.to === 'closed') await resolveTicketReplyNotices(tx, t.id);
    if (input.to === 'resolved')
      await queueTicketEmail(tx, {
        template: 'ticket_resolved',
        entityId: t.id,
        version: row.version,
        userId: t.userId,
        ticketCode: t.code,
      });
    return { status: input.to, version: row.version };
  });
}

/**
 * Scope from the staff grants that hold `permission`: any all-city grant ⇒ every city. Reads use
 * `tickets:read`; replies and status changes use `tickets:reply` (security review 2026-11-03: a write must never
 * borrow the wider read scope).
 */
export function ticketScopeFrom(
  grants: readonly {
    permissions: readonly string[];
    cityId: string | null;
    shopId: string | null;
    workshopId: string | null;
  }[],
  permission: 'tickets:read' | 'tickets:reply' | 'tickets:assign' = 'tickets:read',
): TicketScope {
  const relevant = grants.filter(
    (g) => g.permissions.includes(permission) && g.shopId === null && g.workshopId === null,
  );
  if (relevant.some((g) => g.cityId === null)) return { all: true };
  return { all: false, cityIds: relevant.map((g) => g.cityId).filter((c): c is string => c !== null) };
}
