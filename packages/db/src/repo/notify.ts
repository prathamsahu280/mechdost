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
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

/** Claims due rows for the given channels only (channels without an adapter are left untouched). */
export async function claimOutboxBatch(
  db: Tx,
  opts: { channels: readonly Channel[]; limit?: number; leaseSeconds?: number },
): Promise<OutboxRow[]> {
  if (opts.channels.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const lease = Math.min(Math.max(opts.leaseSeconds ?? 60, 10), 900);
  const result = await db.execute(sql`
    update notification_outbox set claimed_at = now(), attempts = attempts + 1
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
    returning id, channel, recipient_user_id, recipient, template_key, locale, payload, attempts`);
  return rowsOf<RawOutbox>(result).map((r) => ({
    id: r.id,
    channel: r.channel,
    recipientUserId: r.recipient_user_id,
    recipient: r.recipient,
    templateKey: r.template_key,
    locale: r.locale,
    payload: typeof r.payload === 'string' ? (JSON.parse(r.payload) as Record<string, unknown>) : r.payload,
    attempts: r.attempts,
  }));
}

export async function markOutboxSent(db: Tx, id: string, providerId: string | null): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({ status: 'sent', sentAt: new Date(), providerId, claimedAt: null, lastError: null })
    .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'pending')));
}

/** Transient failure: back off (or 24 h for a WhatsApp marketing cap); after `maxAttempts` it becomes failed. */
export async function markOutboxRetry(
  db: Tx,
  id: string,
  opts: { error: string; delaySeconds: number; maxAttempts?: number },
): Promise<'retry' | 'failed'> {
  const max = opts.maxAttempts ?? 6;
  const rows = await db.execute(sql`
    update notification_outbox
    set status = case when attempts >= ${max} then 'failed' else 'pending' end,
        claimed_at = null,
        last_error = ${opts.error.slice(0, 200)},
        next_attempt_at = now() + make_interval(secs => ${Math.max(1, Math.round(opts.delaySeconds))})
    where id = ${id} and status = 'pending'
    returning status`);
  return rowsOf<{ status: string }>(rows)[0]?.status === 'failed' ? 'failed' : 'retry';
}

export async function markOutboxFailed(db: Tx, id: string, error: string): Promise<void> {
  await db
    .update(notificationOutbox)
    .set({ status: 'failed', claimedAt: null, lastError: error.slice(0, 200) })
    .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'pending')));
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
