/**
 * Network notices (spec 23 § 12; spec 10): one typed entry point over `queueNotice`, called inside the caller's
 * transaction (outbox pattern). Only `ustaad.*` and `staff.ustaad_*` kinds; placeholders are names, codes and counts.
 */
import { and, eq } from 'drizzle-orm';
import type { EmailTemplateKey } from '@mechdost/shared/email-templates';
import type { NoticeKind } from '@mechdost/shared/notice-catalogue';
import { notificationPreferences } from '../../schema';
import { queueEmail } from '../email-notifications';
import { queueNotice, type QueueNoticeInput } from '../notices';
import type { Tx } from '../orders';

export type UstaadNoticeKind = Extract<NoticeKind, `ustaad.${string}` | `staff.ustaad_${string}`>;

export async function notifyUstaad(
  tx: Tx,
  kind: UstaadNoticeKind,
  input: Omit<QueueNoticeInput, 'kind'>,
): Promise<boolean> {
  return queueNotice(tx, { ...input, kind });
}

/** Decisions about a member that spec 23 § 12 sends as bell + email (SIM-F1). */
export const USTAAD_DECISION_EMAIL = {
  'ustaad.content_removed': 'ustaad_content_removed',
  'ustaad.strike': 'ustaad_strike',
  'ustaad.banned': 'ustaad_banned',
  'ustaad.appeal_upheld': 'ustaad_appeal_upheld',
  'ustaad.appeal_overturned': 'ustaad_appeal_overturned',
} as const satisfies Partial<Record<UstaadNoticeKind, EmailTemplateKey>>;
export type UstaadDecisionKind = keyof typeof USTAAD_DECISION_EMAIL;

/**
 * The email for a decision, through the shared outbox writer (`queueEmail`: verified address, account language,
 * staff switch, dedupe). Not queued when the member switched transactional email off (`notification_preferences`
 * email/transactional = false); the bell row is written either way. No WhatsApp (decision: email + bell only).
 */
export async function emailUstaadDecision(
  tx: Tx,
  kind: UstaadDecisionKind,
  input: { userId: string; entityId: string; params: Record<string, string> },
): Promise<boolean> {
  const [pref] = await tx
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, input.userId),
        eq(notificationPreferences.channel, 'email'),
        eq(notificationPreferences.category, 'transactional'),
      ),
    )
    .limit(1);
  if (pref?.enabled === false) return false;
  return queueEmail(tx, {
    template: USTAAD_DECISION_EMAIL[kind],
    // One email per decision and member (several decisions can hang off one report).
    entityId: `${input.entityId}:${input.userId}`,
    version: kind,
    // Moderation mail only to a verified address (the same bar as partner mail).
    audience: 'partner',
    userId: input.userId,
    payload: input.params,
  });
}
