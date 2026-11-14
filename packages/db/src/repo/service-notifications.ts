import { eq } from 'drizzle-orm';
import { serviceRequests, users } from '../schema';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification } from './notify';
import type { Tx } from './orders';

/**
 * Customer WhatsApp updates for service requests (spec 06 "Notifications", spec 10). Called inside the transaction
 * that makes the change (a rolled-back change never sends); queued only when staff switched the event on and the
 * customer has a phone. One message per transition: the dedupe key carries the request version reached by it.
 */
export type ServiceWhatsAppEvent = 'service.estimate_sent';

export async function queueServiceWhatsApp(
  tx: Tx,
  input: { requestId: string; event: ServiceWhatsAppEvent; requestVersion: number },
): Promise<boolean> {
  if (!(await notificationChannelEnabled(tx, input.event, 'whatsapp'))) return false;
  const [row] = await tx
    .select({ code: serviceRequests.code, phone: users.phone, language: users.language, userId: users.id })
    .from(serviceRequests)
    .innerJoin(users, eq(users.id, serviceRequests.userId))
    .where(eq(serviceRequests.id, input.requestId))
    .limit(1);
  if (!row?.phone) return false;
  return enqueueNotification(tx, {
    dedupeKey: `${input.event}:${input.requestId}:v${String(input.requestVersion)}:whatsapp`,
    channel: 'whatsapp',
    recipientUserId: row.userId,
    recipient: row.phone,
    templateKey: input.event,
    locale: row.language === 'hi' ? 'hi' : 'en',
    payload: { requestCode: row.code },
  });
}
