/**
 * WhatsApp via the Meta Cloud API directly (decision 2026-11-02, user: "i want the cheapest option";
 * docs/research/whatsapp.md). This file is the single catalogue of WhatsApp templates and the rules that keep
 * them cheap and compliant:
 * - Transactional messages are **utility** templates (≈ ₹0.115) tied to the customer's own order/booking/ticket.
 *   A promo inside a utility template makes Meta reclassify it as marketing (≈ ₹0.863) and can cost the whole
 *   account its utility status, so `utilityTemplateProblem` refuses offer wording.
 * - WhatsApp is used only where the person must know or act; everything else is in-app/email (free).
 * - Params are positional (`{{1}}`, `{{2}}` …) in the order listed; every template exists in `en` and `hi`.
 * Template names must match what is registered in WhatsApp Manager (lowercase, digits, underscores).
 */
export type WhatsAppCategory = 'utility' | 'authentication' | 'marketing';
export type WhatsAppLocale = 'en' | 'hi';

export interface WhatsAppTemplate {
  /** Name registered with Meta. */
  name: string;
  category: WhatsAppCategory;
  /** Payload keys, in `{{n}}` order. Values must be short codes or numbers, never free text from users. */
  params: readonly string[];
  /** Optional dynamic URL button suffix key (e.g. the order code appended to https://mechdost.com/orders/). */
  urlParam?: string;
  /** Who it goes to (for the admin matrix and the partner consent clause). */
  audience: 'customer' | 'partner';
}

export const WHATSAPP_TEMPLATES = {
  'order.confirmed': {
    name: 'order_confirmed',
    category: 'utility',
    params: ['orderCode'],
    urlParam: 'orderCode',
    audience: 'customer',
  },
  // No delivery code here (user 2026-11-14): Meta refuses passcode-like codes in utility templates, and a code in a
  // notification shows on a locked screen. The button opens the order page, which shows the code to the customer.
  'order.out_for_delivery': {
    name: 'order_out_for_delivery',
    category: 'utility',
    params: ['orderCode'],
    urlParam: 'orderCode',
    audience: 'customer',
  },
  'order.rejected': {
    name: 'order_rejected_refund',
    category: 'utility',
    params: ['orderCode'],
    urlParam: 'orderCode',
    audience: 'customer',
  },
  'service.estimate_sent': {
    name: 'service_estimate_ready',
    category: 'utility',
    params: ['requestCode'],
    urlParam: 'requestCode',
    audience: 'customer',
  },
  'ticket.replied': {
    name: 'ticket_reply',
    category: 'utility',
    params: ['ticketCode'],
    urlParam: 'ticketCode',
    audience: 'customer',
  },
  // Bulk quotes (spec 19, 2026-11-16). Wired through the outbox; sending stays off until staff switch an event on.
  // Default bodies: locale files `notify-templates/*.json` quote.* (no offer/discount wording; no variable at either end).
  'quote.offer_sent': {
    name: 'quote_price_ready',
    category: 'utility',
    params: ['quoteCode'],
    urlParam: 'quoteCode',
    audience: 'customer',
  },
  'quote.message': {
    name: 'quote_reply',
    category: 'utility',
    params: ['quoteCode'],
    urlParam: 'quoteCode',
    audience: 'customer',
  },
  'quote.expiring': {
    name: 'quote_price_ending',
    category: 'utility',
    params: ['quoteCode'],
    urlParam: 'quoteCode',
    audience: 'customer',
  },
  'quote.withdrawn': {
    name: 'quote_closed',
    category: 'utility',
    params: ['quoteCode'],
    urlParam: 'quoteCode',
    audience: 'customer',
  },
  // Roadside assistance (spec 22, 2026-11-24). No arrival code and no amount in any of them (lock-screen rule; Meta
  // refuses passcode-like codes in utility templates): the button opens the request page, which shows them.
  'rsa.accepted': {
    // Renamed from roadside_mechanic_assigned: Meta rejected the English one as INCORRECT_CATEGORY because its text
    // mentioned the arrival code (code-like content reads as authentication), 2026-11-24.
    name: 'roadside_mechanic_on_way',
    category: 'utility',
    params: ['rsaCode'],
    urlParam: 'rsaCode',
    audience: 'customer',
  },
  'rsa.arrived': {
    name: 'roadside_mechanic_arrived',
    category: 'utility',
    params: ['rsaCode'],
    urlParam: 'rsaCode',
    audience: 'customer',
  },
  'rsa.bill_ready': {
    name: 'roadside_bill_ready',
    category: 'utility',
    params: ['rsaCode'],
    urlParam: 'rsaCode',
    audience: 'customer',
  },
  'rsa.refunded': {
    name: 'roadside_refund_processed',
    category: 'utility',
    params: ['rsaCode'],
    urlParam: 'rsaCode',
    audience: 'customer',
  },
  'rsa.offer': {
    name: 'partner_new_roadside_job',
    category: 'utility',
    params: ['rsaCode', 'acceptMinutes'],
    audience: 'partner',
  },
  'order.routed': {
    name: 'partner_new_order',
    category: 'utility',
    params: ['orderCode', 'acceptMinutes'],
    audience: 'partner',
  },
} as const satisfies Record<string, WhatsAppTemplate>;

export type WhatsAppTemplateKey = keyof typeof WHATSAPP_TEMPLATES;

export function isWhatsAppTemplateKey(key: string): key is WhatsAppTemplateKey {
  return Object.hasOwn(WHATSAPP_TEMPLATES, key);
}

/** Offer wording that turns a utility template into marketing (Meta policy; checked in the admin editor too). */
// `\b` is ASCII-only in JS, so Hindi words and "% off" are matched without word boundaries.
const PROMO_EN =
  /\b(offer|offers|sale|discount|discounts|coupon|coupons|cashback|deal|deals|free gift|buy now|limited time)\b/i;
const PROMO_ANY = /\d+\s*%\s*off|flat\s*₹?\s*\d+\s*off|ऑफ़र|ऑफर|छूट|डिस्काउंट|कूपन|सेल/i;

/** Returns why a utility template body is not allowed, or null. */
export function utilityTemplateProblem(body: string): 'promo_wording' | 'too_long' | null {
  if (body.length > 1024) return 'too_long';
  if (PROMO_EN.test(body) || PROMO_ANY.test(body)) return 'promo_wording';
  return null;
}

/**
 * The body must use exactly the placeholders `{{1}}`…`{{n}}` for the template's n params (admin editor check;
 * Meta rejects templates whose variables do not match the sample values).
 */
export function placeholderProblem(body: string, paramCount: number): 'missing' | 'unknown' | null {
  const used = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  for (let i = 1; i <= paramCount; i += 1) if (!used.has(i)) return 'missing';
  for (const n of used) if (n < 1 || n > paramCount) return 'unknown';
  return null;
}

/**
 * Indicative Meta prices for India in **millipaise per delivered message** (1 paise = 1000 millipaise; integer
 * money rule). From docs/research/whatsapp.md (providers quoting Meta's card; verify against Meta's file).
 * Admin can override them in settings; Meta changes rates on 1 Jan/Apr/Jul/Oct.
 */
export const DEFAULT_WHATSAPP_RATES_MILLIPAISE: Readonly<Record<string, number>> = {
  utility: 11_500,
  authentication: 11_500,
  marketing: 86_310,
  service: 0,
};

/** Template params must be short codes/numbers: no newlines/tabs, ≤ 60 chars (Meta rejects 4+ spaces/newlines). */
export function whatsAppParamProblem(value: string): 'empty' | 'too_long' | 'bad_whitespace' | null {
  if (value.trim().length === 0) return 'empty';
  if (value.length > 60) return 'too_long';
  if (/[\n\t]| {4,}/.test(value)) return 'bad_whitespace';
  return null;
}

/** Cloud API wants the number without `+`. Accepts E.164 only (users.phone is E.164 by CHECK). */
export function toWhatsAppNumber(e164: string): string | null {
  return /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164.slice(1) : null;
}

/**
 * Meta error codes → what the dispatcher does (docs/research/whatsapp.md §2.4, §9).
 * - `retry`: transient (rate limit, Meta 5xx) — back off and retry.
 * - `later`: marketing frequency cap (131049) — retry no sooner than 24 h, not billed.
 * - `permanent`: will never succeed (not a WhatsApp user, bad number, template missing/paused, policy) — mark
 *   failed so the next channel (SMS/email) can be tried.
 */
export type WhatsAppFailure = 'retry' | 'later' | 'permanent';

const PERMANENT = new Set([
  131026, 131021, 131009, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 368,
]);
const RETRY = new Set([4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

export function classifyWhatsAppError(code: number | undefined, httpStatus: number): WhatsAppFailure {
  if (code === 131049) return 'later';
  if (code !== undefined && PERMANENT.has(code)) return 'permanent';
  if (code !== undefined && RETRY.has(code)) return 'retry';
  if (httpStatus === 429 || httpStatus >= 500) return 'retry';
  return 'permanent';
}
