'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { workshopRates, type AdminWorkshopAnalytics } from '@mechdost/shared/workshop-analytics-api';
import { durationParts, formatCount, localName } from '@/lib/admin-analytics-view';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { formatPrice } from '@/lib/format';

import {
  ratingText,
  sortWorkshops,
  SORT_KEYS,
  type SortDir,
  type SortKey,
} from '@/lib/workshop-analytics-view';
import { portalPrimary } from './portal-styles';
import { adminCard, adminNum, AdminTable, adminTableClass, adminTd } from './admin-ui';
import { WorkshopStatsView } from './workshop-stats-view';

interface Query {
  city: string | null;
  from: string;
  to: string;
}

/**
 * Admin → Analytics → Workshops (spec 08, design 2026-11-15): one city at a time (the first one in the staff
 * member's scope when none is chosen), the city's totals and workshop medians, and a sortable table of every
 * workshop. Dates and city come from the page's filters. Counts, minutes and paise only; no customer data.
 */
export function AdminWorkshopAnalyticsApi({ query }: { query: Query }) {
  const t = useTranslations('workshopAnalytics');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [data, setData] = useState<AdminWorkshopAnalytics | null>(null);
  const [error, setError] = useState<CommonErrorKey | 'analytics_api_err_timeout' | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    void (async () => {
      const { fetchAdminWorkshopAnalytics } = await import('@/lib/workshop-analytics-api');
      const res = await fetchAdminWorkshopAnalytics(locale, query);
      if (mine !== seq.current) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.code === 'QUERY_TIMEOUT' ? 'analytics_api_err_timeout' : commonErrorKey(res.code));
        return;
      }
      setError(null);
      setData(res.data);
    })();
  }, [locale, query, retry]);

  if (error)
    return (
      <div role="alert" className={`${adminCard} space-y-3`}>
        <p className="text-sm font-bold text-error">{p(error)}</p>
        <button
          type="button"
          data-track="admin_workshop_analytics_retry"
          className={portalPrimary}
          onClick={() => {
            setRetry((v) => v + 1);
          }}
        >
          {p('api_common_retry')}
        </button>
      </div>
    );
  if (data === null)
    return (
      <div role="status" className="space-y-3">
        <p className="sr-only">{p('api_common_loading')}</p>
        <div className="skeleton h-28 rounded-card" aria-hidden="true" />
        <div className="skeleton h-64 rounded-card" aria-hidden="true" />
      </div>
    );
  const city = data.cities.find((c) => c.code === data.city);
  return (
    <div aria-busy={loading} className={`space-y-6 ${loading ? 'opacity-70' : ''}`}>
      <p className="text-sm text-muted">
        {t('admin_city_note', { city: city ? localName(city, locale) : data.city })}
      </p>
      <WorkshopStatsView stats={data.totals} medians={data.medians} locale={locale} />
      <WorkshopTable data={data} locale={locale} />
      <p className="text-xs text-muted">{t('definitions')}</p>
    </div>
  );
}

function WorkshopTable({ data, locale }: { data: AdminWorkshopAnalytics; locale: string }) {
  const t = useTranslations('workshopAnalytics');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'requests', dir: 'desc' });
  const rows = useMemo(
    () => sortWorkshops(data.workshops, sort.key, sort.dir),
    [data.workshops, sort.key, sort.dir],
  );
  const n = (v: number) => formatCount(v, locale);
  const none = t('none');
  const pct = (v: number | null) => (v === null ? none : t('percent', { n: v }));
  const minutes = (v: number | null) => {
    if (v === null) return none;
    const d = durationParts(v * 60);
    return t(`unit_${d.unit}`, { n: d.value });
  };
  if (data.workshops.length === 0)
    return (
      <section className={adminCard}>
        <h3 className="font-heading text-base font-extrabold text-ink">{t('table_title')}</h3>
        <p className="mt-2 text-sm text-muted">{t('table_empty')}</p>
      </section>
    );
  const columns: { key: SortKey; numeric: boolean }[] = SORT_KEYS.map((key) => ({
    key,
    numeric: key !== 'name',
  }));
  return (
    <section className={adminCard}>
      <h3 className="font-heading text-base font-extrabold text-ink">{t('table_title')}</h3>
      <AdminTable label={t('table_title')}>
        <table className={adminTableClass}>
          <caption className="sr-only">{t('table_title')}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`border-b border-line px-2 py-1 text-xs font-bold text-muted ${
                      c.numeric ? 'text-right' : 'text-left'
                    }`}
                  >
                    <button
                      type="button"
                      data-track="admin_workshop_analytics_sort"
                      className="press min-h-11 rounded-md px-1 font-bold"
                      onClick={() => {
                        setSort((s) => ({
                          key: c.key,
                          dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc',
                        }));
                      }}
                    >
                      {t(`col_${c.key}`)}
                      <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const r = workshopRates(w);
              return (
                <tr key={w.id} className="border-b border-line last:border-b-0">
                  <th
                    scope="row"
                    className="max-w-[16rem] break-words px-2 py-2 text-left font-bold text-ink"
                  >
                    {localName(w, locale)}
                  </th>
                  <td className={`${adminTd} ${adminNum}`}>{n(w.requests)}</td>
                  <td className={`${adminTd} ${adminNum}`}>{pct(r.acceptancePercent)}</td>
                  <td className={`${adminTd} ${adminNum}`}>{minutes(w.medianMinutesToPropose)}</td>
                  <td className={`${adminTd} ${adminNum}`}>{pct(r.approvalPercent)}</td>
                  <td className={`${adminTd} ${adminNum}`}>
                    {r.averageBillPaise === null ? none : formatPrice(r.averageBillPaise)}
                  </td>
                  <td className={`${adminTd} ${adminNum}`}>
                    {w.ratingTenths === null ? none : ratingText(w.ratingTenths)}
                  </td>
                  <td className={`${adminTd} ${adminNum}`}>{pct(r.returnedPercent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminTable>
    </section>
  );
}
