'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import {
  ASSIGNMENT_DECLINE_REASONS,
  PERSON_CANCEL_REASONS,
  ORDER_REJECT_REASONS,
  type AssignmentDeclineReason,
} from '@mechdost/shared/state';
import { useState, type SyntheticEvent } from 'react';
import { useCenterCurrent } from '@/lib/use-center-current';
import { findProduct } from '@/demo/catalogue';
import { restoreCoinsForOrder } from '@/demo/coins';
import { useSession } from '@/demo/session';
import { localizeShop, productNameFor, shopNameFor, workshopNameFor } from '@/demo/i18n/localize';
import { findShop, rankShops } from '@/demo/shops';
import { shopsOffSale, usePendingPriceRequests } from '@/demo/price-requests';
import { useTickets } from '@/demo/support';
import {
  APPLICATION_STAGES,
  ORDER_STAGES,
  REQUEST_STAGES,
  adminConfirmDelivery,
  cancelDemoOrder,
  rejectOrder,
  staffMayCancel,
  routeOrder,
  routingState,
  useOrders,
  useRequests,
  reassignRequest,
  type DemoOrder,
  type DemoQuote,
  type RoutingState,
} from '@/demo/store';
import { moderateReview, useApplications, useReviews } from '@/demo/partner-store';
import { postQuoteMessage, sendOffer, useQuotes } from '@/demo/quote-store';
import { takesNewWork } from '@/demo/partner-status';
import { DEMO_WORKSHOPS } from '@/demo/workshops';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { parseRupees } from '@/lib/money-input';
import { formatDate, formatPrice } from '@/lib/format';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/sections';
import { AdminCoins } from './admin-coins';
import { AdminNotifications, type NotifyDefaults } from './admin-notifications';
import { AdminSupport } from './admin-support';
import { AdminCatalogue } from './admin-catalogue';
import { AdminPartners } from './admin-partners';
import { AdminCustomers } from './admin-customers';
import {
  ContentEditor,
  LayoutEditor,
  OrderRulesEditor,
  SettingsEditor,
  type ContentDefaults,
} from './admin-site';
import { PortalGuard, portalCard, portalField, portalPrimary, portalQuiet, useNow } from './portal-guard';
import { Applications } from './admin-applications';
import { GstInvoiceLine } from '@/components/commerce/gst-invoice-line';

/** Real sign-in: order routing reads and acts through the API; demo builds never load it (Stream C2, 2026-11-14). */
const OrderRoutingApi = dynamic(() => import('./admin-orders-api').then((m) => m.OrderRoutingApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: the bulk quote desk on the API (spec 19, 2026-11-14); demo builds never load it. */
const QuoteDeskApi = dynamic(() => import('./admin-quotes-api').then((m) => m.QuoteDeskApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: Admin → Errors (Sentry issues through the API, decision 2026-11-14); demo builds never load it. */
const AdminErrorsApi = dynamic(() => import('./admin-errors-api').then((m) => m.AdminErrorsApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: review moderation on the API (spec 02 § Reviews, 2026-11-14); demo builds never load it. */
const AdminReviewsApi = dynamic(() => import('./admin-reviews-api').then((m) => m.AdminReviewsApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: service routing on the API (Stream E, 2026-11-14); demo builds never load it. */
const ServiceRoutingApi = dynamic(() => import('./admin-services-api').then((m) => m.ServiceRoutingApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: service-area PIN codes under Settings (spec 15 "PIN codes", 2026-11-14); demo builds never load it. */
const ServiceAreaApi = dynamic(() => import('./admin-pincodes-api').then((m) => m.ServiceAreaApi), {
  ssr: false,
  loading: () => <div className="skeleton h-64 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: Analytics and the Overview queue counts on the API (spec 08 "Analytics", 2026-11-14). */
const AdminAnalyticsApi = dynamic(() => import('./admin-analytics-api').then((m) => m.AdminAnalyticsApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});
const AdminOverviewApi = dynamic(() => import('./admin-overview-api').then((m) => m.AdminOverviewApi), {
  ssr: false,
  loading: () => <div className="skeleton h-48 rounded-card" aria-hidden="true" />,
});

/** Real sign-in: the finance refund queue (spec 05, decision 2026-11-15); demo builds never load it. */
const RefundQueueApi = dynamic(() => import('./admin-refunds-api').then((m) => m.RefundQueueApi), {
  ssr: false,
  loading: () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />,
});

const SECTION_EMOJI: Record<AdminSection, string> = {
  overview: '📊',
  analytics: '📈',
  orders: '🧭',
  refunds: '💸',
  services: '🔧',
  quotes: '💬',
  applications: '🤝',
  partners: '🏬',
  catalogue: '📦',
  customers: '🙋',
  reviews: '⭐',
  support: '🛟',
  coins: '🪙',
  content: '✏️',
  layout: '🧩',
  settings: '⚙️',
  notifications: '🔔',
  errors: '🚨',
};

/**
 * Admin operations console (spec 08) in demo mode: KPIs, order routing to shops (ranked suggestions, one click,
 * reroute or reject with a customer message), declined service requests, bulk-quote negotiation with an offer
 * builder, partner applications and review moderation.
 */
export function AdminConsole({
  section,
  contentDefaults,
  notifyDefaults,
}: {
  section: AdminSection;
  /** Default site text in both locales (only passed for the content section). */
  contentDefaults?: ContentDefaults;
  /** Default WhatsApp message text in both locales (only passed for the notifications section). */
  notifyDefaults?: NotifyDefaults;
}) {
  const path = `/admin${section === 'overview' ? '' : `/${section}`}`;
  return (
    <PortalGuard role="admin" path={path}>
      {(account) => (
        <div className="grid gap-6 nav:grid-cols-[220px_minmax(0,1fr)] nav:items-start">
          <AdminNav current={section} />
          <div className="min-w-0 space-y-6">
            {section === 'overview' ? AUTH_MODE === 'firebase' ? <AdminOverviewApi /> : <Overview /> : null}
            {section === 'analytics' && AUTH_MODE === 'firebase' ? <AdminAnalyticsApi /> : null}
            {section === 'refunds' && AUTH_MODE === 'firebase' ? <RefundQueueApi /> : null}
            {section === 'orders' ? AUTH_MODE === 'firebase' ? <OrderRoutingApi /> : <OrderRouting /> : null}
            {section === 'services' ? (
              AUTH_MODE === 'firebase' ? (
                <ServiceRoutingApi />
              ) : (
                <ServiceRouting />
              )
            ) : null}
            {section === 'quotes' ? AUTH_MODE === 'firebase' ? <QuoteDeskApi /> : <QuoteDesk /> : null}
            {section === 'applications' ? <Applications /> : null}
            {section === 'reviews' ? AUTH_MODE === 'firebase' ? <AdminReviewsApi /> : <Reviews /> : null}
            {section === 'support' ? <AdminSupport actor={account.name} /> : null}
            {section === 'coins' ? <AdminCoins actor={account.name} /> : null}
            {section === 'partners' ? <AdminPartners actor={account.name} /> : null}
            {section === 'catalogue' ? <AdminCatalogue /> : null}
            {section === 'customers' ? <AdminCustomers actor={account.name} /> : null}
            {section === 'content' && contentDefaults ? (
              <ContentEditor actor={account.name} defaults={contentDefaults} />
            ) : null}
            {section === 'layout' ? <LayoutEditor actor={account.name} /> : null}
            {section === 'settings' ? (
              <div className="space-y-6">
                <SettingsEditor actor={account.name} />
                <OrderRulesEditor />
                {AUTH_MODE === 'firebase' ? <ServiceAreaApi /> : null}
              </div>
            ) : null}
            {section === 'notifications' && notifyDefaults ? (
              <AdminNotifications actor={account.name} defaults={notifyDefaults} />
            ) : null}
            {section === 'errors' && AUTH_MODE === 'firebase' ? <AdminErrorsApi /> : null}
          </div>
        </div>
      )}
    </PortalGuard>
  );
}

/** Decline codes are the API's (`ASSIGNMENT_DECLINE_REASONS`); `timeout` marks an offer that expired. */
const LEGACY_REASONS: Partial<Record<string, AssignmentDeclineReason>> = {
  stock: 'out_of_stock',
  area: 'too_far',
  busy: 'too_busy',
};
function reasonKey(reason: string): AssignmentDeclineReason | 'timeout' | 'declined' {
  if (reason === 'timeout') return 'timeout';
  return ASSIGNMENT_DECLINE_REASONS.find((r) => r === reason) ?? LEGACY_REASONS[reason] ?? 'declined';
}

function usePrefix() {
  return useLocale() === 'hi' ? '/hi' : '';
}

function AdminNav({ current }: { current: AdminSection }) {
  const bar = useCenterCurrent<HTMLElement>(current);
  const t = useTranslations('portal');
  const prefix = usePrefix();
  return (
    <nav
      ref={bar}
      aria-label={t('navLabel')}
      className="-mx-[5%] overflow-x-auto px-[5%] nav:sticky nav:top-28 nav:mx-0 nav:px-0"
    >
      <ul className="flex gap-2 nav:flex-col nav:gap-1">
        {ADMIN_SECTIONS.map((s) => (
          <li key={s}>
            <Link
              href={`${prefix}/admin${s === 'overview' ? '' : `/${s}`}`}
              aria-current={s === current ? 'page' : undefined}
              className={`press flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm font-bold whitespace-nowrap nav:rounded-button ${
                s === current ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
              }`}
            >
              <span aria-hidden="true" className="text-[16px] leading-none">
                {SECTION_EMOJI[s]}
              </span>
              {t(`nav_${s}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Overview() {
  const t = useTranslations('portal');
  const prefix = usePrefix();
  const now = useNow();
  const orders = useOrders();
  const states = orders.map((o) => routingState(o, now));
  const count = (s: RoutingState | RoutingState[]) =>
    states.filter((x) => (Array.isArray(s) ? s.includes(x) : x === s)).length;
  const value = orders.filter((o) => !o.rejection && !o.cancellation).reduce((n, o) => n + o.totalPaise, 0);
  const quotes = useQuotes().filter((q) => q.status === 'open' || q.status === 'offered').length;
  const applications = useApplications().filter(
    (a) => !a.rejected && a.stage < APPLICATION_STAGES.length - 1,
  ).length;
  const reviews = useReviews().filter((r) => r.status === 'pending').length;
  const services = useRequests().length;
  // Waiting work that had no tile (QA 2026-11-14, U4).
  const support = useTickets().filter((x) => x.status === 'open' || x.status === 'in_review').length;
  const priceRequests = usePendingPriceRequests().length;

  const allTiles: { label: string; value: string; href: AdminSection; tone?: 'alert' }[] = [
    {
      label: t('kpi_needsRouting'),
      value: String(count(['needs_routing', 'expired'])),
      href: 'orders',
      tone: 'alert',
    },
    { label: t('kpi_awaitingShop'), value: String(count('awaiting_shop')), href: 'orders' },
    {
      // Delivered orders are done, not "confirmed" work (QA 2026-11-14, U5).
      label: t('kpi_confirmed'),
      value: String(
        orders.filter((o, i) => states[i] === 'confirmed' && o.stage < ORDER_STAGES.indexOf('delivered'))
          .length,
      ),
      href: 'orders',
    },
    { label: t('kpi_value'), value: formatPrice(value), href: 'orders' },
    { label: t('kpi_quotes'), value: String(quotes), href: 'quotes' },
    { label: t('kpi_services'), value: String(services), href: 'services' },
    { label: t('kpi_applications'), value: String(applications), href: 'applications' },
    { label: t('kpi_reviews'), value: String(reviews), href: 'reviews' },
    { label: t('kpi_support'), value: String(support), href: 'support', tone: 'alert' },
    { label: t('kpi_priceRequests'), value: String(priceRequests), href: 'partners', tone: 'alert' },
  ];
  const tiles = allTiles.filter((k) => ADMIN_SECTIONS.includes(k.href));

  return (
    <section aria-labelledby="kpis">
      <h2 id="kpis" className="font-heading text-xl font-extrabold text-ink">
        {t('nav_overview')}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 tab:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Link
              href={`${prefix}/admin/${tile.href}`}
              className={`${portalCard} press block p-4 hover:shadow-card-hover ${
                tile.tone === 'alert' && tile.value !== '0' ? 'border-accent-button' : ''
              }`}
            >
              <span className="block font-heading text-3xl font-extrabold text-ink tabular-nums">
                {tile.value}
              </span>
              <span className="mt-1 block text-sm text-muted">{tile.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrderRouting() {
  const t = useTranslations('portal');
  const now = useNow();
  const orders = useOrders();
  const groups: [string, DemoOrder[]][] = [
    [t('queue_needs'), orders.filter((o) => ['needs_routing', 'expired'].includes(routingState(o, now)))],
    [t('queue_awaiting'), orders.filter((o) => routingState(o, now) === 'awaiting_shop')],
    // Delivered orders have their own list (lifecycle QA 2026-11-14, 5: they stayed under "in delivery").
    [
      t('queue_done'),
      orders.filter((o) => routingState(o, now) === 'confirmed' && o.stage < ORDER_STAGES.length - 1),
    ],
    [
      t('queue_delivered'),
      orders.filter((o) => routingState(o, now) === 'confirmed' && o.stage === ORDER_STAGES.length - 1),
    ],
    [t('queue_rejected'), orders.filter((o) => routingState(o, now) === 'rejected')],
    [t('queue_cancelled'), orders.filter((o) => routingState(o, now) === 'cancelled')],
  ];
  return (
    <div className="space-y-8">
      {groups.map(([title, list], i) => (
        <section key={title} aria-labelledby={`queue-${String(i)}`}>
          <h2 id={`queue-${String(i)}`} className="font-heading text-xl font-extrabold text-ink">
            {title} <span className="text-muted tabular-nums">({list.length})</span>
          </h2>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
          ) : (
            <ul className="mt-3 grid gap-3 xl:grid-cols-2">
              {list.map((o) => (
                <li key={o.code}>
                  <RoutingCard order={o} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Exception path for proof of delivery: the customer cannot give the code (phone dead, code lost, locked after
 * 5 wrong tries). Admin confirms delivery only with a written reason, which stays on the order (audited in
 * production).
 */
function DeliveryOverride({ order }: { order: DemoOrder }) {
  const t = useTranslations('portal');
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `override-${order.code}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('reason');
    if (typeof reason !== 'string' || !adminConfirmDelivery(order.code, reason, session?.name ?? 'Admin')) {
      setError(t('overrideReasonError'));
      document.getElementById(fieldId)?.focus();
      return;
    }
    track('click', { id: 'admin_delivery_override', path: window.location.pathname });
  }

  return (
    <div className="mt-3 rounded-lg bg-pill p-3 text-sm">
      <p className="text-ink">
        <span aria-hidden="true">🚚 </span>
        {t('outForDelivery', { attempts: order.delivery?.attempts ?? 0 })}
      </p>
      {open ? (
        <form noValidate onSubmit={onSubmit} className="mt-2">
          <label htmlFor={fieldId} className="text-sm font-bold text-ink">
            {t('overrideReason')}
          </label>
          <input
            id={fieldId}
            name="reason"
            maxLength={300}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className={portalField}
          />
          {error ? (
            <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm font-bold text-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className={`${portalQuiet} mt-2`}>
            {t('overrideConfirm')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="mt-1 inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('overrideOpen')}
        </button>
      )}
    </div>
  );
}

function RoutingCard({ order, now }: { order: DemoOrder; now: number }) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const locale = useLocale();
  const prefix = usePrefix();
  const ord = useTranslations('order');
  const session = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Which form was sent without a reason (QA 2026-11-14, U2: no preselected reason codes, rule 16).
  const [noReason, setNoReason] = useState<'reject' | 'cancel' | null>(null);
  const [shortNote, setShortNote] = useState(false);
  const state = routingState(order, now);
  const categories = [
    ...new Set(
      order.lines.flatMap((l) => {
        const product = findProduct(l.slug);
        return product ? [product.category] : [];
      }),
    ),
  ];
  const tried = (order.declined ?? []).map((d) => d.slug);
  // A shop whose product was taken off sale (rejected price change) is not offered; nearby shops serve it.
  const offSale = shopsOffSale(order.lines.map((l) => l.slug));
  const suggestions = rankShops(categories, [...tried, ...offSale, ...(order.shop ? [order.shop.slug] : [])])
    .slice(0, 3)
    .map((s) => localizeShop(s, locale));
  const shopName = (slug: string) => shopNameFor(slug, findShop(slug)?.name ?? slug, locale);
  const canRoute = state === 'needs_routing' || state === 'expired';

  function reject(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const v = data.get('message');
    const reasonCode = ORDER_REJECT_REASONS.find((r) => r === data.get('reasonCode'));
    if (!reasonCode) {
      setNoReason('reject');
      document.getElementById(`reject-reason-${order.code}`)?.focus();
      return;
    }
    if (typeof v !== 'string' || v.trim().length < 10) {
      setShortNote(true);
      document.getElementById(`reject-${order.code}`)?.focus();
      return;
    }
    if (typeof v === 'string' && rejectOrder(order.code, v, reasonCode)) {
      // Coins used on a rejected order go back to the customer (never as money; spec 20).
      if (order.coins) restoreCoinsForOrder(order.coins.accountId, order.code);
      track('click', { id: 'admin_order_rejected', path: window.location.pathname });
    }
  }

  function cancel(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const picked = new FormData(e.currentTarget).get('reasonCode');
    const reasonCode = PERSON_CANCEL_REASONS.find((r) => r === picked);
    if (!reasonCode) {
      setNoReason('cancel');
      document.getElementById(`cancel-reason-${order.code}`)?.focus();
      return;
    }
    if (cancelDemoOrder(order.code, 'staff', reasonCode, session?.name ?? 'MechDost')) {
      if (order.coins) restoreCoinsForOrder(order.coins.accountId, order.code);
      track('order_cancel_submitted', { code: order.code, by: 'staff', reasonCode });
      setCancelling(false);
    }
  }

  return (
    <article className={`${portalCard} ${canRoute ? 'border-accent-button/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-lg font-extrabold text-ink">{order.code}</p>
          <p className="text-xs text-muted">
            {formatDate(order.createdAt, locale)} · <span data-user-content>{order.customer.name}</span> ·{' '}
            {t('orderMeta', {
              items: a('items', { count: order.lines.length }),
              total: formatPrice(order.totalPaise),
              pin: order.customer.pincode,
            })}
          </p>
          <GstInvoiceLine business={order.business} className="mt-1 text-xs font-bold text-ink" />
        </div>
        <Link
          href={`${prefix}/orders/${order.code}`}
          className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('openOrder')}
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink">
        {order.lines
          .map((l) => `${l.brand} ${productNameFor(l.slug, l.name, locale)} × ${String(l.qty)}`)
          .join(', ')}
      </p>

      {(order.declined ?? []).map((d) => (
        <p key={`${d.slug}-${d.at}`} className="mt-2 text-xs font-bold text-warning">
          {t('declinedBy', {
            shop: shopName(d.slug),
            reason: t(`reason_${reasonKey(d.reason)}`),
          })}
        </p>
      ))}

      {state === 'awaiting_shop' && order.shop ? (
        <p className="mt-3 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
          <span aria-hidden="true">⏱️ </span>
          {t('offeredTo', { shop: shopName(order.shop.slug) })} ·{' '}
          {t('expiresIn', {
            minutes: Math.max(0, Math.ceil((new Date(order.shop.expiresAt).getTime() - now) / 60_000)),
          })}
        </p>
      ) : null}
      {state === 'expired' && order.shop ? (
        <p className="mt-3 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
          {takesNewWork('shop', order.shop.slug)
            ? t('expired', { shop: shopName(order.shop.slug) })
            : t('expiredPaused', { shop: shopName(order.shop.slug) })}
        </p>
      ) : null}
      {state === 'confirmed' && order.shop ? (
        <p className="mt-3 rounded-lg bg-success-bg p-3 text-sm font-bold text-success">
          <span aria-hidden="true">✅ </span>
          {t('acceptedBy', { shop: shopName(order.shop.slug) })}
        </p>
      ) : null}
      {order.delivery && !order.delivery.confirmedAt ? <DeliveryOverride order={order} /> : null}
      {order.delivery?.method === 'override' ? (
        // Staff name and reason are typed by staff (user content); the frame text comes from the locale file.
        <p data-user-content className="mt-3 rounded-lg bg-private-bg p-3 text-sm text-private">
          {t('deliveryOverridden', {
            by: order.delivery.overrideBy ?? '',
            reason: order.delivery.overrideReason ?? '',
          })}
        </p>
      ) : null}
      {state === 'rejected' && order.rejection ? (
        <p data-user-content className="mt-3 rounded-lg bg-pill p-3 text-sm text-muted">
          {t('rejectedWith', {
            message:
              order.rejection.message ||
              (order.rejection.reasonCode ? ord(`rejectReason_${order.rejection.reasonCode}`) : ''),
          })}
        </p>
      ) : null}
      {state === 'cancelled' && order.cancellation ? (
        <p className="mt-3 rounded-lg bg-pill p-3 text-sm text-muted">
          {t(order.cancellation.by === 'customer' ? 'cancelledByCustomer' : 'cancelledByStaff', {
            date: formatDate(order.cancellation.at, locale),
          })}{' '}
          · {ord(`cancelReason_${order.cancellation.reasonCode}`)}
        </p>
      ) : null}

      {canRoute ? (
        <div className="mt-4">
          <h3 className="text-xs font-extrabold text-muted">{t('suggestions')}</h3>
          {suggestions.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-warning">{t('noShopCanTake')}</p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {suggestions.map((s, i) => (
              <li
                key={s.slug}
                className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-line-card p-3"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-bold text-ink">🏪 {s.name}</span>
                  {i === 0 ? (
                    <span className="ml-2 rounded-pill bg-success-bg px-2 py-0.5 text-[11px] font-extrabold text-success">
                      {t('recommended')}
                    </span>
                  ) : null}
                  <span className="block text-xs text-muted">
                    {s.area} ·{' '}
                    {categories.length > 0 && !categories.some((c) => s.categories.includes(c)) ? (
                      <span className="font-bold text-warning">{t('coverageNone')}</span>
                    ) : (
                      t('coverage', {
                        n: categories.filter((c) => s.categories.includes(c)).length,
                        total: categories.length,
                      })
                    )}{' '}
                    · {t('acceptance', { rate: s.acceptance, minutes: s.acceptMinutes })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    routeOrder(order.code, s.slug);
                    track('click', { id: 'admin_order_routed', path: window.location.pathname });
                  }}
                  className={i === 0 ? portalPrimary : portalQuiet}
                >
                  {t('routeTo', { shop: s.name })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {staffMayCancel(order) ? (
        cancelling ? (
          <form onSubmit={cancel} className="mt-4 space-y-2">
            <label htmlFor={`cancel-reason-${order.code}`} className="text-sm font-bold text-ink">
              {t('cancelReason')}
            </label>
            <select
              id={`cancel-reason-${order.code}`}
              name="reasonCode"
              defaultValue=""
              aria-invalid={noReason === 'cancel' ? true : undefined}
              aria-describedby={noReason === 'cancel' ? `cancel-reason-${order.code}-error` : undefined}
              onChange={() => {
                setNoReason(null);
              }}
              className={portalField}
            >
              <option value="">{t('reasonChoose')}</option>
              {PERSON_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {ord(`cancelReason_${r}`)}
                </option>
              ))}
            </select>
            {noReason === 'cancel' ? (
              <p id={`cancel-reason-${order.code}-error`} className="text-xs font-bold text-error">
                {t('reasonRequired')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={portalPrimary}>
                {t('cancelConfirm', { code: order.code })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelling(false);
                }}
                className={portalQuiet}
              >
                {a('cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCancelling(true);
            }}
            className="mt-3 mr-4 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:underline"
          >
            {t('cancelOrder')}
          </button>
        )
      ) : null}
      {state !== 'confirmed' && state !== 'rejected' && state !== 'cancelled' ? (
        rejecting ? (
          <form onSubmit={reject} className="mt-4 space-y-2">
            <label htmlFor={`reject-reason-${order.code}`} className="text-sm font-bold text-ink">
              {t('rejectReason')}
            </label>
            <select
              id={`reject-reason-${order.code}`}
              name="reasonCode"
              defaultValue=""
              aria-invalid={noReason === 'reject' ? true : undefined}
              aria-describedby={noReason === 'reject' ? `reject-reason-${order.code}-error` : undefined}
              onChange={() => {
                setNoReason(null);
              }}
              className={portalField}
            >
              <option value="">{t('reasonChoose')}</option>
              {ORDER_REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {ord(`rejectReason_${r}`)}
                </option>
              ))}
            </select>
            {noReason === 'reject' ? (
              <p id={`reject-reason-${order.code}-error`} className="text-xs font-bold text-error">
                {t('reasonRequired')}
              </p>
            ) : null}
            <label htmlFor={`reject-${order.code}`} className="text-sm font-bold text-ink">
              {t('rejectMessage')}
            </label>
            <textarea
              id={`reject-${order.code}`}
              name="message"
              rows={3}
              maxLength={500}
              aria-invalid={shortNote ? true : undefined}
              aria-describedby={shortNote ? `reject-${order.code}-error` : undefined}
              onChange={() => {
                setShortNote(false);
              }}
              className={`${portalField} py-2`}
            />
            {shortNote ? (
              <p id={`reject-${order.code}-error`} className="text-xs font-bold text-error">
                {t('rejectMessageShort')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={portalPrimary}>
                {t('rejectSend')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false);
                }}
                className={portalQuiet}
              >
                {a('cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setRejecting(true);
            }}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:underline"
          >
            {t('reject')}
          </button>
        )
      ) : null}
    </article>
  );
}

function ServiceRouting() {
  const t = useTranslations('portal');
  const r = useTranslations('request');
  const locale = useLocale();
  const prefix = usePrefix();
  const all = useRequests();
  const declined = all.filter(
    (x) => !x.cancellation && x.stage === 0 && (x.declinedBy ?? []).includes(x.workshopSlug),
  );
  return (
    <div className="space-y-8">
      <section aria-labelledby="declined-requests">
        <h2 id="declined-requests" className="font-heading text-xl font-extrabold text-ink">
          {t('declinedRequests')} <span className="text-muted tabular-nums">({declined.length})</span>
        </h2>
        {declined.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
        ) : (
          <ul className="mt-3 grid gap-3 xl:grid-cols-2">
            {declined.map((req) => {
              // Paused or suspended workshops are never offered (admin control).
              const options = DEMO_WORKSHOPS.filter(
                (w) =>
                  w.vehicles.includes(req.vehicleType) &&
                  !(req.declinedBy ?? []).includes(w.slug) &&
                  takesNewWork('workshop', w.slug),
              ).slice(0, 3);
              return (
                <li key={req.code} className={`${portalCard} border-accent-button/60`}>
                  <p className="font-heading text-lg font-extrabold text-ink">{req.code}</p>
                  <p className="text-sm text-muted">
                    <span data-user-content>
                      {req.customer.name} · {req.vehicle}
                    </span>{' '}
                    · {r('stage_requested')}
                  </p>
                  <p className="mt-2 text-xs font-bold text-warning">
                    {t('declinedBy', {
                      shop: workshopNameFor(req.workshopSlug, req.workshopName, locale),
                      reason: t('reason_declined'),
                    })}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {options.map((w) => (
                      <li key={w.slug}>
                        <button
                          type="button"
                          onClick={() => {
                            reassignRequest(req.code, { slug: w.slug, name: w.name });
                          }}
                          className={`${portalQuiet} w-full justify-between`}
                        >
                          <span>
                            🔧 {t('assignTo', { workshop: workshopNameFor(w.slug, w.name, locale) })}
                          </span>
                          <span className="text-xs text-muted">★ {w.rating.toFixed(1)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {/* Every request, so the section matches the Overview count (UI review 2026-11-14). */}
      <section aria-labelledby="all-requests">
        <h2 id="all-requests" className="font-heading text-xl font-extrabold text-ink">
          {t('allRequests')} <span className="text-muted tabular-nums">({all.length})</span>
        </h2>
        {all.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
        ) : (
          <ul className={`mt-3 divide-y divide-line-card ${portalCard}`}>
            {all.map((req) => (
              <li key={req.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="font-heading font-extrabold text-ink">{req.code}</p>
                  <p className="text-sm text-muted">
                    <span data-user-content>{req.customer.name}</span> ·{' '}
                    {workshopNameFor(req.workshopSlug, req.workshopName, locale)} ·{' '}
                    {req.cancellation
                      ? r('cancelledTitle')
                      : r(`stage_${REQUEST_STAGES[req.stage] ?? 'requested'}`)}
                  </p>
                </div>
                <Link
                  href={`${prefix}/service/${req.code}`}
                  data-track="admin_open_request"
                  className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
                >
                  {t('openRequest')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QuoteDesk() {
  const t = useTranslations('portal');
  const q = useTranslations('quote');
  const locale = useLocale();
  const quotes = useQuotes();
  const [selected, setSelected] = useState<string | null>(null);
  const active =
    quotes.find((x) => x.code === selected) ?? quotes.find((x) => x.status === 'open') ?? quotes[0];

  return (
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start">
      <section aria-labelledby="quote-list">
        <h2 id="quote-list" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_quotes')}
        </h2>
        {quotes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {quotes.map((x) => (
              <li key={x.code}>
                <button
                  type="button"
                  aria-pressed={active?.code === x.code}
                  onClick={() => {
                    setSelected(x.code);
                  }}
                  className={`press w-full rounded-tile border p-3 text-left ${
                    active?.code === x.code
                      ? 'border-accent-button bg-accent-soft'
                      : 'border-line-card bg-surface hover:bg-pill'
                  }`}
                >
                  <span className="block font-bold text-ink">{x.code}</span>
                  <span className="block text-xs text-muted">
                    <span data-user-content>{x.customer.name}</span> · {formatDate(x.createdAt, locale)} ·{' '}
                    {q(`status_${x.status}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {active ? (
        <QuoteNegotiation key={active.code} quote={active} />
      ) : (
        <p className="text-sm text-muted">{t('selectQuote')}</p>
      )}
    </div>
  );
}

function QuoteNegotiation({ quote }: { quote: DemoQuote }) {
  const t = useTranslations('portal');
  const q = useTranslations('quote');
  const locale = useLocale();
  const latest = quote.offers.at(-1);
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      quote.lines.map((l) => [
        l.slug,
        String((latest?.lines.find((x) => x.slug === l.slug)?.unitPaise ?? l.listPaise) / 100),
      ]),
    ),
  );
  const [delivery, setDelivery] = useState(String((latest?.deliveryPaise ?? 0) / 100));
  const [days, setDays] = useState('3');
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState(false);
  // Errors show once a field was left or a send was tried, and clear as soon as the value is valid (a11y review).
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const closed = quote.status === 'accepted' || quote.status === 'declined';

  // Typed values are parsed to integer paise once; a bad value is an error, never NaN in the total (review B4).
  const parsed = Object.fromEntries(quote.lines.map((l) => [l.slug, parseRupees(prices[l.slug] ?? '')]));
  const deliveryParsed = parseRupees(delivery, { allowZero: true });
  const daysValue = /^\d{1,2}$/.test(days) ? Number(days) : 0;
  const daysOk = daysValue >= 1 && daysValue <= 30;
  const fieldError = (id: string): string | null => {
    if (!touched.has(id)) return null;
    if (id === 'offer-days') return daysOk ? null : t('daysRange');
    const r = id === 'offer-delivery' ? deliveryParsed : parsed[id.slice('price-'.length)];
    if (!r || r.ok) return null;
    return r.error === 'empty' ? t('priceEmpty') : r.error === 'zero' ? t('priceZero') : t('priceFormat');
  };
  const fieldIds = [...quote.lines.map((l) => `price-${l.slug}`), 'offer-delivery', 'offer-days'];
  const allValid = Object.values(parsed).every((r) => r.ok) && deliveryParsed.ok && daysOk;
  const unit = (slug: string) => {
    const r = parsed[slug];
    return r?.ok ? r.paise : 0;
  };
  const subtotal = quote.lines.reduce((n, l) => n + unit(l.slug) * l.qty, 0);
  const listTotal = quote.lines.reduce((n, l) => n + l.listPaise * l.qty, 0);
  const deliveryPaise = deliveryParsed.ok ? deliveryParsed.paise : 0;
  const discount = listTotal > 0 ? Math.round(((listTotal - subtotal) / listTotal) * 100) : 0;
  const touch = (id: string) => {
    setTouched((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  };
  // Accessible error wiring for one field: aria-invalid plus the error text before the hint.
  const errorProps = (id: string, hintId?: string) => {
    const err = fieldError(id);
    const describedBy = [err ? `${id}-error` : null, hintId ?? null].filter(Boolean).join(' ');
    return {
      'aria-invalid': err ? true : undefined,
      'aria-describedby': describedBy || undefined,
      onBlur: () => {
        touch(id);
      },
    } as const;
  };
  const errorText = (id: string) => {
    const err = fieldError(id);
    return err ? (
      <p id={`${id}-error`} className="mt-1 text-sm font-bold text-error">
        {err}
      </p>
    ) : null;
  };
  const invalid = (id: string) =>
    id === 'offer-days'
      ? !daysOk
      : id === 'offer-delivery'
        ? !deliveryParsed.ok
        : !parsed[id.slice('price-'.length)]?.ok;

  function send(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!allValid) {
      // The button stays enabled: a failed send shows every error and moves focus to the first one.
      setTouched(new Set(fieldIds));
      const first = fieldIds.find(invalid);
      if (first) document.getElementById(first)?.focus();
      track('click', { id: 'admin_quote_offer_invalid', path: window.location.pathname });
      return;
    }
    sendOffer(quote.code, {
      lines: quote.lines.map((l) => ({ slug: l.slug, unitPaise: unit(l.slug) })),
      deliveryPaise,
      validDays: daysValue,
      note,
    });
    setSent(true);
    track('click', { id: 'admin_quote_offer_sent', path: window.location.pathname });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="quote-chat" className={portalCard}>
        <h2 id="quote-chat" className="font-heading text-lg font-extrabold text-ink">
          {quote.code} · <span data-user-content>{quote.customer.name}</span> · {q(`status_${quote.status}`)}
        </h2>
        <ol className="mt-4 max-h-80 space-y-3 overflow-y-auto">
          {quote.messages.length === 0 ? <li className="text-sm text-muted">{q('noMessages')}</li> : null}
          {quote.messages.map((m) => {
            const ours = m.from === 'admin';
            return (
              <li key={m.id} className={`flex ${ours ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm text-ink ${ours ? 'rounded-br-md bg-accent-soft' : 'rounded-bl-md bg-surface-alt'}`}
                >
                  <p className="text-[11px] font-extrabold text-muted">
                    {ours ? q('team') : <span data-user-content>{quote.customer.name}</span>} ·{' '}
                    {formatDate(m.at, locale)}
                  </p>
                  <p data-user-content className="mt-0.5 whitespace-pre-wrap">
                    {m.text}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        {closed ? (
          <p className="mt-4 text-sm text-muted">{t('quoteClosed')}</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              postQuoteMessage(quote.code, 'admin', reply);
              setReply('');
            }}
            className="mt-4 flex items-end gap-2"
          >
            <label htmlFor="admin-reply" className="sr-only">
              {t('replyAs')}
            </label>
            <textarea
              id="admin-reply"
              rows={1}
              value={reply}
              maxLength={1000}
              placeholder={t('replyAs')}
              onChange={(e) => {
                setReply(e.target.value);
              }}
              className={`${portalField} mt-0 resize-none py-2.5`}
            />
            <button type="submit" disabled={!reply.trim()} className={portalPrimary}>
              {q('send')}
            </button>
          </form>
        )}
      </section>

      {!closed ? (
        <form
          onSubmit={send}
          noValidate
          aria-labelledby="offer-builder"
          className={`${portalCard} space-y-4`}
        >
          <h2 id="offer-builder" className="font-heading text-lg font-extrabold text-ink">
            {t('offerBuilder')}
          </h2>
          {quote.lines.map((l) => (
            <div key={l.slug}>
              <label htmlFor={`price-${l.slug}`} className="text-sm font-bold text-ink">
                {t('unitPrice', { name: productNameFor(l.slug, l.name, locale) })}
              </label>
              <input
                id={`price-${l.slug}`}
                name={`price-${l.slug}`}
                inputMode="decimal"
                autoComplete="off"
                aria-required="true"
                value={prices[l.slug] ?? ''}
                onChange={(e) => {
                  setPrices((p) => ({ ...p, [l.slug]: e.target.value }));
                  setSent(false);
                }}
                {...errorProps(`price-${l.slug}`, `price-${l.slug}-hint`)}
                className={portalField}
              />
              {errorText(`price-${l.slug}`)}
              {/* A warning, not a block: a higher price can be right, but it should be a choice (QA U14). */}
              {unit(l.slug) > l.listPaise ? (
                <p role="status" className="mt-1 text-xs font-bold text-warning">
                  {t('aboveList', { price: formatPrice(l.listPaise) })}
                </p>
              ) : null}
              <p id={`price-${l.slug}-hint`} className="mt-1 text-xs text-muted">
                {t('listPrice', { price: formatPrice(l.listPaise), qty: l.qty })}
              </p>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="offer-delivery" className="text-sm font-bold text-ink">
                {t('delivery')}
              </label>
              <input
                id="offer-delivery"
                name="offer-delivery"
                inputMode="decimal"
                autoComplete="off"
                value={delivery}
                onChange={(e) => {
                  setDelivery(e.target.value);
                  setSent(false);
                }}
                {...errorProps('offer-delivery')}
                className={portalField}
              />
              {errorText('offer-delivery')}
            </div>
            <div>
              <label htmlFor="offer-days" className="text-sm font-bold text-ink">
                {t('validDays')}
              </label>
              <input
                id="offer-days"
                name="offer-days"
                inputMode="numeric"
                autoComplete="off"
                value={days}
                onChange={(e) => {
                  setDays(e.target.value.trim());
                  setSent(false);
                }}
                {...errorProps('offer-days', 'offer-days-hint')}
                className={portalField}
              />
              {errorText('offer-days')}
              <p id="offer-days-hint" className="mt-1 text-xs text-muted">
                {t('daysRange')}
              </p>
            </div>
          </div>
          <div>
            <label htmlFor="offer-note" className="text-sm font-bold text-ink">
              {t('offerNote')}
            </label>
            <input
              id="offer-note"
              value={note}
              maxLength={500}
              onChange={(e) => {
                setNote(e.target.value);
                setSent(false);
              }}
              className={portalField}
            />
          </div>
          <p className="font-heading text-xl font-extrabold text-ink">
            {allValid ? t('offerTotal', { price: formatPrice(subtotal + deliveryPaise) }) : t('fixPrices')}
          </p>
          {/* Price is set by negotiation (user, Q20): the discount is shown for information, never gated. */}
          {discount > 0 ? (
            <p className="rounded-lg bg-pill p-3 text-sm font-bold text-ink">
              {t('discountInfo', { percent: discount })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={portalPrimary}>
              {t('sendOffer')}
            </button>
            <p role="status" className="text-sm font-bold text-success">
              {sent ? t('offerSent') : ''}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Reviews() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const reviews = useReviews();
  const pending = reviews.filter((r) => r.status === 'pending');
  const target = (slug: string, kind: 'product' | 'workshop') =>
    kind === 'product'
      ? productNameFor(slug, findProduct(slug)?.name ?? slug, locale)
      : workshopNameFor(slug, DEMO_WORKSHOPS.find((w) => w.slug === slug)?.name ?? slug, locale);
  return (
    <section aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="font-heading text-xl font-extrabold text-ink">
        {t('pendingReviews')} <span className="text-muted tabular-nums">({pending.length})</span>
      </h2>
      {pending.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('noReviews')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {pending.map((r) => (
            <li key={r.id} className={portalCard}>
              <p className="text-sm font-bold text-star" aria-hidden="true">
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </p>
              <p className="sr-only">{`${String(r.rating)} / 5`}</p>
              <p data-user-content className="mt-1 font-heading font-extrabold text-ink">
                {r.title}
              </p>
              <p data-user-content className="mt-1 text-sm text-ink">
                {r.body}
              </p>
              <p className="mt-2 text-xs text-muted">
                <span data-user-content>{r.name}</span> · {formatDate(r.createdAt, locale)} ·{' '}
                {t('reviewOn', { target: target(r.slug, r.target) })}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    moderateReview(r.id, 'approved');
                  }}
                  className={portalPrimary}
                >
                  {t('approve')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    moderateReview(r.id, 'hidden');
                  }}
                  className={portalQuiet}
                >
                  {t('hide')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
