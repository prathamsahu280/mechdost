'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PERSON_CANCEL_REASONS } from '@mechdost/shared/state';
import type { MyOrder, TrackedOrder } from '@mechdost/shared/checkout-api';
import { lazy, Suspense, useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { loginHref, orderGroupCode } from '@/lib/record-links';
import { useSignedOut } from '@/lib/use-signed-out';
import { ORDER_STEPS, cancelHelpShown, isClosedStatus, orderStepIndex } from '@/lib/order-status';
import { requestedPartCode } from '@/lib/order-parts';
import { OrderAgain } from '@/components/account/order-again';
import { orderTotalLines } from '@/lib/order-totals';
import { StatusTimeline } from './status-timeline';

/** Reviews of delivered products (spec 02 § Reviews): its own chunk, fetched only when something was delivered. */
const WriteReviewApi = lazy(() =>
  import('../reviews/write-review-api').then((m) => ({ default: m.WriteReviewApi })),
);

/** A stable ref callback: runs on mount only, so the 30 s refresh does not pull the page back to this part. */
const scrollIntoViewOnce = (el: HTMLElement | null) => {
  el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; order: MyOrder };

/**
 * Order tracking on the API (real data mode; spec 04): `GET /v1/orders/{code}` for the signed-in customer —
 * every part (one per shop) with its seller, timeline, items, the delivery code while out for delivery, a rejection
 * message, and "cancel" while the API allows it. Refreshes every 30 seconds while open.
 */
export function OrderViewApi({ code }: { code: string }) {
  const t = useTranslations('order');
  const ts = useTranslations('supportThread');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const prefix = locale === 'hi' ? '/hi' : '';
  const here = usePathname();
  const signedOut = useSignedOut(!code, locale);

  const refresh = useCallback(async () => {
    const { fetchMyOrder } = await import('@/lib/orders-api');
    const res = await fetchMyOrder(locale, orderGroupCode(code));
    setLoad(res.ok ? { kind: 'ok', order: res.data } : { kind: 'error', code: res.code });
  }, [code, locale]);

  useEffect(() => {
    if (!code) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearInterval(id);
    };
  }, [code, refresh]);

  const box = 'rounded-card border border-line-card bg-surface p-6 shadow-card';
  if (signedOut || (load.kind === 'error' && load.code === 'AUTH_REQUIRED'))
    return (
      <div className={box}>
        <p className="text-ink">{t('api_signIn')}</p>
        <Link
          href={loginHref(prefix, here)}
          className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('api_signInLink')}
        </Link>
      </div>
    );
  if (!code || (load.kind === 'error' && (load.code === 'NOT_FOUND' || load.code === 'HTTP_404')))
    return <p className={`${box} text-muted`}>{t('api_notFound')}</p>;
  if (load.kind === 'error')
    return (
      <p role="alert" className={`${box} font-bold text-ink`}>
        {t('api_error')}
      </p>
    );
  if (load.kind === 'loading')
    return (
      <p role="status" className={`${box} text-muted`}>
        {t('api_loading')}
      </p>
    );

  const order = load.order;
  const parts = order.orders;
  const anyOpen = parts.some((p) => !isClosedStatus(p.status));
  const totals = orderTotalLines(order);
  const requested = requestedPartCode(
    code,
    parts.map((p) => p.code),
  );
  return (
    <div className="space-y-6">
      {isNew && anyOpen ? (
        <div role="status" className="flex items-center gap-3 rounded-card bg-success-bg p-5 text-success">
          <PartyPopper aria-hidden="true" className="size-6 shrink-0" />
          <p className="font-heading font-bold">{t('thanks')}</p>
        </div>
      ) : null}
      <section className={`${box} text-sm`}>
        <p className="text-muted">{t('placedOn', { date: formatDate(order.placedAt, locale) })}</p>
        <p className="mt-1 text-ink">
          <span className="font-bold">{t('payment')}:</span>{' '}
          {order.paymentMethod === 'cod'
            ? t('cod')
            : order.paymentStatus === 'paid'
              ? t('api_paidOnline')
              : t('api_payPending')}
        </p>
        {order.coins ? (
          <p className="mt-1 text-success">
            {t('coinsLine', { coins: order.coins.coins })}: −{formatPrice(order.coins.discountPaise)}
          </p>
        ) : null}
        <p className="mt-1 font-heading text-lg font-extrabold text-ink">
          {totals.payablePaise === null
            ? `${t('api_total')}: ${formatPrice(totals.placedPaise)}`
            : t('api_placedTotal', { amount: formatPrice(totals.placedPaise) })}
        </p>
        {totals.payablePaise !== null ? (
          <p className="mt-1 text-ink">
            {t('api_payableTotal', { amount: formatPrice(totals.payablePaise) })}
          </p>
        ) : null}
        {order.business ? (
          <p className="mt-1 text-xs text-muted" data-user-content>
            {t('gstInvoiceFor', { business: order.business.businessName, gstin: order.business.gstin })}
          </p>
        ) : null}
      </section>
      {parts.every((p) => p.status === 'delivered' || isClosedStatus(p.status)) ? (
        <OrderAgain code={order.code} source="page" />
      ) : null}
      {parts.map((part, i) => (
        <OrderPart
          key={part.code}
          highlight={part.code === requested}
          part={part}
          label={parts.length > 1 ? t('api_part', { n: i + 1, count: parts.length }) : null}
          onChanged={refresh}
        />
      ))}
      {parts.some((p) => p.status === 'delivered') ? (
        <Suspense fallback={null}>
          <WriteReviewApi kind="order" code={order.code} />
        </Suspense>
      ) : null}
      <p className="text-sm text-muted">{t('help')}</p>
      <p className="text-sm text-ink">
        {ts('askHelp')}{' '}
        <Link
          href={`${prefix}/account/support?order=${encodeURIComponent(order.code)}`}
          data-track="order_support_thread"
          className="inline-flex min-h-11 items-center font-bold text-accent-soft-text underline underline-offset-4"
        >
          {ts('askHelpLink')}
        </Link>
      </p>
    </div>
  );
}

function OrderPart({
  part,
  label,
  highlight,
  onChanged,
}: {
  part: TrackedOrder;
  label: string | null;
  /** The part the link named (`/orders/<code>-2`): marked and scrolled into view once (QA pass 4, bug 10). */
  highlight: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('order');
  const tr = useTranslations('refunds');
  const locale = useLocale();
  const steps = ORDER_STEPS.map((s) => ({ key: s, title: t(`stage_${s}`), detail: t(`detail_${s}`) }));
  const closed = isClosedStatus(part.status);
  return (
    <section
      ref={highlight ? scrollIntoViewOnce : undefined}
      aria-current={highlight ? 'true' : undefined}
      className={`space-y-4 rounded-card border bg-surface p-6 shadow-card ${highlight ? 'border-accent-button' : 'border-line-card'}`}
    >
      {label ? <p className="text-xs font-extrabold text-muted uppercase">{label}</p> : null}
      {closed ? (
        <div role="status" className="rounded-tile bg-pill p-5 text-ink">
          <p className="font-heading font-bold">
            {part.status === 'cancelled' ? t('cancelledTitle') : t('rejectedTitle')}
          </p>
          {part.message ? (
            <p className="mt-1 text-sm text-muted" data-user-content>
              {part.message}
            </p>
          ) : null}
        </div>
      ) : (
        <StatusTimeline
          label={t('statusLabel')}
          steps={steps}
          current={orderStepIndex(part.status)}
          currentLabel={t('current')}
        />
      )}
      {part.deliveryCode ? (
        <section
          aria-labelledby={`code-${part.code}`}
          className="rounded-tile border-2 border-accent-button bg-accent-soft p-4"
        >
          <h3 id={`code-${part.code}`} className="text-sm font-bold text-accent-soft-text">
            {t('deliveryCodeTitle')}
          </h3>
          <p className="mt-1 font-heading text-3xl font-extrabold tracking-[0.3em] text-ink tabular-nums">
            {part.deliveryCode}
          </p>
          <p className="mt-2 text-sm text-ink">{t('deliveryCodeHelp')}</p>
          <p className="mt-1 text-xs text-muted">{t('deliveryCodeSafety')}</p>
        </section>
      ) : null}
      <div>
        <h3 className="text-sm font-bold text-ink">{t('items')}</h3>
        <ul className="mt-2 divide-y divide-line-card text-sm">
          {part.items.map((it) => (
            <li key={it.sku} className="flex justify-between gap-3 py-2">
              <span className="text-ink">
                {it.title} × {it.qty}
              </span>
              <span className="tabular-nums text-ink">{formatPrice(it.totalPaise)}</span>
            </li>
          ))}
        </ul>
      </div>
      {part.refunds?.length ? <RefundLines part={part} /> : null}
      {part.canCancel ? <CancelPart part={part} onChanged={onChanged} /> : null}
      {cancelHelpShown(part) ? (
        <p className="text-sm text-muted">
          {t('cancelUnavailable')} {t('cancelUnavailableSupport')}{' '}
          <Link
            href={`${locale === 'hi' ? '/hi' : ''}/account/support?order=${encodeURIComponent(part.code)}`}
            data-track="order_cancel_contact_support"
            className="font-bold text-ink underline underline-offset-4"
          >
            {tr('customerSupport')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Refund status of one part (spec 05, decision 2026-11-15: every refund is approved by our team first). One line per
 * refund. Never "refunded" before Razorpay confirms, and never a promise of an automatic or instant refund; a declined
 * or failed refund points to support.
 */
function RefundLines({ part }: { part: TrackedOrder }) {
  const t = useTranslations('refunds');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  return (
    <section aria-labelledby={`refund-${part.code}`} className="rounded-tile border border-line-card p-4">
      <h3 id={`refund-${part.code}`} className="text-sm font-bold text-ink">
        {t('customerTitle')}
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-ink">
        {part.refunds?.map((r) => (
          <li key={`${r.requestedAt}-${String(r.amountPaise)}`}>
            {/* The live region sits inside the item: `role` on the <li> itself would drop it out of the list. */}
            <span role="status">
              {t(`customer_${r.status}`, {
                amount: formatPrice(r.amountPaise),
                date: formatDate(r.processedAt ?? r.requestedAt, locale),
              })}
            </span>
            {r.status === 'declined' || r.status === 'failed' ? (
              <>
                {' '}
                <Link
                  href={`${prefix}/account/support?order=${encodeURIComponent(part.code)}`}
                  data-track="order_refund_contact_support"
                  className="font-bold underline underline-offset-4"
                >
                  {t('customerSupport')}
                </Link>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <Link
        href={`${prefix}/account/refunds`}
        data-track="order_refunds_all"
        className="mt-3 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4"
      >
        {t('customerSeeAll')}
      </Link>
    </section>
  );
}

function CancelPart({ part, onChanged }: { part: TrackedOrder; onChanged: () => Promise<void> }) {
  const t = useTranslations('order');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const picked = new FormData(e.currentTarget).get('reasonCode');
    const reasonCode = PERSON_CANCEL_REASONS.find((r) => r === picked);
    if (!reasonCode) {
      setMissing(true);
      document.getElementById(`cancel-${part.code}`)?.focus();
      return;
    }
    const { cancelMyOrder } = await import('@/lib/orders-api');
    const res = await cancelMyOrder(locale, part.code, reasonCode, part.version);
    if (!res.ok) {
      setFailed(true);
      await onChanged();
      return;
    }
    track('order_cancel_submitted', { code: part.code, by: 'customer', reasonCode });
    await onChanged();
  }

  if (!open)
    return (
      <button
        data-disclosure-trigger="order-cancel"
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {t('cancelAction')}
      </button>
    );
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-2 rounded-tile border border-line-card p-4">
      <p className="text-sm text-ink">{t('cancelNote')}</p>
      <label htmlFor={`cancel-${part.code}`} className="text-sm font-bold text-ink">
        {t('cancelReasonLabel')}
      </label>
      <select
        id={`cancel-${part.code}`}
        name="reasonCode"
        defaultValue=""
        aria-invalid={missing ? true : undefined}
        onChange={() => {
          setMissing(false);
        }}
        className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
      >
        <option value="">{t('reasonChoose')}</option>
        {PERSON_CANCEL_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`cancelReason_${r}`)}
          </option>
        ))}
      </select>
      {missing ? <p className="text-xs font-bold text-error">{t('reasonRequired')}</p> : null}
      {failed ? (
        <p role="alert" className="text-xs font-bold text-error">
          {t('api_error')}
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
