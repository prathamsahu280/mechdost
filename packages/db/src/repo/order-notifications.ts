import { eq } from 'drizzle-orm';
import { decryptField, encryptField, type Keyring } from '../crypto';
import { orderGroups, orders, users } from '../schema';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification } from './notify';
import type { Tx } from './orders';

/**
 * Customer WhatsApp updates for order milestones (spec 10; decision 2026-11-02). Called inside the transaction
 * that makes the change, so a rolled-back change never sends. Queues only when staff have switched WhatsApp on
 * for the event (an enabled template, admin → Notifications) and the customer has a phone. One message per
 * transition: the dedupe key carries the order version reached by it.
 *
 * Secrets in the payload (the delivery code) are stored encrypted like the shipment's own copy and decrypted by
 * the sender just before the Meta call (`openPayload`), so the outbox never holds them in clear text.
 */
export type OrderWhatsAppEvent = 'order.confirmed' | 'order.rejected' | 'order.out_for_delivery';

const SECRET_KEYS = ['deliveryCode', 'token'] as const;
const aadFor = (key: string) => `notification_outbox.payload.${key}`;

export async function queueOrderWhatsApp(
  tx: Tx,
  input: {
    orderId: string;
    event: OrderWhatsAppEvent;
    /** Order version after the transition (makes the dedupe key unique per transition). */
    orderVersion: number;
    /** Out for delivery only: the code, encrypted with `keyring` before it is stored. */
    secret?: { deliveryCode: string; keyring: Keyring };
  },
): Promise<boolean> {
  if (!(await notificationChannelEnabled(tx, input.event, 'whatsapp'))) return false;
  const [row] = await tx
    .select({ code: orderGroups.code, phone: users.phone, language: users.language, userId: users.id })
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!row?.phone) return false;
  const payload: Record<string, string> = { orderCode: row.code };
  if (input.event === 'order.out_for_delivery') {
    if (!input.secret) throw new Error('out_for_delivery needs the delivery code');
    payload.deliveryCodeEnc = encryptField(
      input.secret.deliveryCode,
      input.secret.keyring,
      aadFor('deliveryCode'),
    );
  }
  return enqueueNotification(tx, {
    dedupeKey: `${input.event}:${input.orderId}:v${String(input.orderVersion)}:whatsapp`,
    channel: 'whatsapp',
    recipientUserId: row.userId,
    recipient: row.phone,
    templateKey: input.event,
    locale: row.language === 'hi' ? 'hi' : 'en',
    payload,
  });
}

/** Encrypts one secret payload field as `<key>Enc` (opened by `openPayload` just before sending). */
export function sealPayloadField(
  value: string,
  keyring: Keyring,
  key: (typeof SECRET_KEYS)[number],
): Record<string, string> {
  return { [`${key}Enc`]: encryptField(value, keyring, aadFor(key)) };
}

/** Decrypts `<key>Enc` payload fields for the sender; anything else passes through unchanged. */
export function openPayload(
  payload: Record<string, unknown>,
  keyring: Keyring | null,
): Record<string, unknown> {
  const secretFields = new Set(SECRET_KEYS.map((key) => `${key}Enc`));
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(payload).filter(([field]) => !secretFields.has(field)),
  );
  for (const key of SECRET_KEYS) {
    const enc = payload[`${key}Enc`];
    if (typeof enc !== 'string') continue;
    if (!keyring) throw new Error(`payload field ${key} is encrypted but no keyring is configured`);
    out[key] = decryptField(enc, keyring, aadFor(key));
  }
  return out;
}
