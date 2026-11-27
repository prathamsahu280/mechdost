'use client';

import { ShopOrderList, OrderChanged, DeliveryCheck, type ShopOrderDto } from '@mechdost/shared/order-views';
import {
  ASSIGNMENT_DECLINE_REASONS,
  ASSIGNMENT_GIVE_UP_REASONS,
  type AssignmentDeclineReason,
} from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { deadlineView, istDayTime } from '@/lib/admin-shop-form';
import { track } from '@/lib/analytics';
import { DELIVERY_CODE_LENGTH } from '@/lib/auth/auto-submit-code';
import { useAutoSubmitCode } from '@/lib/auth/use-auto-submit-code';
import { formatPrice } from '@/lib/format';
import {
  addressLines,
  advanceBody,
  apiErrorKey,
  itemTitle,
  nextShopAction,
  shopStageKey,
} from '@/lib/order-views';
import { ApiError, ApiListState, LoadMore } from './api-list-state';
import { useNow } from './use-now';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { offerLeftParams } from '@/lib/offer-time';
import { liveOffers, stepFlashKey } from '@/lib/shop-tier1';
import { DeliveryLocked, EmptyWithAction } from './shop-empty';
import { FlashNote, useFlash, type Flash } from './shop-flash';
import { GiveUpOrder } from './shop-give-up';
import { ShopPricesApi } from './shop-prices-api';
import { ShopAgreementApi } from './shop-onboarding-api';
import { ShopNewProductApi, ShopProfileApi } from './shop-profile-api';
import { ShopWarningsApi } from './shop-warnings-api';
import { PushPromptSlot } from '../notices/push-prompt-slot';
import { useNoticeRefresh } from '../notices/use-notice-refresh';
import { useApiList } from './use-api-list';
import { ShopDeliveryPanel } from '../delivery/shop-delivery';
import { shopAgentHandover } from '@/lib/delivery/view';

const OFFER_POLL_MS = 30_000;

/**
 * Shop portal on the API (spec 07, real sign-in only; loaded by `shop-portal.tsx` with a dynamic import so demo
 * builds do not carry it): offers with their accept timer (polled every 30 s), orders in progress with one next
 * step each, delivery with the customer's code, recent delivered/cancelled orders and "Your prices". The API scopes
 * everything to the shops in the signed-in person's grants.
 */
export function ShopOrdersApi() {
  const t = useTranslations('portal');
  const tt = useTranslations('shopTier1');
  const locale = useLocale();
  const now = useNow();
  const { flash, show } = useFlash();
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
  // A new order (or its "about to expire" reminder) reaches the bell within seconds: show it without the 30 s wait.
  useNoticeRefresh(['shop.order_routed', 'shop.offer_expiring'], offers.reload);
  // An offer leaves the list at its end time, not at the next poll (assessment 2026-11-15, item 2).
  const openOffers = liveOffers(offers.items, now);

  return (
    <>
      <PushPromptSlot />

      <FlashNote flash={flash} sticky />

      <ShopProfileApi />

      <ShopAgreementApi />

      <section aria-labelledby="offered-title">
        <h2 id="offered-title" className="font-heading text-xl font-extrabold text-ink">
          {t('offered')}{' '}
          {offers.loading ? null : <span className="text-muted tabular-nums">({openOffers.length})</span>}
        </h2>
        <ApiListState
          loading={offers.loading}
          error={offers.error}
          count={openOffers.length}
          empty={
            <EmptyWithAction
              text={tt('emptyOffers')}
              actionLabel={tt('emptyOffersAction')}
              href="#prices-title"
            />
          }
          onRetry={() => void offers.reload()}
        />
        {openOffers.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {openOffers.map((o) => (
              <li key={o.assignmentId ?? o.code}>
                <OfferedOrder order={o} onChanged={refresh} onFlash={show} />
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
          empty={
            <EmptyWithAction
              text={tt('emptyActive')}
              actionLabel={tt('emptyActiveAction')}
              href="#offered-title"
            />
          }
          onRetry={() => void active.reload()}
        />
        {active.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {active.items.map((o) => (
              <li key={o.code} className="flex">
                <ActiveOrder order={o} onChanged={refresh} onFlash={show} />
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
          empty={
            <EmptyWithAction
              text={tt('emptyDone')}
              actionLabel={tt('emptyDoneAction')}
              href="#new-product-title"
            />
          }
          onRetry={() => void done.reload()}
        />
        {done.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {done.items.map((o) => (
              <li key={`${o.code}-${o.status}`} className={portalCard}>
                <StatusPill status={o.status} />
                <OrderLines order={o} />
                <GivenUpWhy reason={o.givenUpReason} />
              </li>
            ))}
          </ul>
        ) : null}
        <LoadMore show={Boolean(done.next)} onClick={() => void done.loadMore()} />
      </section>

      <ShopWarningsApi />

      <ShopPricesApi />

      <ShopNewProductApi />
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('portal');
  const o = useTranslations('order');
  const g = useTranslations('shopGiveUp');
  const muted = status === 'cancelled' || status === 'given_up';
  return (
    <p
      className={`mb-2 inline-flex rounded-pill px-3 py-1 text-xs font-extrabold ${
        muted ? 'bg-pill text-muted' : 'bg-success-bg text-success'
      }`}
    >
      {status === 'given_up'
        ? g('givenUp')
        : status === 'cancelled'
          ? t('queue_cancelled')
          : o(shopStageKey(status))}
    </p>
  );
}

/** History row of an order this shop gave back: the reason code it chose, in the shop's language. */
function GivenUpWhy({ reason }: { reason: string | null | undefined }) {
  const g = useTranslations('shopGiveUp');
  const code = ASSIGNMENT_GIVE_UP_REASONS.find((r) => r === reason);
  if (!code) return null;
  return (
    <p className="mt-2 text-xs font-bold text-muted">{g('givenUpWhy', { reason: g(`reason_${code}`) })}</p>
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
        {/* A given-up order carries no prices: its lines may now hold another shop's price (security review). */}
        {order.payoutPaise === null
          ? t('orderMetaNoTotal', { items: a('items', { count: order.items.length }), pin: order.pincode })
          : t('orderMeta', {
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
      {/* MechDost Coins (spec 20): the customer paid less by this much; MechDost pays it, the payout is unchanged. */}
      {order.coinDiscountPaise ? (
        <p className="mt-1 text-xs text-ink">
          {t('coins_api_shop_discount', { amount: formatPrice(order.coinDiscountPaise) })}
        </p>
      ) : null}
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

function OfferedOrder({
  order,
  onChanged,
  onFlash,
}: {
  order: ShopOrderDto;
  onChanged: () => Promise<void>;
  onFlash: (f: Flash) => void;
}) {
  const t = useTranslations('portal');
  const tt = useTranslations('shopTier1');
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
  // An offer made while the shop was closed waits for its opening time (+ grace): show the time, not hours of minutes.
  const deadline = deadlineView(order.expiresAt, now);

  async function respond(accept: boolean) {
    if (!id) return;
    setBusy(true);
    const res = await adminApi(locale, `/shop/offers/${id}/${accept ? 'accept' : 'decline'}`, OrderChanged, {
      method: 'POST',
      ...(accept ? {} : { body: { reasonCode: reason } }),
    });
    setBusy(false);
    if (!res.ok) {
      // Answered after the timer: say so plainly (the card is about to leave the list, so the note lives above it).
      if (res.code === 'OFFER_EXPIRED') onFlash({ tone: 'warn', text: tt('offerExpired') });
      else setError(res.code);
      await onChanged();
      return;
    }
    track('click', {
      id: accept ? 'shop_order_accepted' : 'shop_order_declined',
      path: window.location.pathname,
    });
    onFlash({
      tone: 'ok',
      text: accept ? tt('flashAccepted', { code: order.code }) : tt('flashDeclined'),
    });
    await onChanged();
  }

  return (
    <article className={`${portalCard} border-accent-button/50`} aria-busy={busy || undefined}>
      <p className="mb-2 inline-flex rounded-pill bg-warning-bg px-3 py-1 text-xs font-extrabold text-warning">
        <span aria-hidden="true">⏱️ </span>
        {deadline.kind === 'minutes'
          ? t('expiresIn', offerLeftParams(deadline.minutes))
          : t('shops_api_waitsUntil', { time: istDayTime(deadline.at, locale) })}
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
              data-panel-cancel={`decline-${order.code}`}
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
            data-disclosure-trigger={`decline-${order.code}`}
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

function ActiveOrder({
  order,
  onChanged,
  onFlash,
}: {
  order: ShopOrderDto;
  onChanged: () => Promise<void>;
  onFlash: (f: Flash) => void;
}) {
  const t = useTranslations('portal');
  const tt = useTranslations('shopTier1');
  const t2 = useTranslations('shopTier2');
  const o = useTranslations('order');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = nextShopAction(order.status);
  // Agent-delivered sub-order (spec 24): from packed on, the agent hand-over replaces the shop's own delivery steps,
  // keyed on the delivery mode (no job yet at packed: DC-P9).
  const delivery = shopAgentHandover(order);

  // A ref, not only state: two presses in the same frame both see `busy === false` (QA 2026-11-16, bug 12).
  // "Out for delivery" from "packed" is one request (`handOver`: the API does hand-over + out for delivery; pass 4).
  const busyRef = useRef(false);

  async function advance(steps: readonly ('packed' | 'shipped' | 'out_for_delivery')[], handOver = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let version = order.version;
    for (const step of steps) {
      const res = await adminApi(locale, `/shop/orders/${order.code}/advance`, OrderChanged, {
        method: 'POST',
        body: advanceBody(step, version, handOver),
      });
      if (!res.ok) {
        busyRef.current = false;
        setBusy(false);
        setError(res.code);
        await onChanged();
        return;
      }
      version = res.data.version;
    }
    busyRef.current = false;
    setBusy(false);
    setError(null);
    const last = steps.at(-1);
    if (last) onFlash({ tone: 'ok', text: tt(stepFlashKey(last), { code: order.code }) });
    // The API records order_packed / order_shipped / order_out_for_delivery as server events (spec 12).
    await onChanged();
  }

  return (
    <article className={`${portalCard} flex w-full flex-col`} aria-busy={busy || undefined}>
      <p className="mb-2 inline-flex w-fit rounded-pill bg-success-bg px-3 py-1 text-xs font-extrabold text-success">
        {o(shopStageKey(order.status))}
      </p>
      <OrderLines order={order} />
      <a
        href={`${locale === 'hi' ? '/hi' : ''}/partner/shop/slip/${order.code}`}
        target="_blank"
        rel="noopener"
        onClick={() => {
          track('click', { id: 'shop_slip_open', path: window.location.pathname });
        }}
        className={`${portalQuiet} mt-3`}
      >
        {t2('slipOpen')}
      </a>
      {/* The actions sit at the card's foot, so cards side by side line their buttons up (audit 2026-11-16). */}
      <div className="mt-auto">
        {error ? (
          <div className="mt-3">
            <ApiError code={error} />
          </div>
        ) : null}
        {delivery ? (
          <ShopDeliveryPanel
            orderCode={order.code}
            orderVersion={order.version}
            delivery={delivery}
            shopSlug=""
            onChanged={() => void onChanged()}
          />
        ) : action?.kind === 'code' ? (
          <DeliveryCodeForm order={order} onChanged={onChanged} onFlash={onFlash} />
        ) : action ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void advance(action.steps, action.handOver === true)}
            className={`${portalPrimary} mt-4 w-full`}
          >
            {t(action.label)}
          </button>
        ) : null}
        {/* Before packing only: the shop can still hand the order back to MechDost (spec 04). */}
        {order.status === 'confirmed' ? <GiveUpOrder order={order} onChanged={onChanged} /> : null}
      </div>
    </article>
  );
}

/**
 * Proof of delivery: the delivery person asks the customer for their 4-digit code and enters it here. Only the
 * right code marks the order delivered; 5 wrong codes lock it and support takes over (the API counts).
 */
function DeliveryCodeForm({
  order,
  onChanged,
  onFlash,
}: {
  order: ShopOrderDto;
  onChanged: () => Promise<void>;
  onFlash: (f: Flash) => void;
}) {
  const t = useTranslations('portal');
  const tt = useTranslations('shopTier1');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  // The lock is server state (5 wrong codes): it shows again after a reload, not only on the page that saw it.
  const [locked, setLocked] = useState(order.deliveryLocked === true);
  const [busy, setBusy] = useState(false);
  const inputId = `delivery-code-${order.code}`;
  // Checked by itself at 4 digits (user, 2026-11-25); the button stays as the fallback. A wrong code stays selected.
  const {
    value: code,
    checking,
    inputProps,
    claimManual,
  } = useAutoSubmitCode({
    length: DELIVERY_CODE_LENGTH,
    autoComplete: 'off',
    busy,
    submit: (value, auto) => check(value, auto),
  });

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!claimManual()) return;
    void check(code, false);
  }

  async function check(value: string, auto: boolean) {
    if (busy) return;
    if (!/^\d{4}$/.test(value)) {
      setError(t('deliveryCodeFormat'));
      return;
    }
    track('code_submitted', { kind: 'delivery', auto, path: window.location.pathname });
    setBusy(true);
    const res = await adminApi(locale, `/shop/orders/${order.code}/deliver`, DeliveryCheck, {
      method: 'POST',
      body: { deliveryCode: value, version: order.version },
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(apiErrorKey(res.code) as 'api_err_generic'));
      if (res.code !== 'NETWORK') await onChanged();
      return;
    }
    if (res.data.ok) {
      track('click', { id: 'shop_delivery_confirmed', path: window.location.pathname });
      onFlash({ tone: 'ok', text: tt('flashDelivered', { code: order.code }) });
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

  if (locked) return <DeliveryLocked />;

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4">
      <label htmlFor={inputId} className="text-sm font-bold text-ink">
        {t('deliveryCodeLabel')}
      </label>
      <p id={`${inputId}-hint`} className="text-xs text-muted">
        {t('deliveryCodeHint')}
      </p>
      <p role="status" className="sr-only">
        {checking ? t('deliveryCodeChecking') : ''}
      </p>
      <div className="mt-2 flex flex-col gap-2 min-[420px]:flex-row">
        <input
          id={inputId}
          {...inputProps}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          className={`${portalField} mt-0 w-full min-[420px]:w-32 text-center font-heading text-xl font-extrabold tracking-[0.4em] tabular-nums`}
        />
        <button
          type="submit"
          disabled={busy}
          className={`${portalPrimary} min-h-11 w-full min-[420px]:w-auto min-[420px]:flex-1`}
        >
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
