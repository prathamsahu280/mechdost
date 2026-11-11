import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { recordDeliveryReceipt, recordWebhookEvent } from '@mechdost/db/repo';
import { log } from '../logger';
import type { AppDeps, AppEnv } from '../types';

/**
 * Meta WhatsApp Cloud API webhook (decision 2026-11-02; docs/research/whatsapp.md §2.1 step 9).
 * - GET: subscription handshake (`hub.verify_token` must match WHATSAPP_VERIFY_TOKEN).
 * - POST: `X-Hub-Signature-256` = HMAC-SHA256(app secret, raw body), compared in constant time BEFORE parsing.
 *   Each status/message is recorded once (`webhook_events`, Meta retries deliveries); delivery receipts update
 *   the outbox row (delivered/read/failed + Meta pricing category for cost analytics).
 * Inbound messages are stored for the support-ticket bridge (spec 09); the sender's number stays in the
 * operational table only and is never logged. Returns 404 while WhatsApp is switched off.
 */
const Status = z.object({
  id: z.string().min(1).max(256),
  status: z.enum(['sent', 'delivered', 'read', 'failed', 'deleted', 'warning']),
  timestamp: z.string().regex(/^\d{9,11}$/),
  pricing: z.object({ category: z.string().max(40).optional(), billable: z.boolean().optional() }).optional(),
  errors: z.array(z.object({ code: z.number().int() })).optional(),
});

const Inbound = z.object({
  id: z.string().min(1).max(256),
  from: z.string().regex(/^\d{8,15}$/),
  timestamp: z.string().regex(/^\d{9,11}$/),
  type: z.string().max(30),
  text: z.object({ body: z.string().max(4096) }).optional(),
});

const Payload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.object({
                statuses: z.array(Status).max(1000).optional(),
                messages: z.array(Inbound).max(1000).optional(),
              }),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});

const PRICING = new Set([
  'utility',
  'authentication',
  'authentication_international',
  'marketing',
  'marketing_lite',
  'service',
  'referral_conversion',
]);

export function validSignature(raw: Uint8Array, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function whatsAppWebhookRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const cfg = deps.config.whatsapp;

  app.get('/webhooks/whatsapp', (c) => {
    if (!cfg) return c.notFound();
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token') ?? '';
    const challenge = c.req.query('hub.challenge') ?? '';
    const a = Buffer.from(token);
    const b = Buffer.from(cfg.verifyToken);
    if (
      mode === 'subscribe' &&
      a.length === b.length &&
      timingSafeEqual(a, b) &&
      /^\d{1,20}$/.test(challenge)
    ) {
      return c.text(challenge, 200);
    }
    return c.text('forbidden', 403);
  });

  app.post('/webhooks/whatsapp', async (c) => {
    if (!cfg) return c.notFound();
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (!validSignature(raw, c.req.header('x-hub-signature-256'), cfg.appSecret)) {
      log('warn', 'whatsapp_webhook_bad_signature', { requestId: c.get('requestId') });
      return c.text('unauthorized', 401);
    }
    let parsed: z.infer<typeof Payload>;
    try {
      parsed = Payload.parse(JSON.parse(new TextDecoder().decode(raw)));
    } catch {
      // Signed by Meta but a shape we do not handle (e.g. a new field): acknowledge so Meta does not retry.
      log('warn', 'whatsapp_webhook_unparsed', { requestId: c.get('requestId') });
      return c.text('ok', 200);
    }
    for (const entry of parsed.entry) {
      for (const change of entry.changes) {
        for (const s of change.value.statuses ?? []) {
          if (s.status === 'deleted' || s.status === 'warning') continue;
          const category = s.pricing?.category;
          await recordDeliveryReceipt(deps.db, {
            eventId: `wa:${s.id}:${s.status}`,
            provider: 'whatsapp',
            payload: {
              status: s.status,
              timestamp: s.timestamp,
              category: category ?? null,
              billable: s.pricing?.billable ?? null,
              errorCode: s.errors?.[0]?.code ?? null,
            },
            receipt: {
              channel: 'whatsapp',
              providerId: s.id,
              status: s.status,
              at: new Date(Number(s.timestamp) * 1000),
              pricingCategory: category && PRICING.has(category) ? category : null,
              billable: s.pricing?.billable ?? null,
              errorCode: s.errors?.[0]?.code ?? null,
            },
          });
        }
        for (const m of change.value.messages ?? []) {
          await recordWebhookEvent(deps.db, {
            id: `wa:${m.id}`,
            provider: 'whatsapp',
            type: 'message',
            status: 'received',
            payload: { from: m.from, type: m.type, timestamp: m.timestamp, text: m.text?.body ?? null },
          });
        }
      }
    }
    return c.text('ok', 200);
  });

  return app;
}
