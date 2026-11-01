import { and, eq, sql } from 'drizzle-orm';
import { notificationOutbox, webhookEvents } from '../schema';
import type { Tx } from './orders';

/**
 * Notification outbox (spec 10). Rows are written in the business transaction (dedupe key UNIQUE, so a retried
 * transaction or a double click never sends twice); the dispatcher in the worker claims due rows with
 * `FOR UPDATE SKIP LOCKED` and a lease, sends through the channel adapter, then records the result.
 * Delivery receipts from providers update the same row (cost + delivery analytics, rule 16).
 */
export type Channel = 'inapp' | 'email' | 'sms' | 'whatsapp' | 'push';
export type Locale = 'en' | 'hi';

export interface OutboxInput {
  dedupeKey: string;
  channel: Channel;
  recipientUserId?: string | null;
  /** Channel address (E.164 phone for WhatsApp/SMS, email for email). */
  recipient?: string | null;
  templateKey: string;
  locale?: Locale;
  payload?: Record<string, string | number>;
}

/** Idempotent: returns false when this dedupe key was already queued. */
export async function enqueueNotification(db: Tx, input: OutboxInput): Promise<boolean> {
  const rows = await db
    .insert(notificationOutbox)
    .values({
      dedupeKey: input.dedupeKey,
      channel: input.channel,
      recipientUserId: input.recipientUserId ?? null,
      recipient: input.recipient ?? null,
      templateKey: input.templateKey,
      locale: input.locale ?? 'en',
      payload: input.payload ?? {},
    })
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
    .returning({ id: notificationOutbox.id });
  return rows.length > 0;
}

export interface OutboxRow {
  id: string;
  channel: Channel;
  recipientUserId: string | null;
  recipient: string | null;
  templateKey: string;
  locale: Locale;
  payload: Record<string, unknown>;
  attempts: number;
  /** Fencing token of this claim; required to renew the lease and to record the outcome. */
  claimToken: string;
}

interface RawOutbox {
  id: string;
  channel: Channel;
  recipient_user_id: string | null;
  recipient: string | null;
  template_key: string;
  locale: Locale;
  payload: Record<string, unknown> | string;
  attempts: number;
  claim_token: string;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

export const OUTBOX_LEASE_SECONDS = 120;

/**
 * Claims due rows for the given channels only (channels without an adapter are left untouched). Each claimed row
 * gets a fresh `claim_token`; a sender that took longer than the lease loses the row to the next claim and can no
 * longer renew or record it (security review 2026-11-02: no double sends).
 */
export async function claimOutboxBatch(
  db: Tx,
  opts: { channels: readonly Channel[]; limit?: number; leaseSeconds?: number },
): Promise<OutboxRow[]> {
  if (opts.channels.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const lease = Math.min(Math.max(opts.leaseSeconds ?? OUTBOX_LEASE_SECONDS, 10), 900);
  const result = await db.execute(sql`
    update notification_outbox
    set claimed_at = now(), claim_token = gen_random_uuid(), attempts = attempts + 1
    where id in (
      select id from notification_outbox
      where status = 'pending'
        and next_attempt_at <= now()
        and channel in (${sql.join(
          opts.channels.map((c) => sql`${c}`),
          sql`, `,
        )})
        and (claimed_at is null or claimed_at < now() - make_interval(secs => ${lease}))
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id, channel, recipient_user_id, recipient, template_key, locale, payload, attempts, claim_token`);
  return rowsOf<RawOutbox>(result).map((r) => ({
    id: r.id,
    channel: r.channel,
    recipientUserId: r.recipient_user_id,
    recipient: r.recipient,
    templateKey: r.template_key,
    locale: r.locale,
    payload: typeof r.payload === 'string' ? (JSON.parse(r.payload) as Record<string, unknown>) : r.payload,
    attempts: r.attempts,
    claimToken: r.claim_token,
  }));
}

/**
 * Re-checks and extends the lease immediately before a send. False = another sender reclaimed the row (our lease
 * ran out) or it is no longer pending: do NOT send.
 */
export async function renewOutboxClaim(db: Tx, row: Pick<OutboxRow, 'id' | 'claimToken'>): Promise<boolean> {
  const rows = await db
    .update(notificationOutbox)
    .set({ claimedAt: new Date() })
    .where(
      and(
        eq(notificationOutbox.id, row.id),
        eq(notificationOutbox.claimToken, row.claimToken),
        eq(notificationOutbox.status, 'pending'),
      ),
    )
    .returning({ id: notificationOutbox.id });
  return rows.length > 0;
}

const held = (row: Pick<OutboxRow, 'id' | 'claimToken'>) =>
  and(
    eq(notificationOutbox.id, row.id),
    eq(notificationOutbox.claimToken, row.claimToken),
    eq(notificationOutbox.status, 'pending'),
  );

export async function markOutboxSent(
  db: Tx,
  row: Pick<OutboxRow, 'id' | 'claimToken'>,
  providerId: string | null,
): Promise<boolean> {
  const rows = await db
    .update(notificationOutbox)
    .set({
      status: 'sent',
      sentAt: new Date(),
      providerId,
      claimedAt: null,
      claimToken: null,
      lastError: null,
    })
    .where(held(row))
    .returning({ id: notificationOutbox.id });
  return rows.length > 0;
}

/** Transient failure: back off (or 24 h for a WhatsApp marketing cap); after `maxAttempts` it becomes failed. */
export async function markOutboxRetry(
  db: Tx,
  row: Pick<OutboxRow, 'id' | 'claimToken'>,
  opts: { error: string; delaySeconds: number; maxAttempts?: number },
): Promise<'retry' | 'failed' | 'lost'> {
  const max = opts.maxAttempts ?? 6;
  const rows = await db.execute(sql`
    update notification_outbox
    set status = case when attempts >= ${max} then 'failed' else 'pending' end,
        claimed_at = null,
        claim_token = null,
        last_error = ${opts.error.slice(0, 200)},
        next_attempt_at = now() + make_interval(secs => ${Math.max(1, Math.round(opts.delaySeconds))})
    where id = ${row.id} and claim_token = ${row.claimToken} and status = 'pending'
    returning status`);
  const status = rowsOf<{ status: string }>(rows)[0]?.status;
  return status === undefined ? 'lost' : status === 'failed' ? 'failed' : 'retry';
}

export async function markOutboxFailed(
  db: Tx,
  row: Pick<OutboxRow, 'id' | 'claimToken'>,
  error: string,
): Promise<boolean> {
  const rows = await db
    .update(notificationOutbox)
    .set({ status: 'failed', claimedAt: null, claimToken: null, lastError: error.slice(0, 200) })
    .where(held(row))
    .returning({ id: notificationOutbox.id });
  return rows.length > 0;
}

/** Records a provider webhook delivery once; false means it was already seen (Meta retries deliveries). */
export async function recordWebhookEvent(
  db: Tx,
  input: {
    id: string;
    provider: string;
    type: string;
    payload: Record<string, unknown>;
    /** `received` = still to be handled by a job (e.g. inbound WhatsApp → support ticket). */
    status?: 'processed' | 'received';
  },
): Promise<boolean> {
  const status = input.status ?? 'processed';
  const rows = await db
    .insert(webhookEvents)
    .values({ ...input, status, processedAt: status === 'processed' ? new Date() : null })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}

/**
 * Applies a provider delivery receipt to the outbox row it belongs to. Receipts can arrive out of order
 * (read before delivered), so timestamps only move forward and `failed` after `sent` records the error.
 */
export async function applyDeliveryReceipt(
  db: Tx,
  input: {
    channel: Channel;
    providerId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    at: Date;
    pricingCategory?: string | null;
    billable?: boolean | null;
    errorCode?: number | null;
  },
): Promise<boolean> {
  const at = input.at.toISOString();
  const rows = await db.execute(sql`
    update notification_outbox set
      delivered_at = case when ${input.status} in ('delivered','read')
        then coalesce(least(delivered_at, ${at}::timestamptz), ${at}::timestamptz) else delivered_at end,
      read_at = case when ${input.status} = 'read'
        then coalesce(least(read_at, ${at}::timestamptz), ${at}::timestamptz) else read_at end,
      pricing_category = coalesce(${input.pricingCategory ?? null}, pricing_category),
      billable = coalesce(${input.billable ?? null}, billable),
      status = case when ${input.status} = 'failed' then 'failed' else status end,
      last_error = case when ${input.status} = 'failed'
        then ${`provider_${String(input.errorCode ?? 'unknown')}`} else last_error end
    where channel = ${input.channel} and provider_id = ${input.providerId}
    returning id`);
  return rowsOf(rows).length > 0;
}
