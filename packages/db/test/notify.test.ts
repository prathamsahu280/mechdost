/**
 * Notification outbox (spec 10, WhatsApp decision 2026-11-02): never duplicated (dedupe key, webhook dedupe),
 * never lost (lease + retry), only channels with an adapter are claimed, and delivery receipts feed cost data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  applyDeliveryReceipt,
  claimOutboxBatch,
  enqueueNotification,
  markOutboxFailed,
  markOutboxRetry,
  markOutboxSent,
  renewOutboxClaim,
  recordWebhookEvent,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let n = 0;
const key = () => `order.confirmed:test-${++n}:whatsapp`;

async function rowOf(dedupeKey: string) {
  return (
    await db.select().from(s.notificationOutbox).where(eq(s.notificationOutbox.dedupeKey, dedupeKey))
  )[0]!;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.execute(sql`delete from notification_outbox`);
});

const wa = (dedupeKey: string) => ({
  dedupeKey,
  channel: 'whatsapp' as const,
  recipient: '+919876543210',
  templateKey: 'order.confirmed',
  payload: { orderCode: 'MD-RPR-2026-7K3QWX' },
});

describe('notification outbox', () => {
  it('queues each event once per channel, however often the transaction retries', async () => {
    const k = key();
    expect(await enqueueNotification(t(), wa(k))).toBe(true);
    expect(await enqueueNotification(t(), wa(k))).toBe(false);
    expect(await db.$count(s.notificationOutbox)).toBe(1);
  });

  it('claims only due rows of channels that have an adapter, once across parallel senders', async () => {
    await enqueueNotification(t(), wa(key()));
    await enqueueNotification(t(), wa(key()));
    await enqueueNotification(t(), { ...wa(key()), channel: 'sms' });
    const [a, b] = await Promise.all([
      claimOutboxBatch(t(), { channels: ['whatsapp'], limit: 1 }),
      claimOutboxBatch(t(), { channels: ['whatsapp'], limit: 5 }),
    ]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect([...a, ...b].every((r) => r.channel === 'whatsapp')).toBe(true);
    expect(await claimOutboxBatch(t(), { channels: ['whatsapp'] })).toHaveLength(0);
    expect(await claimOutboxBatch(t(), { channels: [] })).toHaveLength(0);
  });

  it('backs off on transient errors and gives up after the attempt limit', async () => {
    const k = key();
    await enqueueNotification(t(), wa(k));
    const [row] = await claimOutboxBatch(t(), { channels: ['whatsapp'] });
    expect(await markOutboxRetry(t(), row!, { error: 'meta_130429', delaySeconds: 60 })).toBe('retry');
    expect(await claimOutboxBatch(t(), { channels: ['whatsapp'] })).toHaveLength(0); // not due yet
    await db.execute(sql`update notification_outbox set next_attempt_at = now() - interval '1 second'`);
    const [again] = await claimOutboxBatch(t(), { channels: ['whatsapp'] });
    expect(again?.attempts).toBe(2);
    expect(
      await markOutboxRetry(t(), again!, { error: 'meta_130429', delaySeconds: 60, maxAttempts: 2 }),
    ).toBe('failed');
    expect((await rowOf(k)).status).toBe('failed');
  });

  it('a crashed sender loses nothing: the lease lapses and the row is claimed again', async () => {
    await enqueueNotification(t(), wa(key()));
    expect(await claimOutboxBatch(t(), { channels: ['whatsapp'] })).toHaveLength(1);
    await db.execute(sql`update notification_outbox set claimed_at = now() - interval '5 minutes'`);
    expect(await claimOutboxBatch(t(), { channels: ['whatsapp'], leaseSeconds: 60 })).toHaveLength(1);
  });

  it('a slow sender whose lease lapsed can neither send nor record (no double send)', async () => {
    const k = key();
    await enqueueNotification(t(), wa(k));
    const [slow] = await claimOutboxBatch(t(), { channels: ['whatsapp'] });
    expect(await renewOutboxClaim(t(), slow!)).toBe(true);
    // The slow sender stalls past its lease; another sender reclaims the row.
    await db.execute(sql`update notification_outbox set claimed_at = now() - interval '10 minutes'`);
    const [fast] = await claimOutboxBatch(t(), { channels: ['whatsapp'], leaseSeconds: 60 });
    expect(fast?.claimToken).not.toBe(slow?.claimToken);
    expect(await renewOutboxClaim(t(), slow!)).toBe(false); // the dispatcher skips the send
    expect(await markOutboxSent(t(), slow!, 'wamid.SLOW')).toBe(false);
    expect(await markOutboxFailed(t(), slow!, 'late')).toBe(false);
    expect(await markOutboxRetry(t(), slow!, { error: 'late', delaySeconds: 1 })).toBe('lost');
    expect(await markOutboxSent(t(), fast!, 'wamid.FAST')).toBe(true);
    expect(await rowOf(k)).toMatchObject({ status: 'sent', providerId: 'wamid.FAST', claimToken: null });
  });

  it('records delivery receipts in any order, with Meta pricing for cost analytics', async () => {
    const k = key();
    await enqueueNotification(t(), wa(k));
    const [row] = await claimOutboxBatch(t(), { channels: ['whatsapp'] });
    await markOutboxSent(t(), row!, 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS');
    const read = new Date('2026-11-02T10:05:00Z');
    const delivered = new Date('2026-11-02T10:01:00Z');
    expect(
      await applyDeliveryReceipt(t(), {
        channel: 'whatsapp',
        providerId: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS',
        status: 'read',
        at: read,
      }),
    ).toBe(true);
    await applyDeliveryReceipt(t(), {
      channel: 'whatsapp',
      providerId: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS',
      status: 'delivered',
      at: delivered,
      pricingCategory: 'utility',
      billable: true,
    });
    const after = await rowOf(k);
    expect(after).toMatchObject({ status: 'sent', pricingCategory: 'utility', billable: true });
    expect(after.readAt?.toISOString()).toBe(read.toISOString());
    expect(after.deliveredAt?.toISOString()).toBe(
      read.toISOString() < delivered.toISOString() ? read.toISOString() : delivered.toISOString(),
    );
    expect(
      await applyDeliveryReceipt(t(), {
        channel: 'whatsapp',
        providerId: 'wamid.unknown',
        status: 'read',
        at: read,
      }),
    ).toBe(false);
  });

  it('refuses unknown pricing categories and duplicate provider ids', async () => {
    const k1 = key();
    const k2 = key();
    await enqueueNotification(t(), wa(k1));
    await enqueueNotification(t(), wa(k2));
    await db
      .update(s.notificationOutbox)
      .set({ providerId: 'wamid.same' })
      .where(eq(s.notificationOutbox.dedupeKey, k1));
    await expect(
      db
        .update(s.notificationOutbox)
        .set({ providerId: 'wamid.same' })
        .where(eq(s.notificationOutbox.dedupeKey, k2)),
    ).rejects.toThrow();
    await expect(
      db
        .update(s.notificationOutbox)
        .set({ pricingCategory: 'free' })
        .where(eq(s.notificationOutbox.dedupeKey, k1)),
    ).rejects.toThrow();
  });

  it('dedupes provider webhook deliveries (Meta retries)', async () => {
    const event = {
      id: 'wa:wamid.X:delivered',
      provider: 'whatsapp',
      type: 'status',
      payload: { s: 'delivered' },
    };
    expect(await recordWebhookEvent(t(), event)).toBe(true);
    expect(await recordWebhookEvent(t(), event)).toBe(false);
  });
});
