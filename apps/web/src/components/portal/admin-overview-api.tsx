'use client';

import {
  Handshake,
  Headset,
  Hourglass,
  IndianRupee,
  RotateCcw,
  Route,
  ShieldAlert,
  ShoppingBag,
  Star,
  Tag,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview } from '@mechdost/shared/admin-analytics-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { formatCount } from '@/lib/admin-analytics-view';
import { formatPrice } from '@/lib/format';
import { startPolling } from '@/lib/storefront-poll';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/sections';
import { PushPromptSlot } from '../notices/push-prompt-slot';
import { OVERVIEW_TILE_HEIGHT, OverviewTile, type TileTone } from './admin-overview-tile';
import { portalPrimary } from './portal-styles';
import { adminCard } from './admin-ui';

interface Tile {
  label: string;
  value: number | null;
  money?: boolean;
  href: AdminSection;
  /** What the number means when it is above zero (a queue with nothing in it is neutral). */
  tone: TileTone;
  icon: LucideIcon;
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

  const load = useCallback(async (): Promise<boolean> => {
    const { fetchAdminOverview } = await import('@/lib/admin-analytics-api');
    const res = await fetchAdminOverview(locale);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return false;
    }
    setError(null);
    setData(res.data);
    return true;
  }, [locale]);

  // The counts refresh while the tab is visible and when it is shown again (QA pass 4, bug 8: a price request that
  // arrived after the page opened showed 0 until a reload).
  useEffect(() => {
    void load();
    return startPolling(load);
  }, [load]);

  const all: Tile[] = data
    ? [
        {
          label: t('kpi_needsRouting'),
          value: data.ordersNeedRouting,
          href: 'orders',
          tone: 'warning',
          icon: Route,
        },
        {
          label: t('kpi_awaitingShop'),
          value: data.ordersAwaitingShop,
          href: 'orders',
          tone: 'warning',
          icon: Hourglass,
        },
        {
          label: t('analytics_api_inProgress'),
          value: data.ordersInProgress,
          href: 'orders',
          tone: 'info',
          icon: Truck,
        },
        {
          label: t('analytics_api_servicesToRoute'),
          value: data.servicesNeedRouting,
          href: 'services',
          tone: 'warning',
          icon: Wrench,
        },
        { label: t('kpi_support'), value: data.ticketsOpen, href: 'support', tone: 'warning', icon: Headset },
        { label: t('kpi_reviews'), value: data.reviewsPending, href: 'reviews', tone: 'info', icon: Star },
        {
          label: t('kpi_applications'),
          value: data.applicationsPending,
          href: 'applications',
          tone: 'info',
          icon: Handshake,
        },
        {
          label: t('kpi_priceRequests'),
          value: data.priceRequestsPending,
          href: 'partners',
          tone: 'warning',
          icon: Tag,
        },
        {
          label: t('kpi_refundsWaiting'),
          value: data.refundsWaiting,
          href: 'refunds',
          tone: 'danger',
          icon: RotateCcw,
        },
        {
          label: t('kpi_refundsChecking'),
          value: data.refundsNeedChecking,
          href: 'refunds',
          tone: 'danger',
          icon: ShieldAlert,
        },
        {
          label: t('analytics_api_today_orders'),
          value: data.ordersToday,
          href: 'analytics',
          tone: 'info',
          icon: ShoppingBag,
        },
        {
          label: t('analytics_api_today_value'),
          value: data.gmvTodayPaise,
          money: true,
          href: 'analytics',
          tone: 'success',
          icon: IndianRupee,
        },
      ]
    : [];
  const tiles = all.filter((tile) => tile.value !== null && ADMIN_SECTIONS.includes(tile.href));

  return (
    <>
      <PushPromptSlot />
      <section aria-labelledby="admin-page-title" className="space-y-3">
        {error ? (
          <div role="alert" className={`${adminCard} space-y-3`}>
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
          <div role="status" className="grid grid-cols-2 gap-3 tab:grid-cols-3 xl:grid-cols-4">
            <span className="sr-only">{t('api_common_loading')}</span>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={`skeleton rounded-card ${OVERVIEW_TILE_HEIGHT}`} aria-hidden="true" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 tab:grid-cols-3 xl:grid-cols-4">
            {tiles.map((tile) => (
              <li key={tile.label}>
                <OverviewTile
                  href={`${prefix}/admin/${tile.href}`}
                  label={tile.label}
                  value={tile.money ? formatPrice(tile.value ?? 0) : formatCount(tile.value ?? 0, locale)}
                  tone={tile.value ? tile.tone : 'neutral'}
                  icon={tile.icon}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
