import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import { ticketMachine, type TicketStatus } from '@mechdost/shared/state';
import { auditLog, cities, orderGroups, orders, supportTickets, ticketMessages, users } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification } from './notify';
import type { Tx } from './orders';

/**
 * Support tickets (spec 09) — the real counterpart of the demo store. Customers raise and follow their own
 * requests (foreign codes are 404); staff work an inbox scoped by city (rule 7: all-city staff see everything,
 * city staff see requests about their cities' orders). Every status change goes through `ticketMachine` as a
 * compare-and-set; every creation is audited. Customer limit: 5 requests per 24 h (serialised per user).
 */
export const TICKET_KINDS = ['order_issue', 'refund', 'fitment', 'account', 'other'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
export const DAILY_TICKET_LIMIT = 5;
export const TICKET_BODY_MAX = 2000;
const ACK_MS = 48 * 3_600_000;
const RESOLVE_MS = 30 * 86_400_000;
const ACTIVE: TicketStatus[] = ['open', 'in_review', 'awaiting_customer'];

/** Staff scope from their grants: every city, or a list of city ids. */
export type TicketScope = { all: true } | { all: false; cityIds: readonly string[] };

export interface TicketMessageView {
  id: string;
  role: string;
  body: string;
  internal: boolean;
  channel: string;
  createdAt: Date;
}

export interface TicketView {
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
  messages: TicketMessageView[];
}

function cleanBody(body: string): string {
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
    .orderBy(ticketMessages.createdAt);
  return rows;
}

const ticketColumns = {
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

async function view(db: Tx, row: { id: string } & Omit<TicketView, 'messages'>, internal: boolean) {
  const { id, ...rest } = row;
  return { ...rest, status: rest.status, messages: await messagesOf(db, id, internal) };
}

// ── customer ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function createSupportTicket(
  db: Tx,
  input: {
    userId: string;
    kind: TicketKind;
    orderCode: string | null;
    body: string;
    defaultCityCode: string;
  },
): Promise<{ code: string }> {
  if (!TICKET_KINDS.includes(input.kind)) throw new ValidationError('Unknown request type', 'TICKET_KIND');
  const body = cleanBody(input.body);
  return db.transaction(async (tx) => {
    // Serialise per user so two parallel requests cannot both pass the daily limit.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ticket-create:${input.userId}`}, 0))`,
    );
    const now = new Date();
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
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        code: publicCode('REQ', cityCode, now),
        userId: input.userId,
        kind: input.kind,
        orderId,
        cityId,
        channel: 'web',
        slaAckDue: new Date(now.getTime() + ACK_MS),
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

export async function getMyTicket(db: Tx, userId: string, code: string): Promise<TicketView> {
  const [row] = await db
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .where(and(eq(supportTickets.code, code), eq(supportTickets.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError('Request not found');
  return view(db, { ...row, status: row.status as TicketStatus }, false);
}

/** The customer writes again; a ticket waiting on them or resolved returns to review (state machine). */
export async function customerReplyTicket(
  db: Tx,
  input: { userId: string; code: string; body: string },
): Promise<{ status: TicketStatus }> {
  const body = cleanBody(input.body);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: supportTickets.id, status: supportTickets.status, version: supportTickets.version })
      .from(supportTickets)
      .where(and(eq(supportTickets.code, input.code), eq(supportTickets.userId, input.userId)))
      .limit(1)
      .for('update');
    if (!t) throw new NotFoundError('Request not found');
    let status = t.status as TicketStatus;
    if (status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    if (status === 'awaiting_customer' || status === 'resolved') {
      ticketMachine.assert(status, 'in_review', 'customer');
      await tx
        .update(supportTickets)
        .set({ status: 'in_review', resolvedAt: null })
        .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, t.version)));
      status = 'in_review';
    }
    await tx.insert(ticketMessages).values({
      ticketId: t.id,
      authorUserId: input.userId,
      authorRole: 'customer',
      body,
      channel: 'web',
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
  /** True once staff have replied to the customer at least once (acknowledged). */
  acknowledged: boolean;
}

export async function listInbox(
  db: Tx,
  scope: TicketScope,
  opts: { view?: 'active' | 'done'; limit?: number } = {},
): Promise<InboxRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const statusFilter =
    (opts.view ?? 'active') === 'active'
      ? inArray(supportTickets.status, ACTIVE)
      : inArray(supportTickets.status, ['resolved', 'closed']);
  const rows = await db
    .select({
      ...ticketColumns,
      acknowledged: sql<boolean>`exists (select 1 from ${ticketMessages} m where m.ticket_id = ${supportTickets.id} and m.author_role = 'staff' and m.internal = false)`,
    })
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .where(and(statusFilter, scopeFilter(scope)))
    .orderBy(supportTickets.slaAckDue)
    .limit(limit);
  return rows.map(({ id: _id, ...r }) => ({
    ...r,
    status: r.status as TicketStatus,
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

export async function getInboxTicket(db: Tx, scope: TicketScope, code: string): Promise<TicketView> {
  const [row] = await db
    .select(ticketColumns)
    .from(supportTickets)
    .leftJoin(orders, eq(orders.id, supportTickets.orderId))
    .leftJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .where(and(eq(supportTickets.code, code), scopeFilter(scope)))
    .limit(1);
  if (!row) throw new NotFoundError('Request not found');
  return view(db, { ...row, status: row.status as TicketStatus }, true);
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
  permission: 'tickets:read' | 'tickets:reply' = 'tickets:read',
): TicketScope {
  const relevant = grants.filter(
    (g) => g.permissions.includes(permission) && g.shopId === null && g.workshopId === null,
  );
  if (relevant.some((g) => g.cityId === null)) return { all: true };
  return { all: false, cityIds: relevant.map((g) => g.cityId).filter((c): c is string => c !== null) };
}
