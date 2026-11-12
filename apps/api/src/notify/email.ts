import {
  EMAIL_TEMPLATES,
  emailReplyTo,
  emailSender,
  isEmailTemplateKey,
  renderEmail,
} from '@mechdost/shared/email-templates';
import type { OutboxRow } from '@mechdost/db/repo';
import { ChannelError, type ChannelAdapter } from './dispatcher';

/**
 * Email through Resend (plan 2026-11-13 Task 3b), two REST calls' worth of code and no SDK (dependency policy).
 * The outbox dedupe is per row; Resend's `Idempotency-Key` makes a retried send after a lost answer harmless.
 */
export interface EmailConfig {
  apiKey: string;
  /** Sender domain (verified in Resend: SPF, DKIM, DMARC; Q79). */
  domain: string;
  /** Website origin for links in emails. */
  webBaseUrl: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createEmailAdapter(
  cfg: EmailConfig,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): ChannelAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    channel: 'email',
    async send(row: OutboxRow) {
      if (!isEmailTemplateKey(row.templateKey)) throw new ChannelError('permanent', 'unknown_template');
      if (!row.recipient || !EMAIL.test(row.recipient)) throw new ChannelError('permanent', 'bad_recipient');
      const template = EMAIL_TEMPLATES[row.templateKey];
      const params: Record<string, string> = {};
      for (const key of template.params) {
        const raw = row.payload[key];
        params[key] = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
      }
      const content = template.render(params, {
        locale: row.locale === 'hi' ? 'hi' : 'en',
        webBaseUrl: cfg.webBaseUrl.replace(/\/$/, ''),
      });
      const { text, html } = renderEmail(content);
      let res: Response;
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${cfg.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': `outbox-${row.id}`,
          },
          body: JSON.stringify({
            from: emailSender(template.purpose, cfg.domain),
            to: [row.recipient],
            reply_to: emailReplyTo(cfg.domain),
            subject: content.subject,
            text,
            html,
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
      } catch {
        throw new ChannelError('retry', 'network');
      }
      if (res.status === 429 || res.status >= 500)
        throw new ChannelError('retry', `resend_${String(res.status)}`);
      if (res.status === 401 || res.status === 403)
        throw new ChannelError('later', `resend_${String(res.status)}`);
      if (!res.ok) throw new ChannelError('permanent', `resend_${String(res.status)}`);
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      return { providerId: typeof body.id === 'string' ? body.id : null };
    },
  };
}
