import { and, eq } from 'drizzle-orm';
import { isEmailTemplateKey, type EmailTemplateKey } from '@mechdost/shared/email-templates';
import { notificationTemplates, users } from '../schema';
import { enqueueNotification, type Locale } from './notify';
import { globalFlagSetting } from './settings-admin';
import type { Tx } from './orders';

/**
 * The one writer of transactional email outbox rows (spec 10, design 2026-11-15). Every email milestone calls
 * `queueEmail` inside the transaction that makes the state change, so a rolled-back change never sends and a
 * retried transaction never sends twice (dedupe key `{template}:{entity}:v{version}:email`, UNIQUE).
 *
 * Who gets it:
 * - an account (`userId`): the address on the account, in the account's language; customers only when the address
 *   is verified if `customers.require_verified_email` is on; partners (staff, shop people) only when verified, as
 *   they must have both verified anyway (spec 01);
 * - a direct address (`to`): seller applicants, who have no account yet; the language is the caller's.
 * Switched off by staff (Admin → Notifications → Emails): nothing is queued. No row = on, with the code defaults.
 */
export interface QueueEmailInput {
  template: EmailTemplateKey;
  /** What the email is about (order, request, ticket, message…); several recipients: add the user id. */
  entityId: string;
  /** Version or sequence reached by the change, so each milestone mails once. */
  version: number | string;
  audience?: 'customer' | 'partner';
  userId?: string | null;
  to?: { email: string; locale: Locale } | null;
  /** Placeholder values; a function gets the recipient's language (phrases are localized by the caller). */
  payload: Record<string, string | number> | ((locale: Locale) => Record<string, string | number>);
  /** Used only when neither the account nor `to` has a language. */
  fallbackLocale?: Locale;
}

/** Whether staff have this email switched on for a language (no row = on). */
export async function emailTemplateEnabled(tx: Tx, key: string, locale: Locale): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: notificationTemplates.enabled })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.key, key),
        eq(notificationTemplates.channel, 'email'),
        eq(notificationTemplates.locale, locale),
      ),
    )
    .limit(1);
  return row?.enabled ?? true;
}

export async function queueEmail(tx: Tx, input: QueueEmailInput): Promise<boolean> {
  if (!isEmailTemplateKey(input.template)) return false;
  let email: string | null = null;
  let locale: Locale = input.fallbackLocale ?? 'en';
  let recipientUserId: string | null = null;
  if (input.userId) {
    const [u] = await tx
      .select({
        email: users.email,
        verified: users.emailVerifiedAt,
        language: users.language,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (u?.status !== 'active' || !u.email) return false;
    const mustBeVerified =
      input.audience === 'partner' || (await globalFlagSetting(tx, 'customers.require_verified_email'));
    if (mustBeVerified && !u.verified) return false;
    email = u.email;
    locale = u.language === 'hi' ? 'hi' : 'en';
    recipientUserId = input.userId;
  } else if (input.to) {
    email = input.to.email;
    locale = input.to.locale;
  }
  if (!email) return false;
  if (!(await emailTemplateEnabled(tx, input.template, locale))) return false;
  const payload = typeof input.payload === 'function' ? input.payload(locale) : input.payload;
  return enqueueNotification(tx, {
    dedupeKey: `${input.template}:${input.entityId}:v${String(input.version)}:email`,
    channel: 'email',
    recipientUserId,
    recipient: email,
    templateKey: input.template,
    locale,
    payload,
  });
}

/**
 * Refund emails (billing), for the refunds code to call inside its own transaction once a refund is requested,
 * processed or has failed. The refund id plus the refund's own status version make each step mail once.
 * `amount` is already formatted for the customer (`rupees(paise)` from `@mechdost/shared/email-phrases`).
 */
export async function queueRefundEmail(
  tx: Tx,
  input: {
    template: 'refund_requested' | 'refund_processed' | 'refund_failed' | 'refund_declined';
    refundId: string;
    refundVersion: number;
    userId: string;
    orderCode: string;
    amount: string;
  },
): Promise<boolean> {
  return queueEmail(tx, {
    template: input.template,
    entityId: input.refundId,
    version: input.refundVersion,
    userId: input.userId,
    payload: { orderCode: input.orderCode, amount: input.amount },
  });
}
