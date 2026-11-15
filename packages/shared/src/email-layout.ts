/**
 * The one fixed MechDost email layout (design 2026-11-15, "Edit text, keep layout"): table-based, inline styles,
 * no images, no scripts, no tracking pixels. Light by default; a `prefers-color-scheme: dark` block and the
 * `color-scheme` meta tags cover the clients that support them, and the colours stay readable where a client
 * inverts them on its own. Every value is escaped; the plain-text part carries the same content.
 */
export interface EmailBody {
  subject: string;
  heading: string;
  /** Plain-text paragraphs; a single line break inside one is kept. */
  paragraphs: string[];
  action: { label: string; url: string } | null;
}

export interface EmailLayoutOptions {
  locale: 'en' | 'hi';
  /** Shown in the footer only once set (the grievance officer contact is still to come, Q15b). */
  grievanceContact: string | null;
  /** The trust line ("genuine parts", design 2026-11-15) shown above the company line; order emails only. */
  trustLine?: string | null;
  /** Site origin; with it the header shows the logo image (white + orange PNG), else the plain wordmark. */
  webBaseUrl?: string | null;
}

const NAVY = '#101f34';
const ACCENT = '#ea5728';
/** Button fill: the design's accent-soft text colour, which keeps white label text above 4.5:1. */
const BUTTON = '#bf3c12';

const FOOTER = {
  en: {
    genuine: 'Genuine parts from verified Raipur shops.',
    company: 'Shourya Integrated Services Pvt Ltd, Raipur',
    support: 'Need help? Call or WhatsApp MechDost support on',
    why: 'You are getting this email because of activity on your MechDost account.',
    grievance: 'Grievance contact:',
  },
  hi: {
    genuine: 'रायपुर की सत्यापित दुकानों से असली पार्ट्स।',
    company: 'शौर्य इंटीग्रेटेड सर्विसेज़ प्राइवेट लिमिटेड, रायपुर',
    support: 'मदद चाहिए? MechDost सहायता को कॉल या WhatsApp करें:',
    why: 'आपको यह ईमेल आपके MechDost खाते की गतिविधि के कारण मिल रहा है।',
    grievance: 'शिकायत संपर्क:',
  },
} as const;

/**
 * Default order-email trust line (Admin -> Content `trust.emailFooter` overrides it). Same text as the locale files'
 * `trust.emailFooter` for Raipur; a test keeps the two equal.
 */
export const defaultEmailTrustLine = (locale: 'en' | 'hi'): string => FOOTER[locale].genuine;

export const EMAIL_SUPPORT_PHONE = '7978776551';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const paragraphHtml = (p: string) => escapeHtml(p).replace(/\r?\n/g, '<br>');

export function renderEmailLayout(
  content: EmailBody,
  options: EmailLayoutOptions,
): { html: string; text: string } {
  const f = FOOTER[options.locale];
  const grievance = options.grievanceContact?.trim() ? options.grievanceContact.trim() : null;
  const trustLine = options.trustLine?.trim() ? options.trustLine.trim() : null;
  const footerLines = [
    ...(trustLine ? [trustLine] : []),
    f.company,
    `${f.support} ${EMAIL_SUPPORT_PHONE}`,
    ...(grievance ? [`${f.grievance} ${grievance}`] : []),
    f.why,
  ];
  const text = [
    content.heading,
    ...content.paragraphs,
    ...(content.action ? [`${content.action.label}: ${content.action.url}`] : []),
    `--\n${footerLines.join('\n')}`,
  ].join('\n\n');

  const font = "font-family:'DM Sans',Arial,Helvetica,sans-serif";
  const paras = content.paragraphs
    .map(
      (p) =>
        `<p class="ink" style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${NAVY}">${paragraphHtml(p)}</p>`,
    )
    .join('');
  const button = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px"><tr><td style="border-radius:9px;background:${BUTTON}"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 22px;border-radius:9px;background:${BUTTON};color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;${font}">${escapeHtml(content.action.label)}</a></td></tr></table>`
    : '';
  const footer = footerLines
    .map(
      (l) =>
        `<p class="muted" style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#5d6b7e">${escapeHtml(l)}</p>`,
    )
    .join('');
  const base = options.webBaseUrl?.replace(/\/$/, '') ?? '';
  const brand = base
    ? `<img src="${escapeHtml(base)}/brand/icons/email-logo.png" width="160" height="29" alt="MechDost" style="display:block;border:0;outline:none;height:29px;width:160px">`
    : `<span style="font-size:20px;font-weight:800;color:#ffffff;${font}">MechDost</span>`;
  const html = `<!doctype html>
<html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(content.subject)}</title><style>:root{color-scheme:light dark;supported-color-schemes:light dark}@media (prefers-color-scheme: dark){.bg{background:#0a1424!important}.card{background:#101d31!important}.ink{color:#e8eef5!important}.muted{color:#a3b3c7!important}}</style></head>
<body class="bg" style="margin:0;padding:0;background:#f7f8fa;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#f7f8fa"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td style="background:${NAVY};border-bottom:4px solid ${ACCENT};padding:18px 24px;border-radius:12px 12px 0 0">${brand}</td></tr>
<tr><td class="card" style="background:#ffffff;padding:28px 24px 20px;border-radius:0 0 12px 12px"><h1 class="ink" style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${NAVY}">${escapeHtml(content.heading)}</h1>${paras}${button}</td></tr>
<tr><td style="padding:16px 8px 0">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  return { html, text };
}
