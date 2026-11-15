import { eq } from 'drizzle-orm';
import { users } from '../schema';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification } from './notify';
import type { Tx } from './orders';

/**
 * Customer WhatsApp notices for bulk quotes (spec 19, spec 10). Called inside the transaction that makes the change
 * (a rolled-back change never sends); queued only when staff switched the event on and the customer has a phone, so
 * with the templates off nothing is queued at all. `dedupe` names the thing announced (offer version, message id,
 * offer id, quote id), so a retry or a second sweep never sends twice. The payload carries the quote code only.
 */
export type QuoteWhatsAppEvent = 'quote.offer_sent' | 'quote.message' | 'quote.expiring' | 'quote.withdrawn';

export async function queueQuoteWhatsApp(
  tx: Tx,
  input: { userId: string; quoteCode: string; event: QuoteWhatsAppEvent; dedupe: string },
): Promise<boolean> {
  if (!(await notificationChannelEnabled(tx, input.event, 'whatsapp'))) return false;
  const [row] = await tx
    .select({ phone: users.phone, language: users.language })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!row?.phone) return false;
  return enqueueNotification(tx, {
    dedupeKey: `${input.event}:${input.dedupe}:whatsapp`,
    channel: 'whatsapp',
    recipientUserId: input.userId,
    recipient: row.phone,
    templateKey: input.event,
    locale: row.language === 'hi' ? 'hi' : 'en',
    payload: { quoteCode: input.quoteCode },
  });
}
