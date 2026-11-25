'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { adminCard } from './admin-ui';

/** Height shared by a tile and its loading placeholder, so the grid does not shift when the counts arrive. */
export const OVERVIEW_TILE_HEIGHT = 'min-h-32';

/** What the number means (decision 2026-11-25 "Admin data colour"); `neutral` is a queue with nothing waiting. */
export type TileTone = 'warning' | 'danger' | 'info' | 'success' | 'neutral';

/** Soft background, strong number and a coloured icon chip per tone; every pair is in the tokens test. */
const TONE: Record<TileTone, { card: string; number: string; chip: string }> = {
  warning: {
    card: 'bg-warning-bg border-warning-line',
    number: 'text-warning',
    chip: 'bg-surface text-warning',
  },
  danger: { card: 'bg-error-bg border-line-card', number: 'text-error', chip: 'bg-surface text-error' },
  info: { card: 'bg-info-bg border-line-card', number: 'text-info', chip: 'bg-surface text-info' },
  success: {
    card: 'bg-success-bg border-line-card',
    number: 'text-success',
    chip: 'bg-surface text-success',
  },
  neutral: { card: 'bg-surface border-line-card', number: 'text-ink', chip: 'bg-pill text-ink' },
};

/**
 * One Overview stat tile (design 2026-11-25): a coloured icon chip, the number (strong, in the tone's colour), its
 * label, and the queue it counts as the link. Amber and red tiles also say "Needs attention" in words (never colour
 * alone, WCAG 1.4.1). The label comes first in the DOM so the link reads "Orders to route, 3, Needs attention, View".
 */
export function OverviewTile({
  href,
  label,
  value,
  tone,
  icon: Icon,
}: {
  href: string;
  label: string;
  /** Already formatted (count or money). */
  value: string;
  tone: TileTone;
  icon: LucideIcon;
}) {
  const t = useTranslations('portal');
  const c = TONE[tone];
  return (
    <Link
      href={href}
      className={`${adminCard} ${c.card} ${OVERVIEW_TILE_HEIGHT} press group flex h-full flex-col justify-between gap-2 hover:shadow-card-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus`}
    >
      <span className="order-2 block text-sm leading-snug text-ink [overflow-wrap:anywhere]">{label}</span>
      <span className="order-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex items-center gap-2">
          <span className={`grid size-9 shrink-0 place-items-center rounded-tile ${c.chip}`}>
            <Icon aria-hidden="true" className="size-[18px]" strokeWidth={2} />
          </span>
          <span className={`font-heading text-3xl leading-none font-extrabold tabular-nums ${c.number}`}>
            {value}
          </span>
        </span>
        {tone === 'warning' || tone === 'danger' ? (
          <span className={`text-xs font-extrabold ${c.number}`}>{t('kpi_needsAttention')}</span>
        ) : null}
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
