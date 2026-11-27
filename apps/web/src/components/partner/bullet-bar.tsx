'use client';

import { useTranslations } from 'next-intl';
import { bulletGeometry } from '@/lib/partner-kit';

/**
 * One measure against the city middle (design 2026-11-27 § 4; ui-ux-pro-max chart DB "Performance vs Target
 * (Compact)"): your bar in the accent, an ink marker for the city middle, your value written at the end and the city
 * middle written under it. No colour-only meaning; when there is no city middle the marker is absent and `noCityText`
 * says why. `hint` says the direction in words ("Lower is better").
 */
export function BulletBar({
  label,
  value,
  valueText,
  city,
  cityText,
  max,
  noCityText,
  hint,
}: {
  label: string;
  value: number;
  valueText: string;
  city: number | null;
  cityText?: string;
  max?: number;
  noCityText?: string;
  hint?: string;
}) {
  const t = useTranslations('partnerKit');
  const g = bulletGeometry(value, city, max);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-bold text-ink">{label}</span>
        <span className="font-heading text-lg font-extrabold text-ink tabular-nums">{valueText}</span>
      </div>
      <div aria-hidden="true" className="relative h-3 rounded-pill bg-pill">
        <div className="h-full rounded-pill bg-accent-button" style={{ width: `${g.valuePct}%` }} />
        {g.cityPct !== null ? (
          <span
            className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-pill bg-ink"
            style={{ left: `${g.cityPct}%` }}
          />
        ) : null}
      </div>
      <p className="text-xs text-muted">
        {g.cityPct !== null && cityText
          ? t('city_middle', { value: cityText })
          : (noCityText ?? t('no_city'))}
        {hint ? ` · ${hint}` : ''}
      </p>
    </div>
  );
}
