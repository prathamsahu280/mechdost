'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PERSON_CANCEL_REASONS } from '@mechdost/shared/state';
import type { MyOrder, TrackedOrder } from '@mechdost/shared/checkout-api';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { ORDER_STEPS, isClosedStatus, orderStepIndex } from '@/lib/order-status';
import { StatusTimeline } from './status-timeline';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; order: MyOrder };

/**
 * Order tracking on the API (real data mode; spec 04): `GET /v1/orders/{code}` for the signed-in customer —
 * every part (one per shop) with its seller, timeline, items, the delivery code while out for delivery, a rejection
 * message, and "cancel" while the API allows it. Refreshes every 30 seconds while open.
 */
export function OrderViewApi({ code }: { code: string }) {
  const t = useTranslations('order');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const prefix = locale === 'hi' ? '/hi' : '';

  const refresh = useCallback(async () => {
    const { fetchMyOrder } = await import('@/lib/orders-api');
    const res = await fetchMyOrder(locale, code);
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
  if (!code || (load.kind === 'error' && (load.code === 'NOT_FOUND' || load.code === 'HTTP_404')))
    return <p className={`${box} text-muted`}>{t('api_notFound')}</p>;
  if (load.kind === 'error' && load.code === 'AUTH_REQUIRED')
    return (
      <div className={box}>
        <p className="text-ink">{t('api_signIn')}</p>
        <Link
          href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/orders/${code}`)}`}
          className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('api_signInLink')}
        </Link>
      </div>
    );
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
        <p className="mt-1 font-heading text-lg font-extrabold text-ink">
          {t('api_total')}: {formatPrice(order.totalPaise)}
        </p>
        {order.business ? (
          <p className="mt-1 text-xs text-muted" data-user-content>
            {t('gstInvoiceFor', { business: order.business.businessName, gstin: order.business.gstin })}
          </p>
        ) : null}
      </section>
      {parts.map((part, i) => (
        <OrderPart
          key={part.code}
          part={part}
          label={parts.length > 1 ? t('api_part', { n: i + 1, count: parts.length }) : null}
          onChanged={refresh}
        />
      ))}
      <p className="text-sm text-muted">{t('help')}</p>
    </div>
  );
}

function OrderPart({
  part,
  label,
  onChanged,
}: {
  part: TrackedOrder;
  label: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('order');
  const steps = ORDER_STEPS.map((s) => ({ key: s, title: t(`stage_${s}`), detail: t(`detail_${s}`) }));
  const closed = isClosedStatus(part.status);
  return (
    <section className="space-y-4 rounded-card border border-line-card bg-surface p-6 shadow-card">
      {label ? <p className="text-xs font-extrabold text-muted uppercase">{label}</p> : null}
      {part.seller ? (
        <p className="font-heading font-bold text-ink" data-user-content>
          {t('shopLabel', { shop: part.seller })}
        </p>
      ) : null}
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
      {part.canCancel ? <CancelPart part={part} onChanged={onChanged} /> : null}
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
