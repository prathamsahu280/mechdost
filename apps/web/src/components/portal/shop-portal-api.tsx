'use client';

import { ShopOrderList, OrderChanged, DeliveryCheck, type ShopOrderDto } from '@mechdost/shared/order-views';
import { ASSIGNMENT_DECLINE_REASONS, type AssignmentDeclineReason } from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import {
  addressLines,
  advanceBody,
  apiErrorKey,
  itemTitle,
  minutesLeft,
  nextShopAction,
  shopStageKey,
} from '@/lib/order-views';
import { ApiError, ApiListState, LoadMore } from './api-list-state';
import { portalCard, portalField, portalPrimary, portalQuiet, useNow } from './portal-guard';
import { ShopPricesApi } from './shop-prices-api';
import { useApiList } from './use-api-list';

const OFFER_POLL_MS = 30_000;

/**
 * Shop portal on the API (spec 07, real sign-in only; loaded by `shop-portal.tsx` with a dynamic import so demo
 * builds do not carry it): offers with their accept timer (polled every 30 s), orders in progress with one next
 * step each, delivery with the customer's code, recent delivered/cancelled orders and "Your prices". The API scopes
 * everything to the shops in the signed-in person's grants.
 */
export function ShopOrdersApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const view = useCallback(
    (name: 'offers' | 'active' | 'done') => async (cursor: string | null) => {
      const q = new URLSearchParams({ view: name });
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/shop/orders?${q.toString()}`, ShopOrderList);
      return res.ok
        ? { ok: true as const, data: { items: res.data.orders, next: res.data.nextCursor } }
        : res;
    },
    [locale],
  );
  const offersPage = useCallback((c: string | null) => view('offers')(c), [view]);
  const activePage = useCallback((c: string | null) => view('active')(c), [view]);
  const donePage = useCallback((c: string | null) => view('done')(c), [view]);
  const offers = useApiList(offersPage, OFFER_POLL_MS);
  const active = useApiList(activePage);
  const done = useApiList(donePage);
  const refresh = useCallback(async () => {
    await Promise.all([offers.reload(), active.reload(), done.reload()]);
  }, [offers, active, done]);

  return (
    <>
      <section aria-labelledby="offered-title">
        <h2 id="offered-title" className="font-heading text-xl font-extrabold text-ink">
          {t('offered')}{' '}
          {offers.loading ? null : <span className="text-muted tabular-nums">({offers.items.length})</span>}
        </h2>
        <ApiListState
          loading={offers.loading}
          error={offers.error}
          count={offers.items.length}
          empty={t('noneOffered')}
          onRetry={() => void offers.reload()}
        />
        {offers.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {offers.items.map((o) => (
              <li key={o.assignmentId ?? o.code}>
                <OfferedOrder order={o} onChanged={refresh} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="active-title">
        <h2 id="active-title" className="font-heading text-xl font-extrabold text-ink">
          {t('active')}
        </h2>
        <ApiListState
          loading={active.loading}
          error={active.error}
          count={active.items.length}
          empty={t('noneActive')}
          onRetry={() => void active.reload()}
        />
        {active.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {active.items.map((o) => (
              <li key={o.code}>
                <ActiveOrder order={o} onChanged={refresh} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="delivered-title">
        <h2 id="delivered-title" className="font-heading text-xl font-extrabold text-ink">
          {t('shopDelivered')}
        </h2>
        <ApiListState
          loading={done.loading}
          error={done.error}
          count={done.items.length}
          empty={t('shopDeliveredNone')}
          onRetry={() => void done.reload()}
        />
        {done.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {done.items.map((o) => (
              <li key={o.code} className={portalCard}>
                <StatusPill status={o.status} />
                <OrderLines order={o} />
              </li>
            ))}
          </ul>
        ) : null}
        <LoadMore show={Boolean(done.next)} onClick={() => void done.loadMore()} />
      </section>

      <ShopPricesApi />
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('portal');
  const o = useTranslations('order');
  const cancelled = status === 'cancelled';
  return (
    <p
      className={`mb-2 inline-flex rounded-pill px-3 py-1 text-xs font-extrabold ${
        cancelled ? 'bg-pill text-muted' : 'bg-success-bg text-success'
      }`}
    >
      {cancelled ? t('queue_cancelled') : o(shopStageKey(status))}
    </p>
  );
}

function OrderLines({ order }: { order: ShopOrderDto }) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const locale = useLocale();
  const address = addressLines(order.address);
  return (
    <>
      <p className="font-heading text-lg font-extrabold text-ink">{order.code}</p>
      {/* The shop's own total (its prices), never the customer's price or a quote discount (review I1). */}
      <p className="text-xs text-muted">
        {t('orderMeta', {
          items: a('items', { count: order.items.length }),
          total: formatPrice(order.payoutPaise),
          pin: order.pincode,
        })}
      </p>
      {order.collectPaise === null ? null : (
        <p className="mt-1 text-xs font-bold text-ink">
          {t('api_shop_collect', { amount: formatPrice(order.collectPaise) })}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line text-sm">
        {order.items.map((l) => (
          <li key={l.sku} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 text-ink">{itemTitle(l, locale)}</span>
            <span className="shrink-0 font-bold text-ink tabular-nums">× {l.qty}</span>
          </li>
        ))}
      </ul>
      {address ? (
        <div className="mt-3 rounded-lg bg-pill p-3 text-sm">
          <p className="text-xs font-extrabold text-muted">{t('api_address')}</p>
          <p data-user-content className="text-ink">
            {address.name ? <span className="font-bold">{address.name}</span> : null}
            {address.phone ? (
              <>
                {' · '}
                <a
                  href={`tel:${address.phone}`}
                  className="font-bold text-accent-soft-text underline-offset-4 hover:underline"
                >
                  {address.phone}
                </a>
              </>
            ) : null}
          </p>
          <p data-user-content className="text-ink">
            {address.lines.join(', ')}
          </p>
        </div>
      ) : null}
    </>
  );
}

function OfferedOrder({ order, onChanged }: { order: ShopOrderDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const locale = useLocale();
  const now = useNow();
  const [declining, setDeclining] = useState(false);
  // No reason is chosen for the shop (QA 2026-11-14, U2; rule 16: a code nobody picked is bad data).
  const [reason, setReason] = useState<AssignmentDeclineReason | ''>('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = order.assignmentId;
  const minutes = minutesLeft(order.expiresAt, now);

  async function respond(accept: boolean) {
    if (!id) return;
    setBusy(true);
    const res = await adminApi(locale, `/shop/offers/${id}/${accept ? 'accept' : 'decline'}`, OrderChanged, {
      method: 'POST',
      ...(accept ? {} : { body: { reasonCode: reason } }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      await onChanged();
      return;
    }
    track('click', {
      id: accept ? 'shop_order_accepted' : 'shop_order_declined',
      path: window.location.pathname,
    });
    await onChanged();
  }

  return (
    <article className={`${portalCard} border-accent-button/50`} aria-busy={busy || undefined}>
      <p className="mb-2 inline-flex rounded-pill bg-warning-bg px-3 py-1 text-xs font-extrabold text-warning">
        <span aria-hidden="true">⏱️ </span>
        {t('expiresIn', { minutes })}
      </p>
      <OrderLines order={order} />
      {error ? (
        <div className="mt-3">
          <ApiError code={error} />
        </div>
      ) : null}
      {declining ? (
        <div className="mt-4 space-y-3">
          <label htmlFor={`reason-${order.code}`} className="text-sm font-bold text-ink">
            {t('declineReason')}
          </label>
          <select
            id={`reason-${order.code}`}
            value={reason}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `reason-${order.code}-error` : undefined}
            onChange={(e) => {
              setReason(ASSIGNMENT_DECLINE_REASONS.find((r) => r === e.target.value) ?? '');
              setMissing(false);
            }}
            className={portalField}
          >
            <option value="">{t('reasonChoose')}</option>
            {ASSIGNMENT_DECLINE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reason_${r}`)}
              </option>
            ))}
          </select>
          {missing ? (
            <p id={`reason-${order.code}-error`} className="text-xs font-bold text-error">
              {t('reasonRequired')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!reason) {
                  setMissing(true);
                  document.getElementById(`reason-${order.code}`)?.focus();
                  return;
                }
                void respond(false);
              }}
              className={portalPrimary}
            >
              {t('decline')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeclining(false);
              }}
              className={portalQuiet}
            >
              {a('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !id}
            onClick={() => void respond(true)}
            className={`${portalPrimary} min-h-12 flex-1`}
          >
            <span aria-hidden="true">✅ </span>
            {t('accept')}
          </button>
          <button
            type="button"
            disabled={busy || !id}
            onClick={() => {
              setDeclining(true);
            }}
            className={`${portalQuiet} min-h-12`}
          >
            {t('decline')}
          </button>
        </div>
      )}
    </article>
  );
}

function ActiveOrder({ order, onChanged }: { order: ShopOrderDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const o = useTranslations('order');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = nextShopAction(order.status);

  async function advance(steps: readonly ('packed' | 'shipped' | 'out_for_delivery')[]) {
    setBusy(true);
    let version = order.version;
    for (const step of steps) {
      const res = await adminApi(locale, `/shop/orders/${order.code}/advance`, OrderChanged, {
        method: 'POST',
        body: advanceBody(step, version),
      });
      if (!res.ok) {
        setBusy(false);
        setError(res.code);
        await onChanged();
        return;
      }
      version = res.data.version;
    }
    setBusy(false);
    setError(null);
    // The API records order_packed / order_shipped / order_out_for_delivery as server events (spec 12).
    await onChanged();
  }

  return (
    <article className={portalCard} aria-busy={busy || undefined}>
      <p className="mb-2 inline-flex rounded-pill bg-success-bg px-3 py-1 text-xs font-extrabold text-success">
        {o(shopStageKey(order.status))}
      </p>
      <OrderLines order={order} />
      {error ? (
        <div className="mt-3">
          <ApiError code={error} />
        </div>
      ) : null}
      {action?.kind === 'code' ? (
        <DeliveryCodeForm order={order} onChanged={onChanged} />
      ) : action ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void advance(action.steps)}
          className={`${portalPrimary} mt-4 w-full`}
        >
          {t(action.label)}
        </button>
      ) : null}
    </article>
  );
}

/**
 * Proof of delivery: the delivery person asks the customer for their 4-digit code and enters it here. Only the
 * right code marks the order delivered; 5 wrong codes lock it and support takes over (the API counts).
 */
function DeliveryCodeForm({ order, onChanged }: { order: ShopOrderDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputId = `delivery-code-${order.code}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) {
      setError(t('deliveryCodeFormat'));
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop/orders/${order.code}/deliver`, DeliveryCheck, {
      method: 'POST',
      body: { deliveryCode: code, version: order.version },
    });
    setBusy(false);
    setCode('');
    if (!res.ok) {
      setError(t(apiErrorKey(res.code) as 'api_err_generic'));
      if (res.code !== 'NETWORK') await onChanged();
      return;
    }
    if (res.data.ok) {
      track('click', { id: 'shop_delivery_confirmed', path: window.location.pathname });
      await onChanged();
      return;
    }
    track('click', { id: 'shop_delivery_code_wrong', path: window.location.pathname });
    if (res.data.reason === 'locked') {
      setLocked(true);
      return;
    }
    setError(t('deliveryCodeWrong', { left: res.data.attemptsLeft ?? 0 }));
  }

  if (locked) {
    return (
      <p role="alert" className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
        {t('deliveryCodeLocked')}
      </p>
    );
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4">
      <label htmlFor={inputId} className="text-sm font-bold text-ink">
        {t('deliveryCodeLabel')}
      </label>
      <p id={`${inputId}-hint`} className="text-xs text-muted">
        {t('deliveryCodeHint')}
      </p>
      <div className="mt-2 flex gap-2">
        <input
          id={inputId}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={code}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 4));
          }}
          className={`${portalField} mt-0 w-32 text-center font-heading text-xl font-extrabold tracking-[0.4em] tabular-nums`}
        />
        <button type="submit" disabled={busy} className={`${portalPrimary} flex-1`}>
          {t('deliveryConfirm')}
        </button>
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
