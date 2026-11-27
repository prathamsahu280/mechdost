import { BILL_PDF_MAX_BYTES, isBillAttachmentTemplate } from '@mechdost/shared/bill-document';
import { defaultEmailTrustLine } from '@mechdost/shared/email-layout';
import {
  EMAIL_TEMPLATES,
  composeEmail,
  emailReplyTo,
  emailSender,
  isEmailTemplateKey,
  renderEmail,
  type EmailOverride,
} from '@mechdost/shared/email-templates';
import type { OutboxRow } from '@mechdost/db/repo';
import { log, safeError } from '../logger';
import { withDeadline } from './deadline';
import { ChannelError, type ChannelAdapter } from './dispatcher';
import type { EmailAttachment } from './pdf/attachment';

/**
 * Email through Resend (plan 2026-11-13 Task 3b), two REST calls' worth of code and no SDK (dependency policy).
 * The outbox dedupe is per row; Resend's `Idempotency-Key` makes a retried send after a lost answer harmless.
 * Text comes from the template's code defaults, replaced field by field by the admin's override when one exists
 * (`loadOverride`, read at send time so an edit applies to mail still waiting); the layout never changes.
 */
export interface EmailConfig {
  apiKey: string;
  /** Sender domain (verified in Resend: SPF, DKIM, DMARC; Q79). */
  domain: string;
  /** Website origin for links in emails. */
  webBaseUrl: string;
  /** Footer contact of the grievance officer; hidden until set (Q15b). */
  grievanceContact?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The admin's published `trust.emailFooter` for a language: the line to show, or `null` to hide it. */
export type TrustLineLoader = (locale: 'en' | 'hi') => Promise<string | null>;

export type OverrideLoader = (key: string, locale: 'en' | 'hi') => Promise<EmailOverride | null>;

/** Default time the bill PDF may take before the mail goes without it (see `attachmentBudgetMs`). */
export const ATTACHMENT_BUDGET_MS = 8_000;

export function createEmailAdapter(
  cfg: EmailConfig,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    loadOverride?: OverrideLoader;
    loadTrustLine?: TrustLineLoader;
    /** The grievance officer line from Admin -> Company details; null/empty or a failure uses `cfg.grievanceContact`. */
    loadGrievanceContact?: () => Promise<string | null>;
    /**
     * The bill / receipt PDF for the bill emails (Q194): asked only for the templates in `BILL_ATTACHMENT_TEMPLATES`.
     * Null, too big or a failure means the mail goes without it.
     */
    loadAttachment?: (row: OutboxRow, locale: 'en' | 'hi') => Promise<EmailAttachment | null>;
    /**
     * The most the bill PDF may take (lookups + render) before the mail goes without it. Live 2026-11-28: the lookups
     * waited on a busy worker pool and the attachment alone used up the 30 s send deadline, so `order_delivered` failed
     * every retry. Default 8 s keeps the whole send well inside `SEND_DEADLINE_MS`.
     */
    attachmentBudgetMs?: number;
  } = {},
): ChannelAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  /** The PDF for a bill email, or null: never an error, a missing PDF must not stop the mail (ids and class only in logs). */
  async function billAttachment(row: OutboxRow, locale: 'en' | 'hi'): Promise<EmailAttachment | null> {
    if (!opts.loadAttachment || !isBillAttachmentTemplate(row.templateKey)) return null;
    try {
      const load = opts.loadAttachment;
      const found = await withDeadline(opts.attachmentBudgetMs ?? ATTACHMENT_BUDGET_MS, 'attachment', () =>
        load(row, locale),
      );
      if (!found) return null;
      if (found.content.length > BILL_PDF_MAX_BYTES) {
        log('warn', 'email_attachment_skipped', {
          outboxId: row.id,
          reason: 'too_big',
          bytes: found.content.length,
        });
        return null;
      }
      return found;
    } catch (err) {
      log('warn', 'email_attachment_skipped', {
        outboxId: row.id,
        reason: 'build_failed',
        ...safeError(err),
      });
      return null;
    }
  }
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
      const locale = row.locale === 'hi' ? 'hi' : 'en';
      // The code default is always a safe text; a database hiccup must not stop the mail.
      const override: EmailOverride | null = await (
        opts.loadOverride?.(row.templateKey, locale) ?? Promise.resolve(null)
      ).catch(() => null);
      // The admin's company details win; the env value is the fallback (and a database hiccup must not stop the mail).
      const grievanceContact =
        (await (opts.loadGrievanceContact?.() ?? Promise.resolve(null)).catch(() => null)) ??
        cfg.grievanceContact ??
        null;
      const composed = composeEmail(
        row.templateKey,
        locale,
        params,
        { webBaseUrl: cfg.webBaseUrl, grievanceContact },
        override,
      );
      // Order emails carry the "genuine parts" line (design 2026-11-15); the admin can reword or hide it. Like the
      // template override, a database hiccup falls back to the safe default text.
      let trustLine: string | null = null;
      if (row.templateKey.startsWith('order_')) {
        trustLine = await (
          opts.loadTrustLine?.(locale) ?? Promise.resolve(defaultEmailTrustLine(locale))
        ).catch(() => defaultEmailTrustLine(locale));
      }
      const { text, html } = renderEmail(composed, {
        locale,
        grievanceContact,
        trustLine,
        webBaseUrl: cfg.webBaseUrl,
      });
      // A staff test send (Admin → Emails) is marked so nobody mistakes it for a real notification.
      const subject =
        row.payload.test === 'true'
          ? `${locale === 'hi' ? '[टेस्ट]' : '[Test]'} ${composed.subject}`
          : composed.subject;
      const attachment = await billAttachment(row, locale);
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
            subject,
            text,
            html,
            ...(attachment
              ? {
                  attachments: [
                    { filename: attachment.filename, content: attachment.content.toString('base64') },
                  ],
                }
              : {}),
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
