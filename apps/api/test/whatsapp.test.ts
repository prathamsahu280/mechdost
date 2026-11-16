/**
 * WhatsApp via the Meta Cloud API directly (decision 2026-11-02): template sends, error handling, the dispatcher
 * and the signed webhook (handshake, signature before parsing, dedupe, delivery receipts with pricing).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claimOutboxBatch, enqueueNotification, markOutboxSent, type OutboxRow } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { encryptField, loadKeyring } from '@mechdost/db/crypto';
import { ChannelError, backoffSeconds, dispatchOnce, type ChannelAdapter } from '../src/notify/dispatcher';
import { createWhatsAppAdapter } from '../src/notify/whatsapp';
import { buildApp } from './helpers';

const CFG = { phoneNumberId: '123456789012345', accessToken: 'EAAG-test-token-123456', apiVersion: 'v23.0' };
const SECRET = 'app-secret-0123456789abcdef';
const VERIFY = 'verify-token-0123456789';
const WA_ENV = {
  WHATSAPP_ENABLED: 'on',
  WHATSAPP_PHONE_NUMBER_ID: CFG.phoneNumberId,
  WHATSAPP_ACCESS_TOKEN: CFG.accessToken,
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY,
};

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  channel: 'whatsapp',
  recipientUserId: null,
  recipient: '+919876543210',
  templateKey: 'order.out_for_delivery',
  locale: 'hi',
  payload: { orderCode: 'MD-RPR-2026-7K3QWX' },
  attempts: 1,
  claimToken: '0192f3a4-5b6c-7d8e-9f01-000000000001',
  ...over,
});

function fakeMeta(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('WhatsApp adapter (Meta Cloud API direct)', () => {
  it('sends an approved utility template with positional params and the URL button', async () => {
    const meta = fakeMeta(200, { messages: [{ id: 'wamid.ABC' }] });
    const adapter = createWhatsAppAdapter(CFG, { fetchImpl: meta.fetchImpl });
    expect(await adapter.send(row())).toEqual({ providerId: 'wamid.ABC' });
    const call = meta.calls[0]!;
    expect(call.url).toBe('https://graph.facebook.com/v23.0/123456789012345/messages');
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${CFG.accessToken}`);
    const body = JSON.parse(call.init.body as string) as {
      to: string;
      template: {
        name: string;
        language: { code: string };
        components: { type: string; parameters: { text: string }[] }[];
      };
    };
    expect(body.to).toBe('919876543210');
    expect(body.template.name).toBe('order_out_for_delivery');
    expect(body.template.language.code).toBe('hi');
    // The delivery code is never in a WhatsApp message (user 2026-11-14); the button opens the order page.
    expect(body.template.components[0]?.parameters.map((p) => p.text)).toEqual(['MD-RPR-2026-7K3QWX']);
    expect(body.template.components[1]).toMatchObject({
      type: 'button',
      parameters: [{ text: 'MD-RPR-2026-7K3QWX' }],
    });
  });

  it('never calls Meta for bad input', async () => {
    const meta = fakeMeta(200, {});
    const adapter = createWhatsAppAdapter(CFG, { fetchImpl: meta.fetchImpl });
    for (const bad of [
      row({ templateKey: 'promo.oil_sale' }),
      row({ recipient: '9876543210' }),
      row({ payload: { orderCode: 'MD-1\nhello' } }),
    ]) {
      await expect(adapter.send(bad)).rejects.toMatchObject({ failure: 'permanent' });
    }
    expect(meta.calls).toHaveLength(0);
  });

  it('maps Meta errors to retry, 24 h later, or permanent', async () => {
    const cases: [number, unknown, string][] = [
      [400, { error: { code: 131026 } }, 'permanent'],
      [400, { error: { code: 131049 } }, 'later'],
      [429, { error: { code: 130429 } }, 'retry'],
      [503, {}, 'retry'],
      [200, {}, 'retry'],
    ];
    for (const [status, body, failure] of cases) {
      const adapter = createWhatsAppAdapter(CFG, { fetchImpl: fakeMeta(status, body).fetchImpl });
      await expect(adapter.send(row())).rejects.toMatchObject({ failure });
    }
  });
});

describe('notification dispatcher', () => {
  it('sends, retries with backoff and fails permanently, recording each outcome', async () => {
    const { db } = await buildApp();
    const keys = ['wa-ok', 'wa-retry', 'wa-dead'].map((k) => `${k}-${String(Date.now())}`);
    for (const k of keys) {
      await enqueueNotification(db, {
        dedupeKey: k,
        channel: 'whatsapp',
        recipient: '+919876543210',
        templateKey: 'order.confirmed',
        payload: { orderCode: k },
      });
    }
    const adapter: ChannelAdapter = {
      channel: 'whatsapp',
      send: (r) => {
        const code = String(r.payload.orderCode);
        if (code.startsWith('wa-retry')) return Promise.reject(new ChannelError('retry', 'meta_130429'));
        if (code.startsWith('wa-dead')) return Promise.reject(new ChannelError('permanent', 'meta_131026'));
        return Promise.resolve({ providerId: `wamid.${code}` });
      },
    };
    const result = await dispatchOnce(db, [adapter]);
    expect(result).toMatchObject({ sent: 1, retried: 1, failed: 1, skipped: 0 });
    const rows = await db.select().from(s.notificationOutbox);
    const byKey = new Map(rows.map((r) => [r.dedupeKey, r]));
    expect(byKey.get(keys[0]!)?.status).toBe('sent');
    expect(byKey.get(keys[1]!)?.status).toBe('pending');
    expect(byKey.get(keys[2]!)).toMatchObject({ status: 'failed', lastError: 'meta_131026' });
    expect([1, 2, 3, 10].map(backoffSeconds)).toEqual([30, 60, 120, 3600]);
  });

  it('a send that hangs is cut at its deadline: retry with code send_timeout, the tick is not held (incident 2026-11-16)', async () => {
    const { db } = await buildApp();
    const k = `wa-hang-${String(Date.now())}`;
    await enqueueNotification(db, {
      dedupeKey: k,
      channel: 'whatsapp',
      recipient: '+919876543210',
      templateKey: 'order.confirmed',
      payload: { orderCode: k },
    });
    const adapter: ChannelAdapter = {
      channel: 'whatsapp',
      send: () => new Promise<{ providerId: string | null }>(() => undefined),
    };
    const phase = { current: 'idle', since: 0 };
    const started = Date.now();
    const result = await dispatchOnce(db, [adapter], { sendDeadlineMs: 200, phase });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ claimed: 1, sent: 0, retried: 1 });
    const row = (await db.select().from(s.notificationOutbox)).find((r) => r.dedupeKey === k);
    expect(row).toMatchObject({ status: 'pending', lastError: 'send_timeout' });
    expect(phase.current).toBe('idle');
  });
});

function signed(body: string, secret = SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('WhatsApp webhook', () => {
  it('is not exposed while WhatsApp is off', async () => {
    const { app } = await buildApp();
    expect((await app.request('/webhooks/whatsapp?hub.mode=subscribe')).status).toBe(404);
  });

  it('answers Meta’s handshake only with the right verify token', async () => {
    const { app } = await buildApp({ env: WA_ENV });
    const ok = await app.request(
      `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');
    const bad = await app.request(
      '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
    );
    expect(bad.status).toBe(403);
  });

  it('rejects unsigned or wrongly signed deliveries before reading them', async () => {
    const { app } = await buildApp({ env: WA_ENV });
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    for (const sig of [undefined, 'sha256=00', signed(body, 'another-secret-0123456')]) {
      const res = await app.request('/webhooks/whatsapp', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) },
      });
      expect(res.status).toBe(401);
    }
  });

  it('records receipts once and stores inbound messages for the ticket bridge', async () => {
    const { app, db } = await buildApp({ env: WA_ENV });
    const key = `wa-receipt-${String(Date.now())}`;
    await enqueueNotification(db, {
      dedupeKey: key,
      channel: 'whatsapp',
      recipient: '+919876543210',
      templateKey: 'order.confirmed',
      payload: { orderCode: 'MD-RPR-2026-7K3QWX' },
    });
    const queued = (await db.select().from(s.notificationOutbox)).find((r) => r.dedupeKey === key);
    const claimed = (await claimOutboxBatch(db, { channels: ['whatsapp'] })).find((r) => r.id === queued!.id);
    expect(await markOutboxSent(db, claimed!, 'wamid.RECEIPT1')).toBe(true);
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'wamid.RECEIPT1',
                    status: 'delivered',
                    timestamp: '1793612400',
                    recipient_id: '919876543210',
                    pricing: { category: 'utility', billable: true },
                  },
                ],
                messages: [
                  {
                    id: 'wamid.IN1',
                    from: '919876543210',
                    timestamp: '1793612460',
                    type: 'text',
                    text: { body: 'Where is my order?' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    for (let i = 0; i < 2; i += 1) {
      const res = await app.request('/webhooks/whatsapp', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed(body) },
      });
      expect(res.status).toBe(200);
    }
    const outbox = (await db.select().from(s.notificationOutbox)).find((r) => r.dedupeKey === key);
    expect(outbox).toMatchObject({ pricingCategory: 'utility', billable: true });
    expect(outbox?.deliveredAt?.toISOString()).toBe(new Date(1793612400 * 1000).toISOString());
    const events = await db.select().from(s.webhookEvents);
    expect(
      events
        .filter((e) => e.provider === 'whatsapp')
        .map((e) => [e.id, e.status])
        .sort(),
    ).toEqual([
      ['wa:wamid.IN1', 'received'],
      ['wa:wamid.RECEIPT1:delivered', 'processed'],
    ]);
  });
});

describe('encrypted payload fields (delivery code)', () => {
  const ring = loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: randomBytes(32).toString('base64'),
  });

  it('the adapter receives the opened code; without the keyring the message fails, never sends', async () => {
    const { db } = await buildApp();
    const seen: Record<string, unknown>[] = [];
    const adapter: ChannelAdapter = {
      channel: 'whatsapp',
      send: (r) => {
        seen.push(r.payload);
        return Promise.resolve({ providerId: `wamid.enc${String(seen.length)}` });
      },
    };
    const queue = async (key: string) =>
      enqueueNotification(db, {
        dedupeKey: key,
        channel: 'whatsapp',
        recipient: '+919876543210',
        templateKey: 'order.out_for_delivery',
        payload: {
          orderCode: 'MD-RPR-2026-7K3QWX',
          deliveryCodeEnc: encryptField('4821', ring, 'notification_outbox.payload.deliveryCode'),
        },
      });
    await queue(`enc-ok-${String(Date.now())}`);
    expect(await dispatchOnce(db, [adapter], { keyring: ring })).toMatchObject({ sent: 1 });
    expect(seen.at(-1)).toEqual({ orderCode: 'MD-RPR-2026-7K3QWX', deliveryCode: '4821' });

    const before = seen.length;
    const key = `enc-nokey-${String(Date.now())}`;
    await queue(key);
    expect(await dispatchOnce(db, [adapter], { keyring: null })).toMatchObject({ failed: 1, sent: 0 });
    expect(seen).toHaveLength(before);
    const row = (await db.select().from(s.notificationOutbox)).find((r) => r.dedupeKey === key);
    expect(row).toMatchObject({ status: 'failed', lastError: 'payload_decrypt' });
  });
});
