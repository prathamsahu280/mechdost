'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { findShop } from '@/demo/shops';
import { advanceOrder, ORDER_STAGES, useHydrated, useOrders } from '@/demo/store';
import { formatDate, formatPrice } from '@/lib/format';
import { StatusTimeline } from './status-timeline';

/** Order tracking (spec 04): timeline of the real flow — placed → admin routes → shop accepts → … → delivered. */
export function OrderView({ code }: { code: string }) {
  const t = useTranslations('order');
  const cartT = useTranslations('cart');
  const demo = useTranslations('demo');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const order = useOrders().find((o) => o.code === code);
  const hydrated = useHydrated();

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

  const steps = ORDER_STAGES.map((s) => ({ key: s, title: t(`stage_${s}`), detail: t(`detail_${s}`) }));

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_380px] nav:items-start">
      <div className="space-y-6">
        {isNew ? (
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
          {order.rejection ? (
            <div role="status" className="mt-5 rounded-tile bg-warning-bg p-5 text-warning">
              <p className="font-heading font-bold">{t('rejectedTitle')}</p>
              <p className="mt-1 text-sm">{order.rejection.message}</p>
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
          {order.shop?.status === 'accepted' ? (
            <p className="mt-4 text-sm font-bold text-ink">
              🏪 {t('shopLabel', { shop: findShop(order.shop.slug)?.name ?? order.shop.slug })}
            </p>
          ) : null}
          {!order.rejection && order.stage < ORDER_STAGES.length - 1 ? (
            <details className="mt-6 rounded-lg border border-dashed border-line p-3 text-sm">
              <summary className="cursor-pointer font-bold text-muted">{demo('controls')}</summary>
              <button
                type="button"
                onClick={() => {
                  advanceOrder(order.code);
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
                  {l.brand} {l.name} <span className="text-muted">× {l.qty}</span>
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
            <div className="flex justify-between text-base">
              <dt className="font-bold">{cartT('total')}</dt>
              <dd className="font-heading font-extrabold">{formatPrice(order.totalPaise)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h2 className="font-heading font-bold text-ink">{t('deliverTo')}</h2>
          <p className="mt-1 text-sm text-muted">
            {order.customer.name} · {order.customer.phone}
            <br />
            {order.customer.address} · {order.customer.pincode}
          </p>
        </div>
        <div>
          <h2 className="font-heading font-bold text-ink">{t('payment')}</h2>
          <p className="mt-1 text-sm text-muted">{t('cod')}</p>
        </div>
        <p className="text-xs text-muted">{t('help')}</p>
        <p className="text-[11px] text-muted">{demo('note')}</p>
      </aside>
    </div>
  );
}
