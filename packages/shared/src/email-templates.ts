/**
 * Email templates and senders (decision 2026-11-13 "Email sender addresses"; design 2026-11-15; Resend).
 *
 * Each template is a typed definition in code: purpose (picks the sender), category (transactional or
 * promotional), a closed list of placeholders, and default copy in English and Hindi. Admin can override subject,
 * heading, body and button label per language (`notification_templates`, hard rule 8); the layout never changes.
 * Placeholders are `{name}` tokens from the template's own list, filled with escaped values; anything else is
 * refused on save (`emailOverrideProblem`). Hindi is written for Hindi readers, not translated word for word.
 */
import { EMAIL_CATALOGUE, type EmailCopy, type EmailTemplateDef } from './email-catalogue';
import { renderEmailLayout, type EmailBody } from './email-layout';

export const EMAIL_PURPOSES = ['updates', 'billing', 'support', 'promotions', 'system'] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

const SENDER: Record<EmailPurpose, { name: string; local: string }> = {
  updates: { name: 'MechDost', local: 'updates' },
  billing: { name: 'MechDost Billing', local: 'billing' },
  support: { name: 'MechDost Support', local: 'support' },
  promotions: { name: 'MechDost', local: 'promotions' },
  system: { name: 'MechDost', local: 'noreply' },
};

export function emailSender(purpose: EmailPurpose, domain: string): string {
  const s = SENDER[purpose];
  return `${s.name} <${s.local}@${domain}>`;
}

export function emailReplyTo(domain: string): string {
  return `support@${domain}`;
}

export type EmailLocale = 'en' | 'hi';
export type { EmailCopy, EmailTemplateDef };

export const EMAIL_TEMPLATES = EMAIL_CATALOGUE;
export type EmailTemplateKey = keyof typeof EMAIL_CATALOGUE;

export const emailTemplateKeys = (): EmailTemplateKey[] => Object.keys(EMAIL_CATALOGUE) as EmailTemplateKey[];

export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return Object.hasOwn(EMAIL_CATALOGUE, key);
}

/** Admin text overrides for one template and language; null or empty = use the default for that field. */
export interface EmailOverride {
  subject?: string | null;
  heading?: string | null;
  body?: string | null;
  buttonLabel?: string | null;
}

export const EMAIL_LIMITS = { subject: 150, heading: 120, body: 3000, button: 40 } as const;

export type EmailOverrideProblem =
  'EMAIL_UNKNOWN_TEMPLATE' | 'EMAIL_PLACEHOLDER' | 'EMAIL_HTML' | 'EMAIL_SUBJECT_LINES' | 'EMAIL_TOO_LONG';

const PLACEHOLDER = /\{(\w+)\}/g;

/** The first problem with an override, or null. Unknown placeholders, HTML and over-long text are refused. */
export function emailOverrideProblem(key: string, o: EmailOverride): EmailOverrideProblem | null {
  if (!isEmailTemplateKey(key)) return 'EMAIL_UNKNOWN_TEMPLATE';
  const allowed = new Set<string>(EMAIL_CATALOGUE[key].text);
  const fields: [string | null | undefined, number][] = [
    [o.subject, EMAIL_LIMITS.subject],
    [o.heading, EMAIL_LIMITS.heading],
    [o.body, EMAIL_LIMITS.body],
    [o.buttonLabel, EMAIL_LIMITS.button],
  ];
  for (const [value, max] of fields) if (value && value.length > max) return 'EMAIL_TOO_LONG';
  if (o.subject && /[\r\n]/.test(o.subject)) return 'EMAIL_SUBJECT_LINES';
  for (const [value] of fields) {
    if (!value) continue;
    if (/[<>]/.test(value)) return 'EMAIL_HTML';
    for (const m of value.matchAll(PLACEHOLDER)) if (!allowed.has(m[1] ?? '')) return 'EMAIL_PLACEHOLDER';
  }
  return null;
}

/** Realistic sample values for the admin preview and the test send (never real customer data). */
export function sampleEmailParams(key: EmailTemplateKey): Record<string, string> {
  return { ...EMAIL_CATALOGUE[key].sample };
}

const fill = (text: string, params: Record<string, string>) =>
  text.replace(PLACEHOLDER, (whole, name: string) => params[name] ?? whole);

export interface ComposeContext {
  webBaseUrl: string;
  grievanceContact?: string | null;
}

export interface ComposedEmail extends EmailBody {
  purpose: EmailPurpose;
  category: 'transactional' | 'promotional';
}

const localePath = (locale: EmailLocale, path: string) => (locale === 'hi' ? `/hi${path}` : path);

/**
 * Subject, heading, paragraphs and button for one recipient: the override where set, else the default, with the
 * payload filled in. Values stay plain text here; the layout escapes them for HTML.
 */
export function composeEmail(
  key: EmailTemplateKey,
  locale: EmailLocale,
  params: Record<string, string>,
  ctx: ComposeContext,
  override?: EmailOverride | null,
): ComposedEmail {
  const def: EmailTemplateDef = EMAIL_CATALOGUE[key];
  const copy = def[locale];
  const use = (custom: string | null | undefined, fallback: string) =>
    custom && custom.trim() !== '' ? custom.trim() : fallback;
  const clean = (v: string) => v.replace(/[\r\n]+/g, ' ');
  const subject = clean(fill(use(override?.subject, copy.subject), params));
  const heading = clean(fill(use(override?.heading, copy.heading), params));
  const paragraphs = fill(use(override?.body, copy.body), params)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const path = def.button ? def.button(params) : null;
  const label = use(override?.buttonLabel, copy.button ?? '');
  const base = ctx.webBaseUrl.replace(/\/$/, '');
  return {
    purpose: def.purpose,
    category: def.category,
    subject,
    heading,
    paragraphs,
    action: path && label ? { label: fill(label, params), url: `${base}${localePath(locale, path)}` } : null,
  };
}

/** Plain text and branded HTML for a composed email (see `email-layout.ts`). */
export function renderEmail(
  content: EmailBody,
  options: {
    locale: EmailLocale;
    grievanceContact?: string | null;
    trustLine?: string | null;
    webBaseUrl?: string | null;
  },
): { text: string; html: string } {
  return renderEmailLayout(content, {
    locale: options.locale,
    grievanceContact: options.grievanceContact ?? null,
    trustLine: options.trustLine ?? null,
    webBaseUrl: options.webBaseUrl ?? null,
  });
}
