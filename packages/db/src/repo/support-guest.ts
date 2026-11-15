import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { parseSignInIdentifier } from '@mechdost/shared/auth';
import { publicCode } from '@mechdost/shared/ids';
import { ticketMachine, type TicketStatus } from '@mechdost/shared/state';
import {
  GUEST_TICKET_KINDS,
  GUEST_TICKETS_PER_PHONE_PER_DAY,
  type GuestTicketKind,
} from '@mechdost/shared/support-guest';
import { auditLog, supportTickets, ticketMessages } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';
import {
  ACTIVE_STATUSES,
  RESOLVE_MS,
  cleanBody,
  getTicketViewById,
  replyCap,
  type TicketView,
} from './support';
import { firstReplyDueAt } from './support-sla';

/**
 * Guest tickets (design 2026-11-15 item 6; spec 09/13). The reference is the ticket code; the private key is 16
 * random base-32 characters (80 bits), shown once and stored only as a SHA-256 hash (high entropy, so a plain hash
 * is enough). A wrong key and an unknown reference are the same "not found". Nothing is emailed or messaged to the
 * name or number a guest typed (unverified, project rule: no relay from public forms): the key is the way back.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newKey(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => ALPHABET.charAt(b % 32)).join('');
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4)).join('-');
}

/** Letters are case-insensitive; dashes and spaces are decoration (people type what was printed). */
export function normaliseGuestKey(key: string): string {
  return key.replace(/[\s-]/g, '').toUpperCase();
}

export function hashGuestKey(key: string): string {
  return createHash('sha256').update(normaliseGuestKey(key)).digest('hex');
}

function keyMatches(stored: string | null, key: string): boolean {
  const a = Buffer.from(stored ?? '0'.repeat(64), 'hex');
  const b = Buffer.from(hashGuestKey(key), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) && stored !== null;
}

export async function createGuestTicket(
  db: Tx,
  input: {
    name: string;
    phone: string;
    kind: GuestTicketKind;
    body: string;
    defaultCityCode: string;
    now?: Date;
  },
): Promise<{ code: string; accessKey: string }> {
  if (!GUEST_TICKET_KINDS.includes(input.kind))
    throw new ValidationError('Unknown request type', 'TICKET_KIND');
  const body = cleanBody(input.body);
  const name = input.name.trim();
  const parsed = parseSignInIdentifier(input.phone);
  if (name.length < 2 || name.length > 60) throw new ValidationError('Enter your name', 'GUEST_NAME_INVALID');
  if (parsed?.kind !== 'phone')
    throw new ValidationError('Enter a valid mobile number', 'GUEST_PHONE_INVALID');
  const phone = parsed.value;
  const accessKey = newKey();
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // Serialise per number so two parallel requests cannot both pass the daily limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`guest-ticket:${phone}`}, 0))`);
    const recent = await tx.$count(
      supportTickets,
      and(
        eq(supportTickets.guestPhone, phone),
        isNull(supportTickets.userId),
        gt(supportTickets.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
    if (recent >= GUEST_TICKETS_PER_PHONE_PER_DAY)
      throw new ValidationError('Too many requests from this number today', 'GUEST_DAILY_LIMIT');
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        code: publicCode('REQ', input.defaultCityCode, now),
        userId: null,
        guestName: name,
        guestPhone: phone,
        accessKeyHash: hashGuestKey(accessKey),
        kind: input.kind,
        channel: 'web',
        slaAckDue: await firstReplyDueAt(tx, now),
        slaResolveDue: new Date(now.getTime() + RESOLVE_MS),
      })
      .returning({ id: supportTickets.id, code: supportTickets.code });
    if (!ticket) throw new Error('ticket insert returned nothing');
    await tx.insert(ticketMessages).values({
      ticketId: ticket.id,
      authorRole: 'guest',
      body,
      channel: 'web',
    });
    // No name, phone or key in the audit row (rule 16: codes only).
    await tx.insert(auditLog).values({
      actorUserId: null,
      actorRole: 'guest',
      action: 'ticket.guest_created',
      entity: 'support_ticket',
      entityId: ticket.id,
      after: { code: ticket.code, kind: input.kind, channel: 'web' },
    });
    await recordServerEvent(tx, 'support_guest_ticket_created', { props: { kind: input.kind } });
    // Staff of all cities see it in their bell; the guest gets nothing (no relay to typed contact details).
    await queueStaffNotice(tx, {
      kind: 'staff.new_ticket',
      cityId: null,
      entityId: ticket.id,
      version: 1,
      params: { ticketCode: ticket.code },
    });
    return { code: ticket.code, accessKey };
  });
}

async function findByKey(db: Tx, code: string, key: string) {
  const [t] = await db
    .select({
      id: supportTickets.id,
      status: supportTickets.status,
      version: supportTickets.version,
      hash: supportTickets.accessKeyHash,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.code, code), isNull(supportTickets.userId)))
    .limit(1);
  // Same answer for an unknown reference, a wrong key and a signed-in customer's request.
  if (!t || !keyMatches(t.hash, key)) throw new NotFoundError('Request not found');
  return t;
}

export async function getGuestTicket(db: Tx, code: string, key: string): Promise<TicketView> {
  const t = await findByKey(db, code, key);
  return getTicketViewById(db, t.id);
}

/** The guest writes again; a request waiting on them or resolved returns to review (state machine). */
export async function guestReplyTicket(
  db: Tx,
  input: { code: string; key: string; body: string },
): Promise<{ status: TicketStatus }> {
  const body = cleanBody(input.body);
  await findByKey(db, input.code, input.key);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: supportTickets.id,
        status: supportTickets.status,
        version: supportTickets.version,
        hash: supportTickets.accessKeyHash,
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.code, input.code), isNull(supportTickets.userId)))
      .limit(1)
      .for('update');
    if (!t || !keyMatches(t.hash, input.key)) throw new NotFoundError('Request not found');
    let status = t.status as TicketStatus;
    if (status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    const today = await tx.$count(
      ticketMessages,
      and(
        eq(ticketMessages.ticketId, t.id),
        eq(ticketMessages.authorRole, 'guest'),
        gt(ticketMessages.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    );
    if (today >= (await replyCap(tx)))
      throw new ValidationError('Too many messages on this request today', 'REPLY_LIMIT');
    if (ACTIVE_STATUSES.includes(status) && status !== 'awaiting_customer') {
      // open / in review: nothing to move
    } else if (status === 'awaiting_customer' || status === 'resolved') {
      ticketMachine.assert(status, 'in_review', 'customer');
      const moved = await tx
        .update(supportTickets)
        .set({ status: 'in_review', resolvedAt: null })
        .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, t.version)))
        .returning({ id: supportTickets.id });
      if (moved.length === 0) throw new ConflictError('This request changed; try again', 'STALE_TICKET');
      status = 'in_review';
    }
    await tx.insert(ticketMessages).values({
      ticketId: t.id,
      authorRole: 'guest',
      body,
      channel: 'web',
    });
    await recordServerEvent(tx, 'support_guest_reply', { props: { ticketCode: input.code } });
    return { status };
  });
}
