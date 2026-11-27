'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';

/** Admin data colour by meaning (decision 2026-11-25): amber waiting, red urgent, blue in progress, green done/money. */
export type KpiTone = 'waiting' | 'urgent' | 'progress' | 'done' | 'empty';

const TONE: Record<KpiTone, { chip: string; ring: string }> = {
  waiting: { chip: 'bg-warning-bg text-warning', ring: 'border-warning/40' },
  urgent: { chip: 'bg-error-bg text-error', ring: 'border-error/40' },
  progress: { chip: 'bg-info-bg text-info', ring: 'border-line-card' },
  done: { chip: 'bg-success-bg text-success', ring: 'border-line-card' },
  empty: { chip: 'bg-pill text-muted', ring: 'border-line-card' },
};

/**
 * A "Today" number tile (design 2026-11-27 § 4): number first (Manrope, tabular), the label in words, an icon chip in
 * the tone of its meaning and "Needs you" in words for waiting/urgent work. The whole tile links to its list. `compact`
 * is the one-row chip form used while offers are open. Fixed minimum height (no layout shift while counts load).
 */
export function KpiTile({
  portal,
  id,
  href,
  value,
  label,
  tone,
  icon,
  needsYou = false,
  compact = false,
}: {
  portal: PartnerPortal;
  /** Tile code for analytics, e.g. `new`. */
  id: string;
  href: string;
  /** The count as text ("3", "20+"), or null while loading. */
  value: string | null;
  label: string;
  tone: KpiTone;
  icon: ReactNode;
  needsYou?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('partnerKit');
  const style = TONE[value === '0' ? 'empty' : tone];
  const showNeeds = needsYou && value !== null && value !== '0';
  return (
    <LocalLink
      href={href}
      onClick={() => {
        track('partner_kpi_clicked', { portal, tile: id });
      }}
      className={`press group flex rounded-card border bg-surface shadow-card hover:border-ink/30 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${style.ring} ${
        compact
          ? 'min-h-[4.5rem] flex-col justify-center gap-0.5 px-2 py-2 text-center'
          : 'min-h-28 flex-col gap-2 p-4'
      }`}
    >
      {compact ? (
        <>
          <span className="font-heading text-2xl leading-none font-extrabold text-ink tabular-nums">
            {value ?? <span className="skeleton inline-block h-6 w-6 rounded" aria-hidden="true" />}
          </span>
          <span className="text-xs leading-tight font-bold text-ink">{label}</span>
          {showNeeds ? <span className="sr-only">{t('needs_you')}</span> : null}
        </>
      ) : (
        <>
          <span className="flex items-start justify-between gap-2">
            <span className="font-heading text-[28px] leading-none font-extrabold text-ink tabular-nums">
              {value ?? <span className="skeleton inline-block h-7 w-8 rounded" aria-hidden="true" />}
            </span>
            <span
              aria-hidden="true"
              className={`flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-5 ${style.chip}`}
            >
              {icon}
            </span>
          </span>
          <span className="text-sm leading-snug font-bold text-ink">{label}</span>
          {showNeeds ? (
            <span className={`w-fit rounded-pill px-2 py-0.5 text-xs font-extrabold ${style.chip}`}>
              {t('needs_you')}
            </span>
          ) : null}
        </>
      )}
    </LocalLink>
  );
}
