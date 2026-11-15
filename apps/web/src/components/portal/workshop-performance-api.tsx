'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortalWorkshopAnalytics } from '@mechdost/shared/workshop-analytics-api';
import { rangePreset, type RangePreset } from '@/lib/admin-analytics-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { portalCard, portalPrimary } from './portal-styles';
import { WorkshopStatsView } from './workshop-stats-view';

const PRESETS: readonly RangePreset[] = [30, 90];

/**
 * Workshop portal → Performance (spec 07, design 2026-11-15): the owner's own numbers for the last 30 or 90 days
 * next to the anonymised city median. Loaded on demand through `workshop-performance-lazy.tsx` (nothing in the header
 * or layout imports it). A failed call shows the error with "Try again"; staff accounts see why it is not for them.
 */
export function WorkshopPerformanceApi() {
  const t = useTranslations('workshopAnalytics');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [days, setDays] = useState<RangePreset>(30);
  const [data, setData] = useState<PortalWorkshopAnalytics | null>(null);
  const [error, setError] = useState<CommonErrorKey | 'analytics_api_err_timeout' | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(
    async (preset: RangePreset) => {
      const mine = ++seq.current;
      setLoading(true);
      const { fetchWorkshopPerformance } = await import('@/lib/workshop-analytics-api');
      const res = await fetchWorkshopPerformance(locale, rangePreset(preset, new Date()));
      if (mine !== seq.current) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.code === 'QUERY_TIMEOUT' ? 'analytics_api_err_timeout' : commonErrorKey(res.code));
        return;
      }
      setError(null);
      setData(res.data);
      track('workshop_analytics_viewed', { rangeDays: res.data.range.days });
    },
    [locale],
  );

  useEffect(() => {
    void load(days);
  }, [load, days]);

  return (
    <section aria-labelledby="performance-title" className="space-y-4">
      <div>
        <h2 id="performance-title" className="font-heading text-xl font-extrabold text-ink">
          {t('portal_title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('portal_intro')}</p>
      </div>
      <div role="group" aria-label={t('portal_range')} className="flex flex-wrap gap-2">
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            data-track={`workshop_analytics_preset_${String(d)}`}
            onClick={() => {
              setDays(d);
            }}
            className={`press min-h-11 rounded-pill px-4 text-sm font-bold ${
              days === d ? 'bg-accent-soft text-accent-soft-text' : 'bg-pill text-ink'
            }`}
          >
            {t(d === 30 ? 'preset_30' : 'preset_90')}
          </button>
        ))}
      </div>
      {error ? (
        <div role="alert" className={`${portalCard} space-y-3`}>
          <p className="text-sm font-bold text-error">
            {error === 'api_common_err_forbidden' ? t('owner_only') : p(error)}
          </p>
          {error === 'api_common_err_forbidden' ? null : (
            <button
              type="button"
              data-track="workshop_analytics_retry"
              className={portalPrimary}
              onClick={() => {
                void load(days);
              }}
            >
              {p('api_common_retry')}
            </button>
          )}
        </div>
      ) : data === null ? (
        <div role="status" className="space-y-3">
          <p className="sr-only">{p('api_common_loading')}</p>
          <div className="skeleton h-28 rounded-card" aria-hidden="true" />
          <div className="skeleton h-64 rounded-card" aria-hidden="true" />
        </div>
      ) : (
        <div aria-busy={loading} className={loading ? 'opacity-70' : ''}>
          <WorkshopStatsView stats={data.stats} medians={data.cityMedians} locale={locale} />
          <p className="mt-4 text-xs text-muted">{t('fresh')}</p>
        </div>
      )}
    </section>
  );
}
