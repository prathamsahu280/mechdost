'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { findShop } from '@/demo/shops';
import {
  ORDER_STAGES,
  respondToOrder,
  routingState,
  shopAdvanceOrder,
  useOrders,
  type DemoOrder,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { PortalGuard, portalCard, portalPrimary, portalQuiet, portalField, useNow } from './portal-guard';

const DECLINE_REASONS = ['stock', 'area', 'busy'] as const;

/**
 * Shop portal (spec 07): orders MechDost routed to this shop with an accept timer, then pack → deliver.
 * Big tap targets — shop owners use phones.
 */
export function ShopPortal() {
  return (
    <PortalGuard role="shop" path="/partner/shop">
      {(account) => <ShopOrders shopSlug={account.partner ?? ''} />}
    </PortalGuard>
  );
}

function ShopOrders({ shopSlug }: { shopSlug: string }) {
  const t = useTranslations('portal');
  const now = useNow();
  const shop = findShop(shopSlug);
  const orders = useOrders().filter((o) => o.shop?.slug === shopSlug);
  const offered = orders.filter((o) => routingState(o, now) === 'awaiting_shop');
  const active = orders.filter((o) => o.shop?.status === 'accepted' && o.stage < ORDER_STAGES.length - 1);

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
    </>
  );
}

function OrderLines({ order }: { order: DemoOrder }) {
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
      <ul className="mt-3 divide-y divide-line text-sm">
        {order.lines.map((l) => (
          <li key={l.slug} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 text-ink">
              <span className="font-bold">{l.brand}</span> {l.name}
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
  const [reason, setReason] = useState<(typeof DECLINE_REASONS)[number]>('stock');
  const minutes = Math.max(
    0,
    Math.ceil(((order.shop ? new Date(order.shop.expiresAt).getTime() : now) - now) / 60_000),
  );

  return (
    <article className={`${portalCard} border-accent-button/50`}>
      <p className="mb-2 inline-flex rounded-pill bg-warning-bg px-3 py-1 text-xs font-extrabold text-warning">
        ⏱️ {t('expiresIn', { minutes })}
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
              setReason(DECLINE_REASONS.find((r) => r === e.target.value) ?? 'stock');
            }}
            className={portalField}
          >
            {DECLINE_REASONS.map((r) => (
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
            ✅ {t('accept')}
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
  const next =
    stage === 'confirmed' ? t('markPacked') : stage === 'packed' ? t('markShipped') : t('markDelivered');
  return (
    <article className={portalCard}>
      <p className="mb-2 inline-flex rounded-pill bg-success-bg px-3 py-1 text-xs font-extrabold text-success">
        {o(`stage_${stage}`)}
      </p>
      <OrderLines order={order} />
      <button
        type="button"
        onClick={() => {
          shopAdvanceOrder(order.code, shopSlug);
        }}
        className={`${portalPrimary} mt-4 w-full`}
      >
        {next}
      </button>
    </article>
  );
}
