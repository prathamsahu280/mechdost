import { eq } from 'drizzle-orm';
import { rupees } from '@mechdost/shared/email-phrases';
import type { EmailTemplateKey } from '@mechdost/shared/email-templates';
import type { WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';
import { userRoles, users, workshops } from '../schema';
import { queueEmail } from './email-notifications';
import { notificationChannelEnabled } from './notification-admin';
import { enqueueNotification, type Locale } from './notify';
import type { Tx } from './orders';

/**
 * Roadside email and WhatsApp (spec 10, spec 22). Both go through the outbox in the transaction of the change they
 * announce, so a rolled-back change sends nothing and a retried one sends once (dedupe key per template, request and
 * version). Email: the catalogue templates `rsa_*` (sender by purpose, en and hi). WhatsApp: UTILITY templates that carry
 * only the request code (never the arrival code or an amount) and are queued only while staff switched the event on and
 * Meta approved that language (`notificationChannelEnabled`), so nothing is sent before approval.
 */
export type RsaEmailTemplate = Extract<
  EmailTemplateKey,
  | 'rsa_received'
  | 'rsa_accepted'
  | 'rsa_arrived'
  | 'rsa_bill_ready'
  | 'rsa_completed'
  | 'rsa_cancelled'
  | 'rsa_refund_processed'
>;
export type RsaCustomerWhatsApp = Extract<
  WhatsAppTemplateKey,
  'rsa.accepted' | 'rsa.arrived' | 'rsa.bill_ready' | 'rsa.refunded'
>;

export const paiseText = rupees;

/** The responder's name in the reader's language (the English name when there is no Hindi one). */
export async function responderName(tx: Tx, workshopId: string | null, locale: Locale): Promise<string> {
  if (!workshopId) return '';
  const [w] = await tx
    .select({ name: workshops.name, nameHi: workshops.nameHi })
    .from(workshops)
    .where(eq(workshops.id, workshopId))
    .limit(1);
  if (!w) return '';
  return locale === 'hi' && w.nameHi ? w.nameHi : w.name;
}

export async function queueRsaEmail(
  tx: Tx,
  input: {
    template: RsaEmailTemplate;
    requestId: string;
    userId: string;
    version: number | string;
    payload: (locale: Locale) => Promise<Record<string, string | number>> | Record<string, string | number>;
  },
): Promise<void> {
  // `queueEmail` takes the payload synchronously, so resolve both languages first.
  const [en, hi] = await Promise.all([input.payload('en'), input.payload('hi')]);
  await queueEmail(tx, {
    template: input.template,
    entityId: input.requestId,
    version: input.version,
    userId: input.userId,
    payload: (locale) => (locale === 'hi' ? hi : en),
  });
}

/** One WhatsApp message to the customer: only the request code goes in (the button opens the page). */
export async function queueRsaWhatsApp(
  tx: Tx,
  input: {
    event: RsaCustomerWhatsApp;
    requestId: string;
    userId: string;
    code: string;
    version: number | string;
  },
): Promise<boolean> {
  if (!(await notificationChannelEnabled(tx, input.event, 'whatsapp'))) return false;
  const [u] = await tx
    .select({ phone: users.phone, language: users.language, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (u?.status !== 'active' || !u.phone) return false;
  return enqueueNotification(tx, {
    dedupeKey: `${input.event}:${input.requestId}:v${String(input.version)}:whatsapp`,
    channel: 'whatsapp',
    recipientUserId: input.userId,
    recipient: u.phone,
    templateKey: input.event,
    locale: u.language === 'hi' ? 'hi' : 'en',
    payload: { rsaCode: input.code },
  });
}

/** A new roadside offer reaches the workshop's people by WhatsApp too (same gate: switched on and approved). */
export async function queueRsaOfferWhatsApp(
  tx: Tx,
  input: { requestId: string; offerId: string; workshopId: string; code: string; minutes: number },
): Promise<void> {
  if (!(await notificationChannelEnabled(tx, 'rsa.offer', 'whatsapp'))) return;
  const people = await tx
    .selectDistinct({ userId: users.id, phone: users.phone, language: users.language, status: users.status })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(eq(userRoles.workshopId, input.workshopId));
  for (const p of people) {
    if (p.status !== 'active' || !p.phone) continue;
    await enqueueNotification(tx, {
      dedupeKey: `rsa.offer:${input.offerId}:${p.userId}:whatsapp`,
      channel: 'whatsapp',
      recipientUserId: p.userId,
      recipient: p.phone,
      templateKey: 'rsa.offer',
      locale: p.language === 'hi' ? 'hi' : 'en',
      payload: { rsaCode: input.code, acceptMinutes: input.minutes },
    });
  }
}
