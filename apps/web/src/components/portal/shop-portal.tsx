'use client';

import { ASSIGNMENT_DECLINE_REASONS, type AssignmentDeclineReason } from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { localizeShop, productNameFor } from '@/demo/i18n/localize';
import { findShop } from '@/demo/shops';
import {
  DELIVERY_CODE_MAX_ATTEMPTS,
  ORDER_STAGES,
  confirmDeliveryWithCode,
  respondToOrder,
  isClosed,
  routingState,
  shopAdvanceOrder,
  useOrders,
  type DemoOrder,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { ShopAgreement } from './agreement-cards';
import { PartnerGate } from './partner-gate';
import { ShopPrices } from './shop-prices';
import { PortalGuard, portalCard, portalPrimary, portalQuiet, portalField, useNow } from './portal-guard';
import { GstInvoiceLine } from '@/components/commerce/gst-invoice-line';

/**
 * Shop portal (spec 07): orders MechDost routed to this shop with an accept timer, then pack → deliver.
 * Big tap targets — shop owners use phones.
 */
export function ShopPortal() {
  return (
    <PortalGuard role="shop" path="/partner/shop">
      {(account) => (
        <PartnerGate kind="shop" slug={account.partner ?? ''}>
          <ShopOrders shopSlug={account.partner ?? ''} />
        </PartnerGate>
      )}
    </PortalGuard>
  );
}

function ShopOrders({ shopSlug }: { shopSlug: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const now = useNow();
  const found = findShop(shopSlug);
  const shop = found ? localizeShop(found, locale) : undefined;
  const orders = useOrders().filter((o) => o.shop?.slug === shopSlug);
  const offered = orders.filter((o) => routingState(o, now) === 'awaiting_shop');
  const active = orders.filter(
    (o) => o.shop?.status === 'accepted' && !isClosed(o) && o.stage < ORDER_STAGES.length - 1,
  );

  return (
    <>
      {shop ? (
        <section className="blueprint rounded-card p-6 text-white shadow-card">
          <h2 className="font-heading text-2xl font-extrabold">🏪 {shop.name}</h2>
          <p className="mt-1 text-sm text-white/80">
            {shop.area} · {shop.pincode}
          </p>
          <p className="mt-3 text-sm font-bold">
            {t('shopStats', {
              rate: shop.acceptance,
              minutes: shop.acceptMinutes,
              rating: shop.rating.toFixed(1),
            })}
          </p>
        </section>
      ) : null}

      <ShopAgreement shopSlug={shopSlug} />

      <section aria-labelledby="offered-title">
        <h2 id="offered-title" className="font-heading text-xl font-extrabold text-ink">
          {t('offered')} <span className="text-muted tabular-nums">({offered.length})</span>
        </h2>
        {offered.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('noneOffered')}</p>
        ) : (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {offered.map((o) => (
              <li key={o.code}>
                <OfferedOrder order={o} shopSlug={shopSlug} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="active-title">
        <h2 id="active-title" className="font-heading text-xl font-extrabold text-ink">
          {t('active')}
        </h2>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('noneActive')}</p>
        ) : (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {active.map((o) => (
              <li key={o.code}>
                <ActiveOrder order={o} shopSlug={shopSlug} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {found ? <ShopPrices shop={found} /> : null}
    </>
  );
}

/**
 * `showBusiness`: the buyer's GSTIN and business name are customer details, shared with the shop only once it has
 * accepted the order (as in `repo/shop-orders.ts`; final review 2026-11-13).
 */
function OrderLines({ order, showBusiness = false }: { order: DemoOrder; showBusiness?: boolean }) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const locale = useLocale();
  return (
    <>
      <p className="font-heading text-lg font-extrabold text-ink">{order.code}</p>
      <p className="text-xs text-muted">
        {formatDate(order.createdAt, locale)} ·{' '}
        {t('orderMeta', {
          items: a('items', { count: order.lines.length }),
          total: formatPrice(order.totalPaise),
          pin: order.customer.pincode,
        })}
      </p>
      {showBusiness ? (
        <GstInvoiceLine business={order.business} className="mt-1 text-xs font-bold text-ink" />
      ) : null}
      <ul className="mt-3 divide-y divide-line text-sm">
        {order.lines.map((l) => (
          <li key={l.slug} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 text-ink">
              <span className="font-bold">{l.brand}</span> {productNameFor(l.slug, l.name, locale)}
            </span>
            <span className="shrink-0 font-bold text-ink tabular-nums">× {l.qty}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function OfferedOrder({ order, shopSlug, now }: { order: DemoOrder; shopSlug: string; now: number }) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<AssignmentDeclineReason>('out_of_stock');
  const minutes = Math.max(
    0,
    Math.ceil(((order.shop ? new Date(order.shop.expiresAt).getTime() : now) - now) / 60_000),
  );

  return (
    <article className={`${portalCard} border-accent-button/50`}>
      <p className="mb-2 inline-flex rounded-pill bg-warning-bg px-3 py-1 text-xs font-extrabold text-warning">
        <span aria-hidden="true">⏱️ </span>
        {t('expiresIn', { minutes })}
      </p>
      <OrderLines order={order} />
      {declining ? (
        <div className="mt-4 space-y-3">
          <label htmlFor={`reason-${order.code}`} className="text-sm font-bold text-ink">
            {t('declineReason')}
          </label>
          <select
            id={`reason-${order.code}`}
            value={reason}
            onChange={(e) => {
              setReason(ASSIGNMENT_DECLINE_REASONS.find((r) => r === e.target.value) ?? 'out_of_stock');
            }}
            className={portalField}
          >
            {ASSIGNMENT_DECLINE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reason_${r}`)}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                respondToOrder(order.code, shopSlug, false, reason);
                track('click', { id: 'shop_order_declined', path: window.location.pathname });
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
            onClick={() => {
              respondToOrder(order.code, shopSlug, true);
              track('click', { id: 'shop_order_accepted', path: window.location.pathname });
            }}
            className={`${portalPrimary} min-h-12 flex-1`}
          >
            <span aria-hidden="true">✅ </span>
            {t('accept')}
          </button>
          <button
            type="button"
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

function ActiveOrder({ order, shopSlug }: { order: DemoOrder; shopSlug: string }) {
  const t = useTranslations('portal');
  const o = useTranslations('order');
  const stage = ORDER_STAGES[order.stage] ?? 'confirmed';
  return (
    <article className={portalCard}>
      <p className="mb-2 inline-flex rounded-pill bg-success-bg px-3 py-1 text-xs font-extrabold text-success">
        {o(`stage_${stage}`)}
      </p>
      <OrderLines order={order} showBusiness />
      {stage === 'shipped' ? (
        <DeliveryCodeForm order={order} shopSlug={shopSlug} />
      ) : (
        <button
          type="button"
          onClick={() => {
            shopAdvanceOrder(order.code, shopSlug);
          }}
          className={`${portalPrimary} mt-4 w-full`}
        >
          {stage === 'confirmed' ? t('markPacked') : t('markShipped')}
        </button>
      )}
    </article>
  );
}

/**
 * Proof of delivery: the delivery person asks the customer for their 4-digit code and enters it here. Only the
 * right code marks the order delivered; 5 wrong codes lock it and support takes over.
 */
function DeliveryCodeForm({ order, shopSlug }: { order: DemoOrder; shopSlug: string }) {
  const t = useTranslations('portal');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locked = (order.delivery?.attempts ?? 0) >= DELIVERY_CODE_MAX_ATTEMPTS;
  const inputId = `delivery-code-${order.code}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) {
      setError(t('deliveryCodeFormat'));
      return;
    }
    const result = confirmDeliveryWithCode(order.code, shopSlug, code);
    if (result.ok) {
      track('click', { id: 'shop_delivery_confirmed', path: window.location.pathname });
      return;
    }
    track('click', { id: 'shop_delivery_code_wrong', path: window.location.pathname });
    setCode('');
    setError(
      result.reason === 'wrong'
        ? t('deliveryCodeWrong', { left: result.attemptsLeft })
        : result.reason === 'locked'
          ? t('deliveryCodeLocked')
          : t('deliveryCodeNotOut'),
    );
  }

  if (locked) {
    return (
      <p role="alert" className="mt-4 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
        {t('deliveryCodeLocked')}
      </p>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4">
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
        <button type="submit" className={`${portalPrimary} flex-1`}>
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
