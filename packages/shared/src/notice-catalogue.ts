/**
 * The notice catalogue (spec 10, design 2026-11-15 bell and push): every in-app and push message MechDost sends.
 * SERVER ONLY: it reads the locale files for the default texts, so the website must never import it (the website
 * gets finished texts from the API; its types and limits live in `notice-api.ts`).
 *
 * One definition per kind (a code such as `order.confirmed`): who it is for, its category, the closed list of
 * placeholders its text may use, and the page it opens. Default texts live in the locale files under `notify.*`
 * (hard rule 10); staff can override title and body per language through `notification_templates` rows with the
 * channel `inapp` (the bell) or `push` (the push message; none = the in-app text). Text is rendered when the
 * notice is written, in the recipient's language.
 *
 * What may appear in the text: codes and names the person already sees on the page the notice opens. Never an
 * address, phone, amount or the delivery code (lock-screen rule of the design). Placeholders are therefore a
 * closed list per kind.
 */
import type { EmailTemplateKey } from './email-templates';
import en from './i18n/en.json';
import hi from './i18n/hi.json';
import type { NoticeCategory, NoticeEntityType } from './notice-api';

/** `member` = an Ustaad Network member (spec 23 § 12). */
export type NoticeAudience = 'customer' | 'partner' | 'staff' | 'member';

export interface NoticeDef {
  category: NoticeCategory;
  entity: NoticeEntityType;
  audience: NoticeAudience;
  /** Placeholders the text may use. */
  text: readonly string[];
  /** Path (no `/hi` prefix) the notice opens. */
  link: (p: Record<string, string>) => string;
}

const enc = encodeURIComponent;
const order = (p: Record<string, string>) => `/orders/${enc(p.orderCode ?? '')}`;
const service = (p: Record<string, string>) => `/service/${enc(p.requestCode ?? '')}`;
const roadside = (p: Record<string, string>) => `/roadside/${enc(p.requestCode ?? '')}`;
const quote = (p: Record<string, string>) => `/quotes/${enc(p.quoteCode ?? '')}`;
const ticket = (p: Record<string, string>) => `/account/support?ticket=${enc(p.ticketCode ?? '')}`;
const at = (path: string) => () => path;
const ustaadQuestion = (p: Record<string, string>) => `/ustaad/q/${enc(p.questionCode ?? '')}`;
const ustaadJob = (p: Record<string, string>) => `/ustaad/jobs/${enc(p.jobCode ?? '')}`;

const T = 'transactional' as const;
const def = (d: NoticeDef): NoticeDef => d;

export const NOTICE_CATALOGUE = {
  // ----- Customer: orders and money -------------------------------------------------------------------------
  'order.placed': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.confirmed': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.out_for_delivery': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.delivered': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.cancelled': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.rejected': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'payment.received': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'refund.requested': def({
    category: T,
    entity: 'refund',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'refund.processed': def({
    category: T,
    entity: 'refund',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'refund.failed': def({
    category: T,
    entity: 'refund',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'refund.declined': def({
    category: T,
    entity: 'refund',
    audience: 'customer',
    text: ['orderCode'],
    link: at('/support'),
  }),
  // ----- Customer: services, quotes, support ------------------------------------------------------------------
  'service.received': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode'],
    link: service,
  }),
  // ----- Customer: roadside assistance (spec 22) -------------------------------------------------------------
  'rsa.accepted': def({
    category: T,
    entity: 'rsa_request',
    audience: 'customer',
    text: ['requestCode', 'workshopName'],
    link: roadside,
  }),
  'rsa.arrived': def({
    category: T,
    entity: 'rsa_request',
    audience: 'customer',
    text: ['requestCode', 'workshopName'],
    link: roadside,
  }),
  'rsa.bill_ready': def({
    category: T,
    entity: 'rsa_request',
    audience: 'customer',
    text: ['requestCode'],
    link: roadside,
  }),
  'rsa.refunded': def({
    category: T,
    entity: 'rsa_request',
    audience: 'customer',
    text: ['requestCode'],
    link: roadside,
  }),
  'rsa.offer': def({
    category: T,
    entity: 'rsa_request',
    audience: 'partner',
    text: ['requestCode', 'minutes'],
    link: at('/partner/workshop'),
  }),
  'staff.rsa_cash': def({
    category: T,
    entity: 'rsa_request',
    audience: 'staff',
    text: ['requestCode'],
    link: at('/admin/roadside'),
  }),
  'service.proposed': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode', 'workshopName'],
    link: service,
  }),
  'service.confirmed': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode', 'workshopName'],
    link: service,
  }),
  'service.estimate_ready': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode'],
    link: service,
  }),
  'service.ready': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode', 'workshopName'],
    link: service,
  }),
  'service.bill_ready': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode'],
    link: service,
  }),
  'service.completed': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode'],
    link: service,
  }),
  'service.cancelled': def({
    category: T,
    entity: 'service_request',
    audience: 'customer',
    text: ['requestCode'],
    link: service,
  }),
  'quote.offer': def({
    category: T,
    entity: 'quote',
    audience: 'customer',
    text: ['quoteCode'],
    link: quote,
  }),
  // "Notify me" for a PIN that was not served (spec 15, design 2026-11-15 item 7): the customer asked for it.
  'account.pin_served': def({
    category: T,
    entity: 'account',
    audience: 'customer',
    text: ['pincode'],
    link: at('/shop'),
  }),
  // Cash on delivery decided by staff (founder ruling 2026-11-26): the account's Payments page explains it.
  'account.cod_approved': def({
    category: T,
    entity: 'account',
    audience: 'customer',
    text: [],
    link: at('/account/payments'),
  }),
  'account.cod_rejected': def({
    category: T,
    entity: 'account',
    audience: 'customer',
    text: [],
    link: at('/account/payments'),
  }),
  'account.cod_revoked': def({
    category: T,
    entity: 'account',
    audience: 'customer',
    text: [],
    link: at('/account/payments'),
  }),
  'quote.expiring': def({
    category: 'reminders',
    entity: 'quote',
    audience: 'customer',
    text: ['quoteCode'],
    link: quote,
  }),
  'ticket.received': def({
    category: T,
    entity: 'ticket',
    audience: 'customer',
    text: ['ticketCode'],
    link: ticket,
  }),
  'ticket.reply': def({
    category: T,
    entity: 'ticket',
    audience: 'customer',
    text: ['ticketCode'],
    link: ticket,
  }),
  'ticket.resolved': def({
    category: T,
    entity: 'ticket',
    audience: 'customer',
    text: ['ticketCode'],
    link: ticket,
  }),
  // ----- Shops and workshops ----------------------------------------------------------------------------------
  'shop.order_routed': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode', 'minutes'],
    link: at('/partner/shop'),
  }),
  'shop.offer_expiring': def({
    category: 'reminders',
    entity: 'order',
    audience: 'partner',
    text: ['orderCode', 'minutes'],
    link: at('/partner/shop'),
  }),
  'partner.warning': def({
    category: T,
    entity: 'shop',
    audience: 'partner',
    text: [],
    link: at('/partner/shop'),
  }),
  // ----- Staff (by permission and city, like live pings) ------------------------------------------------------
  'staff.order_needs_routing': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/orders'),
  }),
  'staff.shop_declined': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/orders'),
  }),
  'staff.shop_timed_out': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/orders'),
  }),
  'staff.shop_gave_up': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/orders'),
  }),
  'staff.refund_overdue': def({
    category: T,
    entity: 'refund',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/refunds'),
  }),
  'staff.refund_alert': def({
    category: T,
    entity: 'refund',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/refunds'),
  }),
  'staff.new_application': def({
    category: T,
    entity: 'application',
    audience: 'staff',
    text: [],
    link: at('/admin/applications'),
  }),
  'staff.new_ticket': def({
    category: T,
    entity: 'ticket',
    audience: 'staff',
    text: ['ticketCode'],
    link: at('/admin/support'),
  }),
  // ----- Ustaad Network (spec 23 § 12): names, codes and counts only; links stay inside /ustaad ----------
  'ustaad.question_waiting': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName', 'topic', 'questionCode'],
    link: ustaadQuestion,
  }),
  'ustaad.answer_received': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName', 'questionCode'],
    link: ustaadQuestion,
  }),
  'ustaad.best_answer': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['questionCode'],
    link: ustaadQuestion,
  }),
  'ustaad.reply': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: (p) => (p.postId ? `/ustaad/p/${enc(p.postId)}` : '/ustaad/notifications'),
  }),
  'ustaad.likes_digest': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['count'],
    link: at('/ustaad/me'),
  }),
  'ustaad.follow': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['count'],
    link: at('/ustaad/network'),
  }),
  'ustaad.connect_request': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/network'),
  }),
  'ustaad.connect_accepted': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/network'),
  }),
  'ustaad.message_request': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/messages'),
  }),
  'ustaad.message': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/messages'),
  }),
  'ustaad.vouch_requested': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/me/verify'),
  }),
  'ustaad.attestation_requested': def({
    category: T,
    entity: 'ustaad',
    audience: 'partner',
    text: ['memberName', 'workshopName'],
    link: at('/partner/workshop'),
  }),
  'ustaad.verification_decided': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: [],
    link: at('/ustaad/me/verify'),
  }),
  'ustaad.level_up': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: [],
    link: at('/ustaad/me'),
  }),
  'ustaad.badge_earned': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['badge'],
    link: at('/ustaad/me'),
  }),
  'ustaad.mentor_request': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/network'),
  }),
  'ustaad.mentor_accepted': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['memberName'],
    link: at('/ustaad/network'),
  }),
  'ustaad.job_application': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['jobCode'],
    link: at('/ustaad/jobs/mine'),
  }),
  'ustaad.application_status': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['jobCode'],
    link: ustaadJob,
  }),
  'ustaad.report_outcome': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: ['reportCode'],
    link: at('/ustaad/notifications'),
  }),
  'ustaad.content_removed': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: [],
    link: at('/ustaad/notifications'),
  }),
  'ustaad.strike': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: [],
    link: at('/ustaad/notifications'),
  }),
  'ustaad.rules_reminder': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: [],
    link: at('/policies/community-rules'),
  }),
  'ustaad.invite': def({
    category: T,
    entity: 'ustaad',
    audience: 'customer',
    text: [],
    link: at('/ustaad/join'),
  }),
  'ustaad.security_freeze': def({
    category: T,
    entity: 'ustaad',
    audience: 'member',
    text: [],
    link: at('/account'),
  }),
  'staff.ustaad_report': def({
    category: T,
    entity: 'ustaad',
    audience: 'staff',
    text: ['reportCode'],
    link: at('/admin/ustaad'),
  }),
  'staff.ustaad_report_overdue': def({
    category: T,
    entity: 'ustaad',
    audience: 'staff',
    text: ['reportCode'],
    link: at('/admin/ustaad'),
  }),
  /** Usage and free limits (2026-11-26): a metric reached a threshold; once per metric, level and month. */
  'staff.usage_alert': def({
    category: T,
    entity: 'platform',
    audience: 'staff',
    text: ['metric', 'percent'],
    link: at('/admin/usage'),
  }),
  'staff.ustaad_media_budget': def({
    category: T,
    entity: 'ustaad',
    audience: 'staff',
    text: ['count'],
    link: at('/admin/ustaad'),
  }),
  'staff.ustaad_verification': def({
    category: T,
    entity: 'ustaad',
    audience: 'staff',
    text: [],
    link: at('/admin/ustaad'),
  }),
  // ----- Delivery agents (spec 24) ----------------------------------------------------------------------------
  'delivery.offer': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode', 'minutes'],
    link: at('/partner/delivery'),
  }),
  'delivery.job_withdrawn': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode'],
    link: at('/partner/delivery'),
  }),
  'delivery.retry': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode'],
    link: at('/partner/delivery'),
  }),
  'delivery.return_to_shop': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode'],
    link: at('/partner/delivery'),
  }),
  'delivery.document_decided': def({
    category: T,
    entity: 'account',
    audience: 'partner',
    text: [],
    link: at('/partner/delivery'),
  }),
  'delivery.status_changed': def({
    category: T,
    entity: 'account',
    audience: 'partner',
    text: [],
    link: at('/partner/delivery'),
  }),
  'shop.delivery_agent_assigned': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode'],
    link: at('/partner/shop'),
  }),
  'shop.delivery_switch': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode'],
    link: at('/partner/shop'),
  }),
  'shop.delivery_returning': def({
    category: T,
    entity: 'order',
    audience: 'partner',
    text: ['orderCode'],
    link: at('/partner/shop'),
  }),
  'shop.delivery_mode_decided': def({
    category: T,
    entity: 'shop',
    audience: 'partner',
    text: [],
    link: at('/partner/shop'),
  }),
  'order.picked_up': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.delivery_failed': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'order.returned': def({
    category: T,
    entity: 'order',
    audience: 'customer',
    text: ['orderCode'],
    link: order,
  }),
  'staff.delivery_agent_application': def({
    category: T,
    entity: 'application',
    audience: 'staff',
    text: [],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_documents': def({
    category: T,
    entity: 'account',
    audience: 'staff',
    text: [],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_needs_agent': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_offer_expired': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_declined': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_failed': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_switch_declined': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/delivery'),
  }),
  'staff.shop_delivery_mode_request': def({
    category: T,
    entity: 'shop',
    audience: 'staff',
    text: [],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_agent_unavailable': def({
    category: T,
    entity: 'order',
    audience: 'staff',
    text: ['orderCode'],
    link: at('/admin/delivery'),
  }),
  'staff.delivery_low_rating': def({
    category: T,
    entity: 'account',
    audience: 'staff',
    text: [],
    link: at('/admin/delivery'),
  }),
} as const satisfies Record<string, NoticeDef>;

export type NoticeKind = keyof typeof NOTICE_CATALOGUE;

export const noticeKinds = (): NoticeKind[] => Object.keys(NOTICE_CATALOGUE) as NoticeKind[];

export function isNoticeKind(kind: string): kind is NoticeKind {
  return Object.hasOwn(NOTICE_CATALOGUE, kind);
}

/** The notice that goes with an email milestone (the email carries the same facts). Emails with no notice are absent. */
export const NOTICE_FOR_EMAIL: Partial<Record<EmailTemplateKey, NoticeKind>> = {
  order_placed: 'order.placed',
  order_confirmed: 'order.confirmed',
  order_out_for_delivery: 'order.out_for_delivery',
  order_delivered: 'order.delivered',
  order_cancelled: 'order.cancelled',
  order_rejected: 'order.rejected',
  payment_received: 'payment.received',
  refund_requested: 'refund.requested',
  refund_processed: 'refund.processed',
  refund_failed: 'refund.failed',
  refund_declined: 'refund.declined',
  service_request_received: 'service.received',
  service_proposed: 'service.proposed',
  service_confirmed: 'service.confirmed',
  service_estimate_ready: 'service.estimate_ready',
  service_ready: 'service.ready',
  service_bill_ready: 'service.bill_ready',
  service_completed: 'service.completed',
  service_cancelled: 'service.cancelled',
  quote_offer: 'quote.offer',
  quote_expiring: 'quote.expiring',
  ticket_received: 'ticket.received',
  ticket_reply: 'ticket.reply',
  ticket_resolved: 'ticket.resolved',
  shop_order_routed: 'shop.order_routed',
  partner_warning_issued: 'partner.warning',
  cod_approved: 'account.cod_approved',
  cod_rejected: 'account.cod_rejected',
  cod_revoked: 'account.cod_revoked',
};

export type NoticeLocale = 'en' | 'hi';

export const NOTICE_LIMITS = { title: 80, body: 240 } as const;

export interface NoticeCopy {
  title: string;
  body: string;
}

interface CopyTree {
  notify: Record<string, { title: string; body: string }>;
}

/** Locale-file key of a kind: `order.confirmed` is `notify.order_confirmed`. */
export const noticeLocaleKey = (kind: NoticeKind): string => kind.replace('.', '_');

/** The shipped default text of a kind. */
export function defaultNoticeCopy(kind: NoticeKind, locale: NoticeLocale): NoticeCopy {
  const tree = (locale === 'hi' ? hi : en) as unknown as CopyTree;
  const copy = tree.notify[noticeLocaleKey(kind)];
  if (!copy) throw new Error(`Missing notice text for ${kind} (${locale})`);
  return { title: copy.title, body: copy.body };
}

/** Plain text only: line breaks and control characters become spaces. */
const plain = (v: string) =>
  v
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Fill `{name}` by plain replacement (never as a message format); a placeholder outside the allowed list is left alone. */
export function fillNotice(text: string, params: Record<string, string>, allowed: readonly string[]): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    allowed.includes(name) && Object.hasOwn(params, name) ? plain(params[name] ?? '') : whole,
  );
}

export interface NoticeOverride {
  title: string | null;
  body: string | null;
}

export type NoticeOverrideProblem =
  'NOTICE_UNKNOWN_KIND' | 'NOTICE_TOO_LONG' | 'NOTICE_UNKNOWN_PLACEHOLDER' | 'NOTICE_HTML';

/** The first problem with an admin override, or null. Unknown placeholders, markup and over-long text are refused. */
export function noticeOverrideProblem(kind: string, o: NoticeOverride): NoticeOverrideProblem | null {
  if (!isNoticeKind(kind)) return 'NOTICE_UNKNOWN_KIND';
  const allowed = new Set<string>(NOTICE_CATALOGUE[kind].text);
  for (const [value, max] of [
    [o.title, NOTICE_LIMITS.title],
    [o.body, NOTICE_LIMITS.body],
  ] as const) {
    if (value === null || value.trim() === '') continue;
    if (value.length > max) return 'NOTICE_TOO_LONG';
    if (/[<>]/.test(value)) return 'NOTICE_HTML';
    for (const m of value.matchAll(/\{(\w*)\}/g))
      if (!allowed.has(m[1] ?? '')) return 'NOTICE_UNKNOWN_PLACEHOLDER';
  }
  return null;
}

/**
 * Title and body for one recipient: the override where set (null or blank = the default), with the facts filled
 * in. Values are cleaned to plain text and the result is cut to the limits (a long name never breaks the push).
 */
export function composeNotice(
  kind: NoticeKind,
  locale: NoticeLocale,
  params: Record<string, string>,
  override?: NoticeOverride | null,
): NoticeCopy {
  const base = defaultNoticeCopy(kind, locale);
  const use = (custom: string | null | undefined, fallback: string) =>
    custom && custom.trim() !== '' ? custom.trim() : fallback;
  const allowed = NOTICE_CATALOGUE[kind].text;
  const cut = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v);
  return {
    title: cut(fillNotice(use(override?.title, base.title), params, allowed), NOTICE_LIMITS.title),
    body: cut(fillNotice(use(override?.body, base.body), params, allowed), NOTICE_LIMITS.body),
  };
}

/** `/hi` prefix for Hindi, like every other link the site builds. */
export const noticePath = (locale: NoticeLocale, path: string): string =>
  locale === 'hi' ? `/hi${path}` : path;

/** The page a notice opens, with the language prefix; always a path on this site. */
export function noticeLink(kind: NoticeKind, locale: NoticeLocale, params: Record<string, string>): string {
  return noticePath(locale, NOTICE_CATALOGUE[kind].link(params));
}
