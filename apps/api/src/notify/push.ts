import { getMessaging } from 'firebase-admin/messaging';
import { livePushTokens, revokePushTokens, type OutboxRow, type Tx } from '@mechdost/db/repo';
import { firebaseAdminApp } from '../auth/firebase-app';
import { ChannelError, type ChannelAdapter } from './dispatcher';

/**
 * Web push through Firebase Cloud Messaging (spec 10, design 2026-11-15). The outbox row carries the finished title,
 * short body and link (no address, phone or amount on a lock screen); the person's live tokens are read at send
 * time, so a token that was removed after queueing is never used. Tokens FCM reports as gone are revoked here, and
 * nothing about a token (or the text) is logged: only codes (hard rule 16).
 */

export interface PushMessage {
  token: string;
  notification: { title: string; body: string };
  /** Absolute https link the notification opens. */
  link: string;
  data: { kind: string; link: string };
}

export interface PushResult {
  ok: boolean;
  messageId?: string;
  /** Firebase error code, e.g. `messaging/registration-token-not-registered`. */
  code?: string;
}

export interface PushTransport {
  /** One result per message, in order. Never throws for a per-token failure; throws only when the call itself fails. */
  sendEach(messages: readonly PushMessage[]): Promise<PushResult[]>;
}

/** Tokens FCM will never accept again: revoke them. */
const GONE = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);
/** Worth trying again later (a busy or briefly unavailable service). */
const TRANSIENT = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/unknown-error',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'messaging/topics-message-rate-exceeded',
]);

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function createPushAdapter(opts: {
  db: Tx;
  transport: PushTransport;
  webBaseUrl: string;
}): ChannelAdapter {
  const base = opts.webBaseUrl.replace(/\/$/, '');
  return {
    channel: 'push',
    async send(row: OutboxRow) {
      if (!row.recipientUserId) throw new ChannelError('permanent', 'no_recipient');
      const title = text(row.payload.title, 80);
      const body = text(row.payload.body, 240);
      const link = text(row.payload.link, 300);
      if (!title || !link.startsWith('/') || link.startsWith('//'))
        throw new ChannelError('permanent', 'bad_payload');
      const devices = await livePushTokens(opts.db, row.recipientUserId);
      if (devices.length === 0) throw new ChannelError('permanent', 'no_device');
      let results: PushResult[];
      try {
        results = await opts.transport.sendEach(
          devices.map((d) => ({
            token: d.token,
            notification: { title, body },
            link: `${base}${link}`,
            data: { kind: row.templateKey, link },
          })),
        );
      } catch {
        throw new ChannelError('retry', 'network');
      }
      const gone = devices.filter((_, i) => GONE.has(results[i]?.code ?? '')).map((d) => d.token);
      if (gone.length > 0) await revokePushTokens(opts.db, gone);
      const sent = results.find((r) => r.ok);
      if (sent) return { providerId: sent.messageId ?? null };
      const codes = results.map((r) => r.code ?? 'unknown');
      if (codes.some((c) => TRANSIENT.has(c)))
        throw new ChannelError('retry', codes.find((c) => TRANSIENT.has(c)) ?? 'transient');
      if (
        codes.some((c) => c === 'messaging/third-party-auth-error' || c === 'messaging/authentication-error')
      )
        throw new ChannelError('later', 'fcm_auth');
      throw new ChannelError(
        'permanent',
        gone.length === devices.length ? 'token_gone' : (codes[0] ?? 'unknown'),
      );
    },
  };
}

/** The real transport: firebase-admin's messaging on the process's Admin app (service account, spec 01/Q93). */
export function createFirebaseTransport(opts: { projectId: string; keyFile?: string | null }): PushTransport {
  const messaging = getMessaging(
    firebaseAdminApp({ projectId: opts.projectId, keyFile: opts.keyFile ?? null }),
  );
  return {
    async sendEach(messages) {
      const res = await messaging.sendEach(
        messages.map((m) => ({
          token: m.token,
          notification: m.notification,
          data: m.data,
          webpush: {
            fcmOptions: { link: m.link },
            headers: { TTL: '86400', Urgency: 'high' },
          },
        })),
      );
      return res.responses.map((r) => ({
        ok: r.success,
        ...(r.messageId ? { messageId: r.messageId } : {}),
        ...(r.error ? { code: r.error.code } : {}),
      }));
    },
  };
}
