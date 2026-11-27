'use client';

import { Bell, PackageCheck, PackageOpen, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { KpiTile } from '@/components/partner';
import type { ShopTodayCounts } from '@/lib/shop-today';

/**
 * Shop "Today" number tiles (design 2026-11-27 § 5.2): New (amber, "Needs you") · Packing (blue) · Out for delivery or
 * Ready for pickup (agent shops) · Delivered (green). Each tile jumps to its list. While offers are open the tiles
 * shrink to one row of count chips so the offer card stays high on a phone.
 */
export function ShopTodayTiles({
  counts,
  loading,
  agentMode,
}: {
  counts: ShopTodayCounts;
  loading: boolean;
  agentMode: boolean;
}) {
  const t = useTranslations('partnerShop');
  const compact = !loading && counts.newOrders !== '0';
  const v = (s: string) => (loading ? null : s);
  return (
    <nav aria-label={t('tiles_label')}>
      <ul className={compact ? 'grid grid-cols-4 gap-2' : 'grid grid-cols-2 gap-3 tab:grid-cols-4'}>
        <li>
          <KpiTile
            portal="shop"
            id="new"
            href="/partner/shop#offered-title"
            value={v(counts.newOrders)}
            label={t('kpi_new')}
            tone="waiting"
            icon={<Bell />}
            needsYou
            compact={compact}
          />
        </li>
        <li>
          <KpiTile
            portal="shop"
            id="packing"
            href="/partner/shop#active-title"
            value={v(counts.packing)}
            label={t('kpi_packing')}
            tone="progress"
            icon={<PackageOpen />}
            compact={compact}
          />
        </li>
        <li>
          {agentMode ? (
            <KpiTile
              portal="shop"
              id="ready"
              href="/partner/shop#active-title"
              value={v(counts.readyForPickup)}
              label={t('kpi_ready')}
              tone="waiting"
              icon={<PackageCheck />}
              compact={compact}
            />
          ) : (
            <KpiTile
              portal="shop"
              id="out"
              href="/partner/shop#active-title"
              value={v(counts.out)}
              label={t('kpi_out')}
              tone="progress"
              icon={<Truck />}
              compact={compact}
            />
          )}
        </li>
        <li>
          <KpiTile
            portal="shop"
            id="delivered"
            href="/partner/shop#delivered-title"
            value={v(counts.delivered)}
            label={t('kpi_delivered')}
            tone="done"
            icon={<PackageCheck />}
            compact={compact}
          />
        </li>
      </ul>
    </nav>
  );
}
