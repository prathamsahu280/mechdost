import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import { ticketMachine, type TicketStatus } from '@mechdost/shared/state';
import { auditLog, supportTickets, ticketMessages, users, webhookEvents } from '../schema';
import { pgCode } from './errors';
import type { Tx } from './orders';

/**
 * Inbound WhatsApp → support tickets (spec 09; decision 2026-11-02, settles pending #3 "WhatsApp handoff").
 * The webhook stores each customer message once (`webhook_events`, status `received`); this job turns it into a
 * ticket message, one event per transaction:
 * - known customer (phone matches an active account) or guest (phone only);
 * - appended to their latest open / in-review / waiting ticket, or to one resolved in the last 7 days (which
 *   reopens it through the ticket state machine); otherwise a new `REQ-…` ticket with SLA dues (ack 48 h,
 *   resolve 30 days, Consumer Protection E-Commerce Rules);
 * - `ticket_messages (channel, external_id)` is unique, so a redelivered or retried message is never stored twice.
 * Staff reply in the admin inbox; the reply goes back on WhatsApp as a free-form message inside the 24 h window.
 */
const REOPEN_DAYS = 7;
const ACK_HOURS = 48;
const RESOLVE_DAYS = 30;
const ACTIVE: TicketStatus[] = ['open', 'in_review', 'awaiting_customer'];

interface InboundPayload {
  from?: unknown;
  type?: unknown;
  text?: unknown;
}

export interface BridgeResult {
  processed: number;
  created: number;
  appended: number;
  skipped: number;
  /** Events that threw; retried next run, parked after MAX_ATTEMPTS (a poison message never blocks the queue). */
  failed: number;
}

const MAX_ATTEMPTS = 5;

/** Message text: the customer's words, or a code for media we do not import yet (e.g. `[image]`). */
function bodyOf(p: InboundPayload): string {
  if (typeof p.text === 'string' && p.text.trim() !== '') return p.text.trim().slice(0, 5000);
  const type = typeof p.type === 'string' && /^[a-z_]{1,30}$/.test(p.type) ? p.type : 'message';
  return `[${type}]`;
}

export async function bridgeInboundWhatsApp(
  db: Tx,
  opts: { cityCode: string; limit?: number; now?: Date },
): Promise<BridgeResult> {
  const result: BridgeResult = { processed: 0, created: 0, appended: 0, skipped: 0, failed: 0 };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  for (let i = 0; i < limit; i += 1) {
    // Array (not a let): the id is set inside the transaction callback, which TS narrowing cannot see.
    const claimed: string[] = [];
    let done: boolean;
    try {
      done = await db.transaction(async (tx) => {
        const [event] = await tx
          .select({ id: webhookEvents.id, payload: webhookEvents.payload })
          .from(webhookEvents)
          .where(
            and(
              eq(webhookEvents.provider, 'whatsapp'),
              eq(webhookEvents.type, 'message'),
              eq(webhookEvents.status, 'received'),
            ),
          )
          .orderBy(webhookEvents.receivedAt)
          .limit(1)
          .for('update', { skipLocked: true });
        if (!event) return false;
        claimed.push(event.id);
        const now = opts.now ?? new Date();
        const payload = event.payload as InboundPayload;
        const from = typeof payload.from === 'string' ? payload.from : '';
        const markDone = (status: 'processed' | 'parked', error?: string) =>
          tx
            .update(webhookEvents)
            .set({
              status,
              processedAt: now,
              error: error ?? null,
              attempts: sql`${webhookEvents.attempts} + 1`,
            })
            .where(eq(webhookEvents.id, event.id));
        if (!/^[1-9][0-9]{7,14}$/.test(from)) {
          await markDone('parked', 'bad_sender');
          result.skipped += 1;
          return true;
        }
        const phone = `+${from}`;
        const externalId = event.id.replace(/^wa:/, '');
        // Two messages from the same number handled by two workers must not open two tickets: serialise per phone.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wa-ticket:${phone}`}, 0))`);
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.phone, phone), eq(users.status, 'active'), isNull(users.deletedAt)))
          .limit(1);
        const owner = user ? eq(supportTickets.userId, user.id) : eq(supportTickets.guestPhone, phone);
        const reopenAfter = new Date(now.getTime() - REOPEN_DAYS * 86_400_000);
        const [ticket] = await tx
          .select({ id: supportTickets.id, status: supportTickets.status, version: supportTickets.version })
          .from(supportTickets)
          .where(
            and(
              owner,
              or(
                inArray(supportTickets.status, ACTIVE),
                and(eq(supportTickets.status, 'resolved'), gt(supportTickets.resolvedAt, reopenAfter)),
              ),
            ),
          )
          .orderBy(desc(supportTickets.createdAt))
          .limit(1)
          .for('update');

        let ticketId: string;
        if (ticket) {
          ticketId = ticket.id;
          const status = ticket.status as TicketStatus;
          if (status === 'awaiting_customer' || status === 'resolved') {
            ticketMachine.assert(status, 'in_review', 'customer');
            await tx
              .update(supportTickets)
              .set({ status: 'in_review', resolvedAt: null })
              .where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.version, ticket.version)));
          }
        } else {
          const [created] = await tx
            .insert(supportTickets)
            .values({
              code: publicCode('REQ', opts.cityCode, now),
              userId: user?.id ?? null,
              guestPhone: user ? null : phone,
              // Guests follow up on WhatsApp; the web tracking key is random and never shown.
              accessKeyHash: user ? null : createHash('sha256').update(randomBytes(32)).digest('hex'),
              kind: 'other',
              channel: 'whatsapp',
              slaAckDue: new Date(now.getTime() + ACK_HOURS * 3_600_000),
              slaResolveDue: new Date(now.getTime() + RESOLVE_DAYS * 86_400_000),
            })
            .returning({ id: supportTickets.id, code: supportTickets.code });
          if (!created) throw new Error('ticket insert returned nothing');
          ticketId = created.id;
          await tx.insert(auditLog).values({
            actorRole: 'system',
            action: 'ticket.created',
            entity: 'support_ticket',
            entityId: created.id,
            after: { code: created.code, channel: 'whatsapp', guest: !user },
          });
        }
        const inserted = await tx
          .insert(ticketMessages)
          .values({
            ticketId,
            authorUserId: user?.id ?? null,
            authorRole: user ? 'customer' : 'guest',
            body: bodyOf(payload),
            channel: 'whatsapp',
            externalId,
          })
          .onConflictDoNothing()
          .returning({ id: ticketMessages.id });
        await markDone('processed');
        result.processed += 1;
        if (inserted.length === 0) result.skipped += 1;
        else if (ticket) result.appended += 1;
        else result.created += 1;
        return true;
      });
    } catch (err) {
      const failedId = claimed.at(-1);
      if (failedId === undefined) throw err;
      // Count the failure outside the rolled-back transaction; park after MAX_ATTEMPTS. Store a code, never the
      // message (it can contain the customer's text or number).
      result.failed += 1;
      await db
        .update(webhookEvents)
        .set({
          attempts: sql`${webhookEvents.attempts} + 1`,
          status: sql`case when ${webhookEvents.attempts} + 1 >= ${MAX_ATTEMPTS} then 'parked' else ${webhookEvents.status} end`,
          error: pgCode(err) ?? (err instanceof Error ? err.name : 'error'),
        })
        .where(eq(webhookEvents.id, failedId));
      break; // retry on the next run, a few seconds later
    }
    if (!done) break;
  }
  return result;
}
