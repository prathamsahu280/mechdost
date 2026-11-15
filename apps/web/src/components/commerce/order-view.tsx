'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PERSON_CANCEL_REASONS } from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { restoreCoinsForOrder } from '@/demo/coins';
import { findShop, rankShops } from '@/demo/shops';
import { useSession } from '@/demo/session';
import {
  advanceOrder,
  cancelDemoOrder,
  cancelViaSupport,
  customerMayCancel,
  isClosed,
  ORDER_STAGES,
  useHydrated,
  useOrders,
  type DemoOrder,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { formatDate, formatPrice } from '@/lib/format';
import { StatusTimeline } from './status-timeline';
import { productNameFor, shopNameFor } from '@/demo/i18n/localize';
import { GstInvoiceLine } from '@/components/commerce/gst-invoice-line';
import { SHOW_DEMO_CONTROLS } from '@/lib/data-mode';

/** Order tracking (spec 04): timeline of the real flow — placed → admin routes → shop accepts → … → delivered. */
export function OrderView({ code }: { code: string }) {
  const t = useTranslations('order');
  const cartT = useTranslations('cart');
  const demo = useTranslations('demo');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const order = useOrders().find((o) => o.code === code);
  const hydrated = useHydrated();
  // The delivery code proves the customer has the parcel: shops, workshops and staff never see it (QA 2026-11-14,
  // U11). Guests who placed the order on this device (no account) still do.
  const viewer = useSession();
  // Customers only for their own order (matched by phone, as the demo keeps no owner id; review 2026-11-14).
  const maySeeCode =
    viewer === null || (viewer.role === 'customer' && order?.customer.phone === viewer.phone);

  if (!hydrated) return <div className="skeleton h-80 rounded-card" aria-hidden="true" />;
  if (!order) {
    return (
      <div className="rounded-card border border-line-card bg-surface p-8 shadow-card">
        <p className="text-muted">{t('notFound')}</p>
        <Link
          href={`${locale === 'hi' ? '/hi' : ''}/shop`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white"
        >
          {cartT('emptyAction')}
        </Link>
      </div>
    );
  }

  // An admin-confirmed delivery must not say "confirmed with your code" (QA 2026-11-14, B4).
  const bySupport = order.delivery?.method === 'override';
  const steps = ORDER_STAGES.map((s) => ({
    key: s,
    title: t(`stage_${s}`),
    detail: s === 'delivered' && bySupport ? t('detail_delivered_support') : t(`detail_${s}`),
  }));

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_380px] nav:items-start">
      <div className="space-y-6">
        {/* Not on an order that has since been cancelled or rejected (QA 2026-11-14, B5). */}
        {isNew && !order.cancellation && !order.rejection ? (
          <div
            role="status"
            className="animate-page-in flex items-center gap-3 rounded-card bg-success-bg p-5 text-success"
          >
            <PartyPopper aria-hidden="true" className="size-6 shrink-0" />
            <p className="font-heading font-bold">{t('thanks')}</p>
          </div>
        ) : null}
        <section className="rounded-card border border-line-card bg-surface p-6 shadow-card">
          <h2 className="font-heading text-lg font-extrabold text-ink">{t('statusLabel')}</h2>
          {order.cancellation ? (
            <div
              id="order-cancelled"
              role="status"
              tabIndex={-1}
              className="mt-5 rounded-tile bg-pill p-5 text-ink"
            >
              <p className="font-heading font-bold">{t('cancelledTitle')}</p>
              <p className="mt-1 text-sm text-muted">
                {t(order.cancellation.by === 'customer' ? 'cancelledByYou' : 'cancelledByMechDost', {
                  date: formatDate(order.cancellation.at, locale),
                })}{' '}
                · {t(`cancelReason_${order.cancellation.reasonCode}`)}
              </p>
            </div>
          ) : order.rejection ? (
            <div role="status" className="mt-5 rounded-tile bg-warning-bg p-5 text-warning">
              <p className="font-heading font-bold">{t('rejectedTitle')}</p>
              {order.rejection.reasonCode ? (
                <p className="mt-1 text-sm">
                  {t(`rejectedBecause_${order.rejection.reasonCode}`)} {t('rejectedCod')}
                </p>
              ) : null}
              {order.rejection.message ? (
                <p className="mt-1 text-sm">
                  {order.rejection.reasonCode ? (
                    <span className="font-bold">{t('rejectedNote')} </span>
                  ) : null}
                  <span data-user-content>{order.rejection.message}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-5">
              <StatusTimeline
                label={t('statusLabel')}
                steps={steps}
                current={order.stage}
                currentLabel={t('current')}
              />
            </div>
          )}
          {/* Delivered: rate what was bought, right here (QA 2026-11-14, U15: the copy pointed to the account,
              which has no reviews). */}
          {maySeeCode && !isClosed(order) && order.stage === ORDER_STAGES.length - 1 ? (
            <section aria-labelledby="rate-title" className="mt-5">
              <h3 id="rate-title" className="font-heading font-extrabold text-ink">
                {t('rateTitle')}
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {order.lines.map((l) => (
                  <li key={l.slug}>
                    <Link
                      href={`${locale === 'hi' ? '/hi' : ''}/shop/${l.slug}#reviews-${l.slug}`}
                      data-track="order_rate_product"
                      className="press inline-flex min-h-11 items-center rounded-pill border border-line-input px-4 text-sm font-bold text-ink hover:border-ink"
                    >
                      {t('rateProduct', { product: productNameFor(l.slug, l.name, locale) })}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {order.shop?.status === 'accepted' ? (
            <p className="mt-4 text-sm font-bold text-ink">
              <span aria-hidden="true">🏪 </span>
              {t('shopLabel', {
                shop: shopNameFor(
                  order.shop.slug,
                  findShop(order.shop.slug)?.name ?? order.shop.slug,
                  locale,
                ),
              })}
            </p>
          ) : null}
          {maySeeCode && order.delivery && !order.delivery.confirmedAt && !isClosed(order) ? (
            <section
              aria-labelledby="delivery-code-title"
              className="mt-5 rounded-tile border-2 border-accent-button bg-accent-soft p-5"
            >
              <h3 id="delivery-code-title" className="font-heading font-extrabold text-ink">
                <span aria-hidden="true">🔐 </span>
                {t('deliveryCodeTitle')}
              </h3>
              <p className="mt-2 font-heading text-[40px] leading-none font-extrabold tracking-[0.3em] text-ink tabular-nums">
                {order.delivery.code}
              </p>
              <p className="mt-3 text-sm text-ink">{t('deliveryCodeHelp')}</p>
              <p className="mt-1 text-xs text-muted">{t('deliveryCodeSafety')}</p>
            </section>
          ) : null}
          {order.delivery?.confirmedAt ? (
            <p className="mt-4 text-sm font-bold text-success">
              ✅{' '}
              {order.delivery.method === 'override'
                ? t('deliveredBySupport', { date: formatDate(order.delivery.confirmedAt, locale) })
                : t('deliveredWithCode', { date: formatDate(order.delivery.confirmedAt, locale) })}
            </p>
          ) : null}
          {customerMayCancel(order) ? <CancelOrder order={order} /> : null}
          {cancelViaSupport(order) ? (
            <p className="mt-4 text-sm text-muted">
              {t('cancelViaSupport')}{' '}
              <Link
                href={`${locale === 'hi' ? '/hi' : ''}/account/support?order=${encodeURIComponent(order.code)}`}
                data-track="order_cancel_via_support"
                className="font-bold text-accent-soft-text underline-offset-4 hover:underline"
              >
                {t('cancelViaSupportLink')}
              </Link>
            </p>
          ) : null}
          {SHOW_DEMO_CONTROLS && !isClosed(order) && order.stage < ORDER_STAGES.length - 1 ? (
            <details className="mt-6 rounded-lg border border-dashed border-line p-3 text-sm">
              <summary className="cursor-pointer font-bold text-muted">{demo('controls')}</summary>
              <button
                type="button"
                onClick={() => {
                  advanceOrder(order.code, rankShops([])[0]?.slug);
                }}
                className="press mt-3 inline-flex min-h-10 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {demo('advance')}
              </button>
            </details>
          ) : null}
        </section>
      </div>

      <aside className="space-y-4 rounded-card border border-line-card bg-surface p-6 shadow-card">
        <p className="text-xs text-muted">{t('placedOn', { date: formatDate(order.createdAt, locale) })}</p>
        <div>
          <h2 className="font-heading font-bold text-ink">{t('items')}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {order.lines.map((l) => (
              <li key={l.slug} className="flex justify-between gap-3">
                <span>
                  {l.brand} {productNameFor(l.slug, l.name, locale)}{' '}
                  <span className="text-muted">× {l.qty}</span>
                </span>
                <span className="font-bold">{formatPrice(l.unitPaise * l.qty)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{cartT('delivery')}</dt>
              <dd>{order.deliveryPaise === 0 ? cartT('free') : formatPrice(order.deliveryPaise)}</dd>
            </div>
            {order.coins ? (
              <div className="flex justify-between text-success">
                <dt>{t('coinsLine', { coins: order.coins.coins })}</dt>
                <dd className="font-bold">−{formatPrice(order.coins.discountPaise)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-base">
              <dt className="font-bold">{cartT('total')}</dt>
              <dd className="font-heading font-extrabold">{formatPrice(order.totalPaise)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h2 className="font-heading font-bold text-ink">{t('deliverTo')}</h2>
          <p data-user-content className="mt-1 text-sm text-muted">
            {order.customer.name} · {order.customer.phone}
            <br />
            {order.customer.address} · {order.customer.pincode}
          </p>
          <GstInvoiceLine business={order.business} />
        </div>
        <div>
          <h2 className="font-heading font-bold text-ink">{t('payment')}</h2>
          <p className="mt-1 text-sm text-muted">{t('cod')}</p>
        </div>
        <p className="text-xs text-muted">{t('help')}</p>
        <Link
          href={`${locale === 'hi' ? '/hi' : ''}/account/support?order=${encodeURIComponent(order.code)}`}
          data-track="order_report_problem"
          className="press inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('reportProblem')}
        </Link>
        <p className="text-[11px] text-muted">{demo('note')}</p>
      </aside>
    </div>
  );
}

/**
 * Customer cancel (spec 05, same rule as the API): until the shop packs the order, with a reason code. Coins used on
 * the order come back; cash on delivery has nothing to refund.
 */
function CancelOrder({ order }: { order: DemoOrder }) {
  const t = useTranslations('order');
  const [open, setOpen] = useState(false);
  useDisclosureFocus(open ? 'order-cancel' : null);
  // No reason is chosen for the customer (QA 2026-11-14, U2; rule 16).
  const [missing, setMissing] = useState(false);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const picked = new FormData(e.currentTarget).get('reasonCode');
    const reasonCode = PERSON_CANCEL_REASONS.find((r) => r === picked && r !== 'customer_unreachable');
    if (!reasonCode) {
      setMissing(true);
      document.getElementById('cancel-reason')?.focus();
      return;
    }
    if (cancelDemoOrder(order.code, 'customer', reasonCode, order.customer.name)) {
      if (order.coins) restoreCoinsForOrder(order.coins.accountId, order.code);
      track('order_cancel_submitted', { code: order.code, by: 'customer', reasonCode });
      // This form unmounts with the order closed: keep keyboard focus on the outcome, not on <body>.
      requestAnimationFrame(() => document.getElementById('order-cancelled')?.focus());
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-disclosure-trigger="order-cancel"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {t('cancelAction')}
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-2 rounded-tile border border-line-card p-4">
      <p className="text-sm text-ink">{t('cancelNote')}</p>
      <label htmlFor="cancel-reason" className="text-sm font-bold text-ink">
        {t('cancelReasonLabel')}
      </label>
      <select
        id="cancel-reason"
        data-disclosure-field="order-cancel"
        name="reasonCode"
        defaultValue=""
        aria-invalid={missing ? true : undefined}
        aria-describedby={missing ? 'cancel-reason-error' : undefined}
        onChange={() => {
          setMissing(false);
        }}
        className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
      >
        <option value="">{t('reasonChoose')}</option>
        {PERSON_CANCEL_REASONS.filter((r) => r !== 'customer_unreachable').map((r) => (
          <option key={r} value={r}>
            {t(`cancelReason_${r}`)}
          </option>
        ))}
      </select>
      {missing ? (
        <p id="cancel-reason-error" className="text-xs font-bold text-error">
          {t('reasonRequired')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="submit"
          className="press inline-flex min-h-11 items-center rounded-button border border-ink px-4 text-sm font-bold text-ink hover:bg-surface-alt"
        >
          {t('cancelConfirm')}
        </button>
        <button
          data-panel-cancel="order-cancel"
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-muted hover:text-ink"
        >
          {t('cancelKeep')}
        </button>
      </div>
    </form>
  );
}
