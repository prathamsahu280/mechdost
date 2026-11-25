'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { adminCard, StatusBadge } from './admin-ui';

/** Height shared by a tile and its loading placeholder, so the grid does not shift when the counts arrive. */
export const OVERVIEW_TILE_HEIGHT = 'min-h-32';

/**
 * One Overview stat tile (design 2026-11-25): the number first, its label, and the queue it counts as the link. A
 * tile with work waiting says so in words ("Needs attention") as well as with the accent border.
 */
export function OverviewTile({
  href,
  label,
  value,
  alert = false,
}: {
  href: string;
  label: string;
  /** Already formatted (count or money). */
  value: string;
  /** Work is waiting in this queue. */
  alert?: boolean;
}) {
  const t = useTranslations('portal');
  return (
    <Link
      href={href}
      className={`${adminCard} ${OVERVIEW_TILE_HEIGHT} press group flex h-full flex-col justify-between gap-2 hover:shadow-card-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
        alert ? 'border-accent-button' : ''
      }`}
    >
      <span className="order-2 block text-sm leading-snug text-ink [overflow-wrap:anywhere]">{label}</span>
      <span className="order-1 flex items-start justify-between gap-2">
        <span className="font-heading text-3xl leading-none font-extrabold text-ink tabular-nums">
          {value}
        </span>
        {alert ? <StatusBadge tone="warning">{t('kpi_needsAttention')}</StatusBadge> : null}
      </span>
      <span className="order-3 flex items-center gap-1 text-xs font-bold text-accent-soft-text">
        {t('kpi_view')}
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
