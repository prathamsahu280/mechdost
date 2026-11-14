'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview } from '@mechdost/shared/admin-analytics-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { formatCount } from '@/lib/admin-analytics-view';
import { formatPrice } from '@/lib/format';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/sections';
import { portalCard, portalPrimary } from './portal-guard';

interface Tile {
  label: string;
  value: number | null;
  money?: boolean;
  href: AdminSection;
  alert?: boolean;
}

/**
 * Admin → Overview on the API (real sign-in builds; the demo store's Overview is not used there). Live work-queue
 * counts from `GET /v1/admin/overview` in the staff member's cities; a queue the staff member cannot read is left
 * out (the API sends null). Today's orders and value appear with `analytics:read`, linking to Analytics.
 */
export function AdminOverviewApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);

  const load = useCallback(async () => {
    const { fetchAdminOverview } = await import('@/lib/admin-analytics-api');
    const res = await fetchAdminOverview(locale);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setData(res.data);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const all: Tile[] = data
    ? [
        { label: t('kpi_needsRouting'), value: data.ordersNeedRouting, href: 'orders', alert: true },
        { label: t('kpi_awaitingShop'), value: data.ordersAwaitingShop, href: 'orders' },
        { label: t('analytics_api_inProgress'), value: data.ordersInProgress, href: 'orders' },
        {
          label: t('analytics_api_servicesToRoute'),
          value: data.servicesNeedRouting,
          href: 'services',
          alert: true,
        },
        { label: t('kpi_support'), value: data.ticketsOpen, href: 'support', alert: true },
        { label: t('kpi_reviews'), value: data.reviewsPending, href: 'reviews' },
        { label: t('kpi_applications'), value: data.applicationsPending, href: 'applications' },
        { label: t('kpi_priceRequests'), value: data.priceRequestsPending, href: 'partners', alert: true },
        { label: t('analytics_api_today_orders'), value: data.ordersToday, href: 'analytics' },
        { label: t('analytics_api_today_value'), value: data.gmvTodayPaise, money: true, href: 'analytics' },
      ]
    : [];
  const tiles = all.filter((tile) => tile.value !== null && ADMIN_SECTIONS.includes(tile.href));

  return (
    <section aria-labelledby="kpis" className="space-y-3">
      <h2 id="kpis" className="font-heading text-xl font-extrabold text-ink">
        {t('nav_overview')}
      </h2>
      {error ? (
        <div role="alert" className={`${portalCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{t(error)}</p>
          <button
            type="button"
            className={portalPrimary}
            onClick={() => {
              void load();
            }}
          >
            {t('api_common_retry')}
          </button>
        </div>
      ) : data === null ? (
        <div role="status" className="grid grid-cols-2 gap-3 tab:grid-cols-4">
          <span className="sr-only">{t('api_common_loading')}</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-24 rounded-card" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 tab:grid-cols-4">
          {tiles.map((tile) => (
            <li key={tile.label}>
              <Link
                href={`${prefix}/admin/${tile.href}`}
                className={`${portalCard} press block p-4 hover:shadow-card-hover ${
                  tile.alert && tile.value ? 'border-accent-button' : ''
                }`}
              >
                <span className="block font-heading text-3xl font-extrabold text-ink tabular-nums">
                  {tile.money ? formatPrice(tile.value ?? 0) : formatCount(tile.value ?? 0, locale)}
                </span>
                <span className="mt-1 block text-sm text-muted">{tile.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
