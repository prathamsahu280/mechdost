'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  workshopRates,
  type WorkshopMedians,
  type WorkshopStats,
} from '@mechdost/shared/workshop-analytics-api';
import { durationParts, formatCount } from '@/lib/admin-analytics-view';
import { formatPrice } from '@/lib/format';
import { funnelBars, ratingText, reasonKey } from '@/lib/workshop-analytics-view';
import { portalCard } from './portal-styles';

/**
 * The numbers of one workshop (the portal's Performance) or of all workshops of a city (the admin Workshops tab),
 * for one range: tiles with the city median beside them, the request funnel, speed, estimates, money, quality and the
 * reasons of cancelled and rejected requests. Counts, minutes and paise only; no customer data. An empty range shows
 * one calm message. The city median is never given from fewer than three workshops (the API leaves it null).
 */
export function WorkshopStatsView({
  stats,
  medians,
  locale,
}: {
  stats: WorkshopStats;
  medians: WorkshopMedians;
  locale: string;
}) {
  const t = useTranslations('workshopAnalytics');
  if (stats.requests === 0) {
    return (
      <div className="rounded-card border border-dashed border-line-card bg-surface p-6 text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft text-2xl"
        >
          🔧
        </span>
        <p className="mt-3 font-bold text-ink">{t('empty')}</p>
        <p className="mt-1 text-sm text-muted">{t('empty_hint')}</p>
      </div>
    );
  }
  const rates = workshopRates(stats);
  const n = (v: number) => formatCount(v, locale);
  const none = t('none');
  const pct = (v: number | null) => (v === null ? none : t('percent', { n: v }));
  const minutes = (v: number | null) => {
    if (v === null) return none;
    const d = durationParts(v * 60);
    return t(`unit_${d.unit}`, { n: d.value });
  };
  const money = (v: number | null) => (v === null ? none : formatPrice(v));
  const rating = (v: number | null) => (v === null ? none : ratingText(v));
  const m = medians.values;
  const shown = medians.workshops >= 3;
  const med = (v: number | null, f: (x: number | null) => string) =>
    shown && v !== null ? t('city_median', { value: f(v) }) : null;
  const bars = funnelBars(stats);
  const modeTotal = stats.byMode.workshop + stats.byMode.home;

  return (
    <div className="space-y-6">
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
        <Tile
          label={t('tile_requests')}
          value={n(stats.requests)}
          compare={med(m.requests, (x) => n(x ?? 0))}
        />
        <Tile
          label={t('tile_acceptance')}
          value={pct(rates.acceptancePercent)}
          compare={med(m.acceptancePercent, pct)}
        />
        <Tile
          label={t('tile_propose')}
          value={minutes(stats.medianMinutesToPropose)}
          compare={med(m.minutesToPropose, minutes)}
        />
        <Tile
          label={t('tile_approval')}
          value={pct(rates.approvalPercent)}
          compare={med(m.approvalPercent, pct)}
        />
        <Tile
          label={t('tile_bill')}
          value={money(rates.averageBillPaise)}
          compare={med(m.averageBillPaise, money)}
        />
        <Tile
          label={t('tile_rating')}
          value={rating(stats.ratingTenths)}
          note={stats.ratingCount > 0 ? t('rating_count', { n: stats.ratingCount }) : undefined}
          compare={med(m.ratingTenths, rating)}
        />
      </ul>
      {shown ? null : <p className="text-xs text-muted">{t('median_none')}</p>}

      <Section title={t('section_funnel')}>
        <ol className="space-y-2">
          {bars.map((b) => (
            <li key={b.step}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 text-ink">{t(`step_${b.step}`)}</span>
                <span className="shrink-0 tabular-nums text-ink">
                  <strong>{n(b.count)}</strong>
                  {b.ofPrevious === null ? null : (
                    <span className="ml-2 text-xs text-muted">{t('of_previous', { n: b.ofPrevious })}</span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-pill bg-pill" aria-hidden="true">
                <div className="h-full rounded-pill bg-accent" style={{ width: `${String(b.width)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid gap-4 tab:grid-cols-2">
        <Section title={t('section_mode')}>
          <div className="flex h-3 overflow-hidden rounded-pill bg-pill" aria-hidden="true">
            <div
              className="h-full bg-accent"
              style={{
                width: `${String(modeTotal > 0 ? Math.round((stats.byMode.workshop * 100) / modeTotal) : 0)}%`,
              }}
            />
          </div>
          <dl className="mt-3 space-y-1 text-sm">
            <Pair label={t('mode_workshop')} value={n(stats.byMode.workshop)} />
            <Pair label={t('mode_home')} value={n(stats.byMode.home)} />
          </dl>
        </Section>

        <Section title={t('section_speed')}>
          <dl className="space-y-1 text-sm">
            <Pair label={t('speed_propose')} value={minutes(stats.medianMinutesToPropose)} />
            <Pair label={t('speed_estimate')} value={minutes(stats.medianMinutesToEstimate)} />
            <Pair label={t('speed_job')} value={minutes(stats.medianMinutesJob)} />
          </dl>
        </Section>
      </div>

      <div className="grid gap-4 tab:grid-cols-2">
        <Section title={t('section_estimates')}>
          <dl className="space-y-1 text-sm">
            <Pair
              label={t('est_lines')}
              value={t('est_lines_value', { sent: n(stats.linesSent), approved: n(stats.linesApproved) })}
            />
            <Pair
              label={t('est_amount')}
              value={t('est_amount_value', {
                sent: formatPrice(stats.linesSentPaise),
                approved: formatPrice(stats.linesApprovedPaise),
              })}
            />
            <Pair
              label={t('est_declined')}
              value={
                rates.declinedLinePercent === null
                  ? none
                  : t('est_declined_value', {
                      n: rates.declinedLinePercent,
                      count: n(stats.estimatesWithDeclinedLine),
                      total: n(stats.estimates),
                    })
              }
            />
          </dl>
        </Section>

        <Section title={t('section_money')}>
          <dl className="space-y-1 text-sm">
            <Pair
              label={t('money_billed')}
              value={`${formatPrice(stats.billedPaise)} · ${t('money_bills', { n: stats.billed })}`}
            />
            <Pair label={t('money_visit')} value={formatPrice(stats.visitFeesPaise)} />
            <Pair
              label={t('money_paid')}
              value={t('money_paid_value', {
                cash: stats.paidCash,
                upi: stats.paidUpi,
                card: stats.paidCard,
              })}
            />
            <Pair label={t('money_unpaid')} value={n(stats.billsUnpaid)} />
          </dl>
        </Section>
      </div>

      <Section title={t('section_quality')}>
        <dl className="space-y-1 text-sm">
          <Pair
            label={t('quality_returned')}
            value={
              rates.returnedPercent === null
                ? none
                : t('quality_returned_value', {
                    n: rates.returnedPercent,
                    count: n(stats.returnedWithin30Days),
                    total: n(stats.completedJobs),
                  })
            }
            compare={med(m.returnedPercent, pct)}
          />
          <Pair
            label={t('quality_photos')}
            value={pct(rates.photosPercent)}
            compare={med(m.photosPercent, pct)}
          />
        </dl>
        <p className="mt-2 text-xs text-muted">{t('quality_returned_help')}</p>
      </Section>

      <Section title={t('section_reasons')}>
        {stats.cancelled + stats.rejected === 0 ? (
          <p className="text-sm text-muted">{t('reasons_none')}</p>
        ) : (
          <div className="grid gap-4 tab:grid-cols-2">
            <ReasonList
              title={t('cancelled', { n: stats.cancelled })}
              rows={stats.cancelReasons.map((r) => ({
                label: t(reasonKey('cancelled', r.code)),
                count: r.count,
              }))}
              n={n}
            />
            <ReasonList
              title={t('rejected', { n: stats.rejected })}
              rows={stats.rejectReasons.map((r) => ({
                label: t(reasonKey('rejected', r.code)),
                count: r.count,
              }))}
              n={n}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={portalCard}>
      <h3 className="mb-3 font-heading text-base font-extrabold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  compare,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  compare: string | null;
}) {
  return (
    <li className={`${portalCard} min-w-0`}>
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 break-words font-heading text-2xl font-extrabold tabular-nums text-ink">{value}</p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {compare ? <p className="mt-1 text-xs text-muted">{compare}</p> : null}
    </li>
  );
}

function Pair({ label, value, compare }: { label: string; value: string; compare?: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="min-w-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-bold tabular-nums text-ink">
        {value}
        {compare ? <span className="block text-xs font-normal text-muted">{compare}</span> : null}
      </dd>
    </div>
  );
}

function ReasonList({
  title,
  rows,
  n,
}: {
  title: string;
  rows: readonly { label: string; count: number }[];
  n: (v: number) => string;
}) {
  return (
    <div>
      <h4 className="text-sm font-bold text-ink">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex justify-between gap-3">
            <span className="min-w-0 text-muted">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink">{n(r.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
