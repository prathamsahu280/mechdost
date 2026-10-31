'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { findProduct } from '@/demo/catalogue';
import { findShop, rankShops } from '@/demo/shops';
import {
  APPLICATION_STAGES,
  moderateReview,
  postQuoteMessage,
  rejectOrder,
  routeOrder,
  routingState,
  sendOffer,
  updateApplication,
  useApplications,
  useOrders,
  useQuotes,
  useRequests,
  useReviews,
  reassignRequest,
  type DemoOrder,
  type DemoQuote,
  type RoutingState,
} from '@/demo/store';
import { DEMO_WORKSHOPS } from '@/demo/workshops';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/sections';
import { PortalGuard, portalCard, portalField, portalPrimary, portalQuiet, useNow } from './portal-guard';

const SECTION_EMOJI: Record<AdminSection, string> = {
  overview: '📊',
  orders: '🧭',
  services: '🔧',
  quotes: '💬',
  applications: '🤝',
  reviews: '⭐',
};

/**
 * Admin operations console (spec 08) in demo mode: KPIs, order routing to shops (ranked suggestions, one click,
 * reroute or reject with a customer message), declined service requests, bulk-quote negotiation with an offer
 * builder, partner applications and review moderation.
 */
export function AdminConsole({ section }: { section: AdminSection }) {
  const path = `/admin${section === 'overview' ? '' : `/${section}`}`;
  return (
    <PortalGuard role="admin" path={path}>
      {() => (
        <div className="grid gap-6 nav:grid-cols-[220px_minmax(0,1fr)] nav:items-start">
          <AdminNav current={section} />
          <div className="min-w-0 space-y-6">
            {section === 'overview' ? <Overview /> : null}
            {section === 'orders' ? <OrderRouting /> : null}
            {section === 'services' ? <ServiceRouting /> : null}
            {section === 'quotes' ? <QuoteDesk /> : null}
            {section === 'applications' ? <Applications /> : null}
            {section === 'reviews' ? <Reviews /> : null}
          </div>
        </div>
      )}
    </PortalGuard>
  );
}

const REASONS = ['timeout', 'stock', 'area', 'busy'] as const;
function reasonKey(reason: string): (typeof REASONS)[number] | 'declined' {
  return REASONS.find((r) => r === reason) ?? 'declined';
}

function usePrefix() {
  return useLocale() === 'hi' ? '/hi' : '';
}

function AdminNav({ current }: { current: AdminSection }) {
  const t = useTranslations('portal');
  const prefix = usePrefix();
  return (
    <nav
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
  const value = orders.filter((o) => !o.rejection).reduce((n, o) => n + o.totalPaise, 0);
  const quotes = useQuotes().filter((q) => q.status === 'open' || q.status === 'offered').length;
  const applications = useApplications().filter(
    (a) => !a.rejected && a.stage < APPLICATION_STAGES.length - 1,
  ).length;
  const reviews = useReviews().filter((r) => r.status === 'pending').length;
  const services = useRequests().length;

  const tiles: { label: string; value: string; href: AdminSection; tone?: 'alert' }[] = [
    {
      label: t('kpi_needsRouting'),
      value: String(count(['needs_routing', 'expired'])),
      href: 'orders',
      tone: 'alert',
    },
    { label: t('kpi_awaitingShop'), value: String(count('awaiting_shop')), href: 'orders' },
    { label: t('kpi_confirmed'), value: String(count('confirmed')), href: 'orders' },
    { label: t('kpi_value'), value: formatPrice(value), href: 'orders' },
    { label: t('kpi_quotes'), value: String(quotes), href: 'quotes' },
    { label: t('kpi_services'), value: String(services), href: 'services' },
    { label: t('kpi_applications'), value: String(applications), href: 'applications' },
    { label: t('kpi_reviews'), value: String(reviews), href: 'reviews' },
  ];

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
    [t('queue_done'), orders.filter((o) => routingState(o, now) === 'confirmed')],
    [t('queue_rejected'), orders.filter((o) => routingState(o, now) === 'rejected')],
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

function RoutingCard({ order, now }: { order: DemoOrder; now: number }) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const locale = useLocale();
  const prefix = usePrefix();
  const [rejecting, setRejecting] = useState(false);
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
  const suggestions = rankShops(categories, [...tried, ...(order.shop ? [order.shop.slug] : [])]).slice(0, 3);
  const shopName = (slug: string) => findShop(slug)?.name ?? slug;
  const canRoute = state === 'needs_routing' || state === 'expired';

  function reject(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get('message');
    if (typeof v === 'string' && rejectOrder(order.code, v)) {
      track('click', { id: 'admin_order_rejected', path: window.location.pathname });
    }
  }

  return (
    <article className={`${portalCard} ${canRoute ? 'border-accent-button/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-lg font-extrabold text-ink">{order.code}</p>
          <p className="text-xs text-muted">
            {formatDate(order.createdAt, locale)} · {order.customer.name} ·{' '}
            {t('orderMeta', {
              items: a('items', { count: order.lines.length }),
              total: formatPrice(order.totalPaise),
              pin: order.customer.pincode,
            })}
          </p>
        </div>
        <Link
          href={`${prefix}/orders/${order.code}`}
          className="text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('openOrder')}
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink">
        {order.lines.map((l) => `${l.name} × ${String(l.qty)}`).join(', ')}
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
          ⏱️ {t('offeredTo', { shop: shopName(order.shop.slug) })} ·{' '}
          {t('expiresIn', {
            minutes: Math.max(0, Math.ceil((new Date(order.shop.expiresAt).getTime() - now) / 60_000)),
          })}
        </p>
      ) : null}
      {state === 'expired' && order.shop ? (
        <p className="mt-3 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
          {t('expired', { shop: shopName(order.shop.slug) })}
        </p>
      ) : null}
      {state === 'confirmed' && order.shop ? (
        <p className="mt-3 rounded-lg bg-success-bg p-3 text-sm font-bold text-success">
          ✅ {t('acceptedBy', { shop: shopName(order.shop.slug) })}
        </p>
      ) : null}
      {state === 'rejected' && order.rejection ? (
        <p className="mt-3 rounded-lg bg-pill p-3 text-sm text-muted">
          {t('rejectedWith', { message: order.rejection.message })}
        </p>
      ) : null}

      {canRoute ? (
        <div className="mt-4">
          <h3 className="text-xs font-extrabold text-muted">{t('suggestions')}</h3>
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
                    {t('coverage', {
                      n: categories.filter((c) => s.categories.includes(c)).length,
                      total: categories.length,
                    })}{' '}
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

      {state !== 'confirmed' && state !== 'rejected' ? (
        rejecting ? (
          <form onSubmit={reject} className="mt-4 space-y-2">
            <label htmlFor={`reject-${order.code}`} className="text-sm font-bold text-ink">
              {t('rejectMessage')}
            </label>
            <textarea
              id={`reject-${order.code}`}
              name="message"
              rows={3}
              maxLength={500}
              defaultValue={t('rejectDefault')}
              className={`${portalField} py-2`}
            />
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
  const declined = useRequests().filter(
    (x) => x.stage === 0 && (x.declinedBy ?? []).includes(x.workshopSlug),
  );
  return (
    <section aria-labelledby="declined-requests">
      <h2 id="declined-requests" className="font-heading text-xl font-extrabold text-ink">
        {t('declinedRequests')} <span className="text-muted tabular-nums">({declined.length})</span>
      </h2>
      {declined.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {declined.map((req) => {
            const options = DEMO_WORKSHOPS.filter(
              (w) => w.vehicles.includes(req.vehicleType) && !(req.declinedBy ?? []).includes(w.slug),
            ).slice(0, 3);
            return (
              <li key={req.code} className={`${portalCard} border-accent-button/60`}>
                <p className="font-heading text-lg font-extrabold text-ink">{req.code}</p>
                <p className="text-sm text-muted">
                  {req.customer.name} · {req.vehicle} · {r('stage_requested')}
                </p>
                <p className="mt-2 text-xs font-bold text-warning">
                  {t('declinedBy', { shop: req.workshopName, reason: t('reason_declined') })}
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
                        <span>🔧 {t('assignTo', { workshop: w.name })}</span>
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
                    {x.customer.name} · {formatDate(x.createdAt, locale)} · {q(`status_${x.status}`)}
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
  const closed = quote.status === 'accepted' || quote.status === 'declined';

  const unit = (slug: string) => Math.max(0, Math.round(Number(prices[slug] ?? 0) * 100));
  const subtotal = quote.lines.reduce((n, l) => n + unit(l.slug) * l.qty, 0);
  const listTotal = quote.lines.reduce((n, l) => n + l.listPaise * l.qty, 0);
  const deliveryPaise = Math.max(0, Math.round(Number(delivery) * 100));
  const discount = listTotal > 0 ? Math.round(((listTotal - subtotal) / listTotal) * 100) : 0;

  function send(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    sendOffer(quote.code, {
      lines: quote.lines.map((l) => ({ slug: l.slug, unitPaise: unit(l.slug) })),
      deliveryPaise,
      validDays: Math.min(30, Math.max(1, Math.floor(Number(days) || 3))),
      note,
    });
    setSent(true);
    track('click', { id: 'admin_quote_offer_sent', path: window.location.pathname });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="quote-chat" className={portalCard}>
        <h2 id="quote-chat" className="font-heading text-lg font-extrabold text-ink">
          {quote.code} · {quote.customer.name} · {q(`status_${quote.status}`)}
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
                    {ours ? q('team') : quote.customer.name} · {formatDate(m.at, locale)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{m.text}</p>
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
        <form onSubmit={send} aria-labelledby="offer-builder" className={`${portalCard} space-y-4`}>
          <h2 id="offer-builder" className="font-heading text-lg font-extrabold text-ink">
            {t('offerBuilder')}
          </h2>
          {quote.lines.map((l) => (
            <div key={l.slug}>
              <label htmlFor={`price-${l.slug}`} className="text-sm font-bold text-ink">
                {t('unitPrice', { name: l.name })}
              </label>
              <input
                id={`price-${l.slug}`}
                inputMode="decimal"
                value={prices[l.slug] ?? ''}
                onChange={(e) => {
                  setPrices((p) => ({ ...p, [l.slug]: e.target.value.replace(/[^\d.]/g, '') }));
                  setSent(false);
                }}
                className={portalField}
              />
              <p className="mt-1 text-xs text-muted">
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
                inputMode="decimal"
                value={delivery}
                onChange={(e) => {
                  setDelivery(e.target.value.replace(/[^\d.]/g, ''));
                }}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor="offer-days" className="text-sm font-bold text-ink">
                {t('validDays')}
              </label>
              <input
                id="offer-days"
                inputMode="numeric"
                value={days}
                onChange={(e) => {
                  setDays(e.target.value.replace(/\D/g, ''));
                }}
                className={portalField}
              />
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
              }}
              className={portalField}
            />
          </div>
          <p className="font-heading text-xl font-extrabold text-ink">
            {t('offerTotal', { price: formatPrice(subtotal + deliveryPaise) })}
          </p>
          {discount > 15 ? (
            <p className="rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
              {t('discountWarn', { percent: discount })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={subtotal <= 0} className={portalPrimary}>
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

function Applications() {
  const t = useTranslations('portal');
  const ap = useTranslations('apply');
  const locale = useLocale();
  const apps = useApplications();
  return (
    <section aria-labelledby="applications-title">
      <h2 id="applications-title" className="font-heading text-xl font-extrabold text-ink">
        {t('nav_applications')}
      </h2>
      {apps.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {apps.map((a) => {
            const stage = APPLICATION_STAGES[a.stage] ?? 'received';
            const done = a.rejected || a.stage >= APPLICATION_STAGES.length - 1;
            return (
              <li key={a.code} className={portalCard}>
                <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
                  {t(`kind_${a.kind}`)} · {a.rejected ? ap('stage_rejected') : ap(`stage_${stage}`)}
                </p>
                <p className="font-heading text-lg font-extrabold text-ink">{a.business || a.name}</p>
                <p className="text-sm text-muted">
                  {a.code} · {a.name} · PIN {a.pincode} · {formatDate(a.createdAt, locale)}
                </p>
                <p className="mt-2 line-clamp-3 text-sm text-ink">{a.details}</p>
                {!done ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        updateApplication(a.code, { stage: a.stage + 1 });
                      }}
                      className={portalPrimary}
                    >
                      {t('nextStep')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateApplication(a.code, { rejected: true });
                      }}
                      className={portalQuiet}
                    >
                      {t('rejectApplication')}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Reviews() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const reviews = useReviews();
  const pending = reviews.filter((r) => r.status === 'pending');
  const target = (slug: string, kind: 'product' | 'workshop') =>
    kind === 'product'
      ? (findProduct(slug)?.name ?? slug)
      : (DEMO_WORKSHOPS.find((w) => w.slug === slug)?.name ?? slug);
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
              <p className="mt-1 font-heading font-extrabold text-ink">{r.title}</p>
              <p className="mt-1 text-sm text-ink">{r.body}</p>
              <p className="mt-2 text-xs text-muted">
                {r.name} · {formatDate(r.createdAt, locale)} ·{' '}
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
