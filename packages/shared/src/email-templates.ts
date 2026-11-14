/**
 * Email templates and senders (decision 2026-11-13 "Email sender addresses"; Resend). Each template declares its
 * purpose; the purpose picks the sender on the configured domain; the reply-to is always support@. Texts are code
 * defaults in English and Hindi, overridable later through `notification_templates` (rule 8).
 */
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

type Locale = 'en' | 'hi';

export interface EmailContent {
  subject: string;
  /** Plain-text body; the HTML body is built from these paragraphs and the action link. */
  paragraphs: string[];
  action: { label: string; url: string } | null;
}

interface TemplateDef {
  purpose: EmailPurpose;
  params: readonly string[];
  render(p: Record<string, string>, ctx: { locale: Locale; webBaseUrl: string }): EmailContent;
}

const localePath = (locale: Locale, path: string) => (locale === 'hi' ? `/hi${path}` : path);

export const EMAIL_TEMPLATES = {
  /** An admin invited a seller (design 2026-11-13): the one-time link to the prefilled application. */
  partner_invite: {
    purpose: 'updates',
    params: ['name', 'expiresOn', 'token'],
    render(p, { locale, webBaseUrl }) {
      const url = `${webBaseUrl}${localePath(locale, `/partners/invite/${p.token ?? ''}`)}`;
      return locale === 'hi'
        ? {
            subject: 'MechDost पर विक्रेता के रूप में जुड़ने का निमंत्रण',
            paragraphs: [
              `नमस्ते ${p.name ?? ''},`,
              'MechDost ने आपको विक्रेता के रूप में जुड़ने के लिए आमंत्रित किया है। नीचे दिए लिंक से अपना आवेदन पूरा करें: GST नंबर, पता, दुकान की जगह और आप जो प्रोडक्ट बेचते हैं।',
              `यह लिंक ${p.expiresOn ?? ''} तक मान्य है और केवल एक बार काम करता है।`,
            ],
            action: { label: 'आवेदन पूरा करें', url },
          }
        : {
            subject: 'Your invitation to sell on MechDost',
            paragraphs: [
              `Hello ${p.name ?? ''},`,
              'MechDost has invited you to join as a seller. Use the link below to finish your application: your GST number, address, shop location and the products you sell.',
              `The link works once and is valid until ${p.expiresOn ?? ''}.`,
            ],
            action: { label: 'Finish your application', url },
          };
    },
  },
  /** MechDost sent (or revised) a bulk price offer (spec 19); the customer accepts it on the quote page. */
  quote_offer: {
    purpose: 'updates',
    params: ['quoteCode', 'validUntil'],
    render(p, { locale, webBaseUrl }) {
      const url = `${webBaseUrl}${localePath(locale, `/quotes/${p.quoteCode ?? ''}`)}`;
      return locale === 'hi'
        ? {
            subject: `आपकी थोक कीमत तैयार है (${p.quoteCode ?? ''})`,
            paragraphs: [
              'नमस्ते,',
              'MechDost ने आपके थोक अनुरोध के लिए कीमत भेजी है। ऑफ़र देखें और ठीक लगे तो उसी पेज पर स्वीकार करें।',
              `यह ऑफ़र ${p.validUntil ?? ''} तक मान्य है।`,
            ],
            action: { label: 'ऑफ़र देखें', url },
          }
        : {
            subject: `Your bulk price is ready (${p.quoteCode ?? ''})`,
            paragraphs: [
              'Hello,',
              'MechDost has sent a price for your bulk request. Review the offer and accept it on the same page if it works for you.',
              `The offer is valid until ${p.validUntil ?? ''}.`,
            ],
            action: { label: 'View the offer', url },
          };
    },
  },
} as const satisfies Record<string, TemplateDef>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return Object.hasOwn(EMAIL_TEMPLATES, key);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text and a simple branded HTML body (no images, no tracking pixels). */
export function renderEmail(content: EmailContent): { text: string; html: string } {
  const text = [
    ...content.paragraphs,
    ...(content.action ? [`${content.action.label}: ${content.action.url}`] : []),
  ].join('\n\n');
  const paras = content.paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = content.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(content.action.url)}" style="background:#ea5728;color:#fff;padding:12px 20px;border-radius:9px;text-decoration:none;font-weight:700">${escapeHtml(content.action.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:Arial,sans-serif;color:#101f34"><div style="max-width:560px;margin:0 auto;padding:24px"><p style="font-weight:800;font-size:18px;margin:0 0 24px">MechDost</p>${paras}${button}</div></body></html>`;
  return { text, html };
}
