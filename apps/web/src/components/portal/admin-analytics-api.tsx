'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { AnalyticsDashboard } from '@mechdost/shared/admin-analytics-api';
import { resolveAnalyticsRange } from '@mechdost/shared/analytics-range';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import {
  durationParts,
  formatCount,
  funnelRows,
  localName,
  rangePreset,
  reasonLabelKey,
  sharePercent,
  type RangePreset,
} from '@/lib/admin-analytics-view';
import { formatPrice } from '@/lib/format';
import { DailyBars, DataTable } from './analytics-charts';
import { portalCard, portalField, portalPrimary } from './portal-guard';

const PRESETS: readonly RangePreset[] = [7, 30, 90];
const PRESET_LABEL = {
  7: 'analytics_api_preset_7',
  30: 'analytics_api_preset_30',
  90: 'analytics_api_preset_90',
} as const;

interface Query {
  city: string | null;
  from: string;
  to: string;
}

/**
 * Admin → Analytics on the API (spec 08 "Analytics", real sign-in builds, loaded lazily by `admin-console.tsx`).
 * One calm page: dates and city on top (one primary action, "Show"), then orders and sales, customers, the funnel,
 * products, site visits and searches (all-cities staff only), workshop bookings, shops and PIN areas. Every number
 * comes from the API (counts and paise); a failed call shows the error with "Try again", never an empty dashboard.
 */
export function AdminAnalyticsApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [query, setQuery] = useState<Query>(() => ({ city: null, ...rangePreset(30, new Date()) }));
  const [draft, setDraft] = useState<Query>(query);
  const [rangeError, setRangeError] = useState(false);
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [error, setError] = useState<CommonErrorKey | 'analytics_api_err_timeout' | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(
    async (q: Query) => {
      const mine = ++seq.current;
      setLoading(true);
      const { fetchAnalyticsDashboard } = await import('@/lib/admin-analytics-api');
      const res = await fetchAnalyticsDashboard(locale, q);
      if (mine !== seq.current) return;
      setLoading(false);
      if (!res.ok) {
        // A report over its 10 s budget (503 QUERY_TIMEOUT): say what helps, not a generic failure.
        setError(res.code === 'QUERY_TIMEOUT' ? 'analytics_api_err_timeout' : commonErrorKey(res.code));
        return;
      }
      setError(null);
      setData(res.data);
    },
    [locale],
  );

  useEffect(() => {
    void load(query);
  }, [load, query]);

  function apply(next: Query) {
    const check = resolveAnalyticsRange({ from: next.from, to: next.to }, new Date());
    setRangeError(!check.ok);
    if (!check.ok) return;
    setDraft(next);
    setQuery(next);
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    apply(draft);
  }

  const today = rangePreset(7, new Date()).to;
  const n = (v: number) => formatCount(v, locale);
  const pct = (v: number | null) =>
    v === null ? t('analytics_api_none') : t('analytics_api_percent', { n: v });
  const duration = (s: number | null) => {
    if (s === null) return t('analytics_api_none');
    const d = durationParts(s);
    return t(`analytics_api_unit_${d.unit}`, { n: d.value });
  };

  return (
    <section aria-labelledby="analytics-title" className="space-y-6">
      <div>
        <h2 id="analytics-title" className="font-heading text-xl font-extrabold text-ink">
          {t('analytics_api_title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('analytics_api_intro')}</p>
      </div>

      <form onSubmit={onSubmit} aria-label={t('analytics_api_filters')} className={`${portalCard} space-y-4`}>
        <div role="group" aria-label={t('analytics_api_filters')} className="flex flex-wrap gap-2">
          {PRESETS.map((days) => {
            const preset = rangePreset(days, new Date());
            const on = query.from === preset.from && query.to === preset.to;
            return (
              <button
                key={days}
                type="button"
                aria-pressed={on}
                data-track={`admin_analytics_preset_${String(days)}`}
                onClick={() => {
                  apply({ ...draft, ...preset });
                }}
                className={`press min-h-11 rounded-pill px-4 text-sm font-bold ${
                  on ? 'bg-accent-soft text-accent-soft-text' : 'bg-pill text-ink'
                }`}
              >
                {t(PRESET_LABEL[days])}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 tab:grid-cols-[1fr_1fr_1fr_auto] tab:items-end">
          <label className="block text-sm font-bold text-ink">
            {t('analytics_api_from')}
            <input
              type="date"
              required
              max={today}
              value={draft.from}
              aria-invalid={rangeError}
              aria-describedby={rangeError ? 'analytics-range-error' : undefined}
              onChange={(e) => {
                setDraft({ ...draft, from: e.target.value });
              }}
              className={portalField}
            />
          </label>
          <label className="block text-sm font-bold text-ink">
            {t('analytics_api_to')}
            <input
              type="date"
              required
              max={today}
              value={draft.to}
              aria-invalid={rangeError}
              aria-describedby={rangeError ? 'analytics-range-error' : undefined}
              onChange={(e) => {
                setDraft({ ...draft, to: e.target.value });
              }}
              className={portalField}
            />
          </label>
          <label className="block text-sm font-bold text-ink">
            {t('analytics_api_city')}
            <select
              value={draft.city ?? ''}
              onChange={(e) => {
                setDraft({ ...draft, city: e.target.value === '' ? null : e.target.value });
              }}
              className={portalField}
            >
              <option value="">{t('analytics_api_city_all')}</option>
              {(data?.cities ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {localName(c, locale)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" data-track="admin_analytics_apply" className={portalPrimary}>
            {t('analytics_api_apply')}
          </button>
        </div>
        {rangeError ? (
          <p id="analytics-range-error" role="alert" className="text-sm font-bold text-error">
            {t('analytics_api_err_range')}
          </p>
        ) : null}
      </form>

      {error ? (
        <div role="alert" className={`${portalCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{t(error)}</p>
          <button
            type="button"
            data-track="admin_analytics_retry"
            className={portalPrimary}
            onClick={() => {
              void load(query);
            }}
          >
            {t('api_common_retry')}
          </button>
        </div>
      ) : data === null ? (
        <div role="status" className="space-y-3">
          <p className="sr-only">{t('api_common_loading')}</p>
          <div className="skeleton h-28 rounded-card" aria-hidden="true" />
          <div className="skeleton h-64 rounded-card" aria-hidden="true" />
        </div>
      ) : (
        <div aria-busy={loading} className={`space-y-8 ${loading ? 'opacity-70' : ''}`}>
          <Dashboard data={data} locale={locale} n={n} pct={pct} duration={duration} />
          <p className="text-xs text-muted">{t('analytics_api_fresh')}</p>
        </div>
      )}
    </section>
  );
}

function isEmpty(d: AnalyticsDashboard): boolean {
  return (
    d.kpis.ordersPlaced === 0 &&
    d.kpis.paymentsNotCompleted === 0 &&
    d.kpis.serviceRequests === 0 &&
    (d.traffic === null || d.traffic.visitors === 0)
  );
}

function Dashboard({
  data,
  locale,
  n,
  pct,
  duration,
}: {
  data: AnalyticsDashboard;
  locale: string;
  n: (v: number) => string;
  pct: (v: number | null) => string;
  duration: (s: number | null) => string;
}) {
  const t = useTranslations('portal');
  const o = useTranslations('order');
  if (isEmpty(data)) {
    return (
      <div className="rounded-card border border-dashed border-line-card bg-surface p-6 text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft text-2xl"
        >
          📈
        </span>
        <p className="mt-3 text-sm text-muted">{t('analytics_api_empty')}</p>
      </div>
    );
  }
  const k = data.kpis;
  const money = (v: number) => formatPrice(v);
  const series = (pick: (d: AnalyticsDashboard['daily'][number]) => number | null) =>
    data.daily.map((d) => ({ date: d.date, value: pick(d) ?? 0 }));

  return (
    <>
      <Section title={t('analytics_api_section_sales')}>
        <Kpis
          items={[
            { label: t('analytics_api_kpi_orders'), value: n(k.ordersPlaced) },
            { label: t('analytics_api_kpi_gmv'), value: money(k.gmvPaise), sub: t('analytics_api_sub_gmv') },
            {
              label: t('analytics_api_kpi_aov'),
              value: k.aovPaise === null ? t('analytics_api_none') : money(k.aovPaise),
            },
            {
              label: t('analytics_api_kpi_cod'),
              value: pct(sharePercent(k.codOrders, k.ordersPlaced)),
              sub: t('analytics_api_sub_cod', { cod: n(k.codOrders), online: n(k.onlineOrders) }),
            },
            {
              label: t('analytics_api_kpi_cancelled'),
              value: n(k.cancelled),
              sub: t('analytics_api_sub_parts'),
            },
            {
              label: t('analytics_api_kpi_rejected'),
              value: n(k.rejected),
              sub: t('analytics_api_sub_parts'),
            },
            {
              label: t('analytics_api_kpi_unpaid'),
              value: n(k.paymentsNotCompleted),
              sub: t('analytics_api_sub_unpaid'),
            },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <DailyBars
            title={t('analytics_api_chart_orders')}
            days={series((d) => d.orders)}
            format={n}
            locale={locale}
          />
          <DailyBars
            title={t('analytics_api_chart_gmv')}
            days={series((d) => d.gmvPaise)}
            format={money}
            locale={locale}
          />
        </div>
        <div className="grid gap-4 tab:grid-cols-2">
          <Reasons
            title={t('analytics_api_reasons_cancel')}
            rows={k.cancelReasons.map((r) => [o(reasonLabelKey('cancelled', r.code)), n(r.count)])}
            empty={t('analytics_api_table_empty')}
            countLabel={t('analytics_api_col_count')}
          />
          <Reasons
            title={t('analytics_api_reasons_reject')}
            rows={k.rejectReasons.map((r) => [o(reasonLabelKey('rejected', r.code)), n(r.count)])}
            empty={t('analytics_api_table_empty')}
            countLabel={t('analytics_api_col_count')}
          />
        </div>
      </Section>

      <Section title={t('analytics_api_funnel_title')}>
        <div className={portalCard}>
          <ol className="space-y-3">
            {funnelRows(data.funnel).map((row) => (
              <li key={row.step}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-bold text-ink">{t(`analytics_api_step_${row.step}`)}</span>
                  <span className="text-ink tabular-nums">
                    {n(row.count)}
                    {row.ofPrevious === null ? null : (
                      <span className="ml-2 text-muted">
                        {t('analytics_api_funnel_ofPrevious', { n: row.ofPrevious })}
                      </span>
                    )}
                    {row.morePrevious ? (
                      <span className="ml-2 text-muted">{t('analytics_api_funnel_more')}</span>
                    ) : null}
                  </span>
                </div>
                <div aria-hidden="true" className="mt-1 h-2 rounded-pill bg-pill">
                  <div
                    className="h-2 rounded-pill bg-accent-button"
                    style={{ width: `${String(row.width)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted">
            {data.traffic ? t('analytics_api_funnel_note') : t('analytics_api_traffic_hidden')}
          </p>
        </div>
      </Section>

      <Section title={t('analytics_api_section_customers')}>
        <Kpis
          items={[
            { label: t('analytics_api_kpi_customers'), value: n(k.customers) },
            { label: t('analytics_api_kpi_new'), value: n(k.newCustomers), sub: t('analytics_api_sub_new') },
            {
              label: t('analytics_api_kpi_repeat'),
              value: n(k.repeatCustomers),
              sub: t('analytics_api_sub_repeat'),
            },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title={t('analytics_api_top_ordered')}>
            <DataTable
              caption={t('analytics_api_top_ordered')}
              columns={[
                { label: t('analytics_api_col_product') },
                { label: t('analytics_api_col_orders'), numeric: true },
                { label: t('analytics_api_col_units'), numeric: true },
              ]}
              rows={data.topOrdered.map((p) => [localName(p, locale), n(p.orders), n(p.units)])}
              empty={t('analytics_api_table_empty')}
            />
          </TableCard>
          {data.topViewed ? (
            <TableCard title={t('analytics_api_top_viewed')}>
              <DataTable
                caption={t('analytics_api_top_viewed')}
                columns={[
                  { label: t('analytics_api_col_product') },
                  { label: t('analytics_api_col_views'), numeric: true },
                ]}
                rows={data.topViewed.map((p) => [localName(p, locale), n(p.views)])}
                empty={t('analytics_api_table_empty')}
              />
            </TableCard>
          ) : null}
        </div>
      </Section>

      {data.traffic ? (
        <Section title={t('analytics_api_section_traffic')} note={t('analytics_api_traffic_note')}>
          <Kpis
            items={[
              { label: t('analytics_api_kpi_visitors'), value: n(data.traffic.visitors) },
              { label: t('analytics_api_kpi_sessions'), value: n(data.traffic.sessions) },
              { label: t('analytics_api_kpi_productViews'), value: n(data.traffic.productViews) },
              { label: t('analytics_api_kpi_searches'), value: n(data.traffic.searches) },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <DailyBars
              title={t('analytics_api_chart_visitors')}
              days={series((d) => d.visitors)}
              format={n}
              locale={locale}
            />
            {data.topSearches ? (
              <TableCard title={t('analytics_api_searches')} note={t('analytics_api_searches_note')}>
                <DataTable
                  caption={t('analytics_api_searches')}
                  columns={[
                    { label: t('analytics_api_col_query') },
                    { label: t('analytics_api_col_count'), numeric: true },
                    { label: t('analytics_api_col_match') },
                  ]}
                  rows={data.topSearches.map((s) => [
                    // User-typed text (scrubbed of phone numbers and emails, at least two visitors): shown as typed.
                    <span key="q" lang="und">
                      {s.query}
                    </span>,
                    n(s.count),
                    s.matches ? (
                      t('analytics_api_match_yes')
                    ) : (
                      <span key="m" className="font-bold text-error">
                        {t('analytics_api_match_no')}
                      </span>
                    ),
                  ])}
                  empty={t('analytics_api_table_empty')}
                />
              </TableCard>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={t('analytics_api_section_service')}>
        <Kpis
          items={[
            { label: t('analytics_api_kpi_requests'), value: n(k.serviceRequests) },
            { label: t('analytics_api_kpi_bookings'), value: n(k.bookingsConfirmed) },
            { label: t('analytics_api_kpi_completed'), value: n(k.bookingsCompleted) },
            { label: t('analytics_api_kpi_bookingsCancelled'), value: n(k.bookingsCancelled) },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <DailyBars
            title={t('analytics_api_chart_bookings')}
            days={series((d) => d.bookings)}
            format={n}
            locale={locale}
          />
          <TableCard title={t('analytics_api_workshops')}>
            <DataTable
              caption={t('analytics_api_workshops')}
              columns={[
                { label: t('analytics_api_col_workshop') },
                { label: t('analytics_api_col_requests'), numeric: true },
                { label: t('analytics_api_col_confirmed'), numeric: true },
                { label: t('analytics_api_col_completed'), numeric: true },
                { label: t('analytics_api_col_cancelled'), numeric: true },
                { label: t('analytics_api_col_timeToPropose'), numeric: true },
              ]}
              rows={data.workshops.map((w) => [
                localName(w, locale),
                n(w.requests),
                n(w.confirmed),
                n(w.completed),
                n(w.cancelled),
                duration(w.medianMinutesToPropose === null ? null : w.medianMinutesToPropose * 60),
              ])}
              empty={t('analytics_api_table_empty')}
            />
          </TableCard>
        </div>
      </Section>

      <Section title={t('analytics_api_shops')}>
        <Kpis
          items={[
            {
              label: t('analytics_api_kpi_acceptance'),
              value: pct(sharePercent(k.offersAccepted, k.offersAnswered)),
              sub: t('analytics_api_sub_acceptance', {
                accepted: n(k.offersAccepted),
                answered: n(k.offersAnswered),
              }),
            },
            { label: t('analytics_api_kpi_timeToAccept'), value: duration(k.medianSecondsToAccept) },
          ]}
        />
        <TableCard title={t('analytics_api_shops')}>
          <DataTable
            caption={t('analytics_api_shops')}
            columns={[
              { label: t('analytics_api_col_shop') },
              { label: t('analytics_api_col_offers'), numeric: true },
              { label: t('analytics_api_col_accepted'), numeric: true },
              { label: t('analytics_api_col_declined'), numeric: true },
              { label: t('analytics_api_col_expired'), numeric: true },
              { label: t('analytics_api_col_timeToAccept'), numeric: true },
            ]}
            rows={data.shops.map((s) => [
              localName(s, locale),
              n(s.offers),
              n(s.accepted),
              n(s.declined),
              n(s.expired),
              duration(s.medianSecondsToAccept),
            ])}
            empty={t('analytics_api_table_empty')}
          />
        </TableCard>
      </Section>

      <Section title={t('analytics_api_areas')}>
        <TableCard title={t('analytics_api_areas')}>
          <DataTable
            caption={t('analytics_api_areas')}
            columns={[
              { label: t('analytics_api_col_pin') },
              { label: t('analytics_api_col_area') },
              { label: t('analytics_api_col_orders'), numeric: true },
              { label: t('analytics_api_col_bookings'), numeric: true },
            ]}
            rows={data.areas.map((a) => [
              a.pincode,
              (locale === 'hi' ? (a.localityHi ?? a.locality) : a.locality) ?? t('analytics_api_none'),
              n(a.orders),
              n(a.bookings),
            ])}
            empty={t('analytics_api_table_empty')}
          />
        </TableCard>
      </Section>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-heading text-lg font-extrabold text-ink">{title}</h3>
        {note ? <p className="mt-1 max-w-prose text-sm text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpis({ items }: { items: readonly { label: string; value: string; sub?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 tab:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={`${portalCard} p-4`}>
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd className="mt-1 font-heading text-2xl font-extrabold text-ink tabular-nums">{item.value}</dd>
          {item.sub ? <dd className="mt-1 text-xs text-muted">{item.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function TableCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={`${portalCard} min-w-0`}>
      <h4 className="font-heading text-base font-extrabold text-ink">{title}</h4>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      {children}
    </div>
  );
}

function Reasons({
  title,
  rows,
  empty,
  countLabel,
}: {
  title: string;
  rows: readonly (readonly string[])[];
  empty: string;
  countLabel: string;
}) {
  return (
    <TableCard title={title}>
      <DataTable
        caption={title}
        columns={[{ label: title }, { label: countLabel, numeric: true }]}
        rows={rows}
        empty={empty}
      />
    </TableCard>
  );
}
