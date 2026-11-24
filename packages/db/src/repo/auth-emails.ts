import { randomUUID } from 'node:crypto';
import type { SentActionMode } from '@mechdost/shared/email-action-link';
import type { Keyring } from '../crypto';
import { recordServerEvent } from './events';
import { enqueueNotification, type Locale } from './notify';
import { sealPayloadField } from './order-notifications';
import type { Tx } from './orders';

/** The email template each action link kind uses (`packages/shared/src/email-catalogue.ts`). */
const TEMPLATE: Record<SentActionMode, 'auth_password_reset' | 'auth_verify_email'> = {
  resetPassword: 'auth_password_reset',
  verifyEmail: 'auth_verify_email',
};

/**
 * Queue a password-reset or email-verification email (decision 2026-11-24: Firebase will not send these from our
 * domain, so the API makes the link with the Admin SDK and sends the mail itself, through the outbox like every
 * other email). One row and one analytics event in one transaction.
 *
 * - The one-time code is a secret: stored encrypted in the payload (`sealPayloadField`) and opened by the sender just
 *   before the Resend call. Without a keyring (development and tests only; production refuses to start without one)
 *   it is stored as is.
 * - The dedupe key is a fresh id per send and holds no code and no address: two requests are two mails, and the
 *   per-address and per-user limits in the routes are what stop a flood.
 * - Not tied to the staff on/off switch of Admin → Emails: nobody could reset a password with it off. The text can
 *   still be reworded there.
 */
export async function queueAuthActionEmail(
  db: Tx,
  input: {
    mode: SentActionMode;
    email: string;
    locale: Locale;
    code: string;
    keyring: Keyring | null;
    /** The signed-in account (verification); null for a reset, which never looks the account up. */
    userId?: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await enqueueNotification(tx, {
      dedupeKey: `auth_action:${input.mode}:${randomUUID()}:email`,
      channel: 'email',
      recipientUserId: input.userId ?? null,
      recipient: input.email,
      templateKey: TEMPLATE[input.mode],
      locale: input.locale,
      payload: {
        mode: input.mode,
        lang: input.locale,
        ...(input.keyring ? sealPayloadField(input.code, input.keyring, 'token') : { token: input.code }),
      },
    });
    await recordServerEvent(tx, 'auth_email_action_requested', {
      userId: input.userId ?? null,
      props: { mode: input.mode, queued: true },
    });
  });
}

/** An action email was asked for but nothing was sent (unknown account, already verified): counted, nothing else. */
export async function recordAuthActionSkipped(
  db: Tx,
  input: { mode: SentActionMode; userId?: string | null },
): Promise<void> {
  await recordServerEvent(db, 'auth_email_action_requested', {
    userId: input.userId ?? null,
    props: { mode: input.mode, queued: false },
  });
}

/**
 * Queue the "your password was changed" notice (decision 2026-11-24). One mail per change: the dedupe key is the
 * Firebase uid plus the moment Firebase recorded the change, so a repeat call (a double click, a retry, an attacker
 * replaying the request) finds the row and sends nothing. No code, no secret: the payload is empty and the text is
 * fixed. Like the other `auth_` templates it ignores the Admin → Emails switch (a security notice).
 * Returns whether a new mail was queued; the outcome is counted as an analytics event in the same transaction.
 */
export async function queuePasswordChangedEmail(
  db: Tx,
  input: { uid: string; email: string; changedAt: Date; locale: Locale },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const queued = await enqueueNotification(tx, {
      dedupeKey: `auth_password_changed:${input.uid}:${String(input.changedAt.getTime())}:email`,
      channel: 'email',
      recipient: input.email,
      templateKey: 'auth_password_changed',
      locale: input.locale,
      payload: {},
    });
    await recordServerEvent(tx, 'auth_password_changed_notified', {
      props: { outcome: queued ? 'queued' : 'duplicate' },
    });
    return queued;
  });
}

/** A change was announced by the page but Firebase shows none in the window (or no such account): counted only. */
export async function recordPasswordChangeSkipped(db: Tx): Promise<void> {
  await recordServerEvent(db, 'auth_password_changed_notified', { props: { outcome: 'no_recent_change' } });
}
