'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { chartTicks, shortDay } from '@/lib/admin-analytics-view';
import { ScrollRegion } from '../ui/scroll-region';

/** Bar colours per measure (decision 2026-11-25 "Admin data colour"); each is at least 3:1 on the card in both themes (tokens test). */
const BAR_FILL = { info: 'fill-info', success: 'fill-success', accent: 'fill-accent-button' } as const;

/**
 * Small dependency-free charts for Admin → Analytics (decision 2026-11-14 "Analytics charts in SVG"): one series per
 * chart in the accent colour (the title names it, so no legend), round ticks from 0, recessive gridlines, the hovered
 * or focused day read out in text above the plot (a labelled, focusable group: arrow keys move the day; the SVG
 * itself is hidden from assistive technology), and every chart also as a table.
 */
const W = 600;
const H = 160;

export function DailyBars({
  title,
  days,
  format,
  locale,
  tone = 'info',
}: {
  /** The measure's colour, the same on every admin chart: counts blue, money green, visitors the brand orange. */
  tone?: 'info' | 'success' | 'accent';
  title: string;
  days: readonly { date: string; value: number }[];
  format: (n: number) => string;
  locale: string;
}) {
  const t = useTranslations('portal');
  const hintId = useId();
  const readoutId = useId();
  const [active, setActive] = useState<number | null>(null);
  const values = days.map((d) => d.value);
  const ticks = chartTicks(values);
  const top = ticks.at(-1) ?? 1;
  const slot = W / Math.max(days.length, 1);
  const gap = Math.min(4, slot * 0.25);
  let peak = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] ?? 0) > (values[peak] ?? 0)) peak = i;
  const total = values.reduce((sum, v) => sum + v, 0);
  const peakDay = days[peak];
  const summary = t('analytics_api_chart_summary', {
    title,
    total: format(total),
    max: format(peakDay?.value ?? 0),
    day: peakDay ? shortDay(peakDay.date, locale) : '',
  });
  const shown = active === null ? null : days[active];

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const last = days.length - 1;
    const at = active ?? -1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(last, at + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, at === -1 ? last : at - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null || last < 0) return;
    e.preventDefault();
    setActive(next);
  }

  return (
    <figure className="min-w-0 rounded-card border border-line-card bg-surface p-4 shadow-card">
      <figcaption className="font-heading text-base font-extrabold text-ink">{title}</figcaption>
      <p id={readoutId} aria-live="polite" className="mt-1 min-h-5 text-sm text-muted tabular-nums">
        {shown
          ? t('analytics_api_chart_readout', {
              day: shortDay(shown.date, locale),
              value: format(shown.value),
            })
          : summary}
      </p>
      <div className="mt-3 flex gap-2">
        <div
          aria-hidden="true"
          className="flex w-16 shrink-0 flex-col-reverse justify-between text-right text-[11px] text-muted tabular-nums"
        >
          {ticks.map((tick) => (
            <span key={tick}>{format(tick)}</span>
          ))}
        </div>
        <div
          role="group"
          aria-label={title}
          aria-describedby={`${readoutId} ${hintId}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => {
            setActive(null);
          }}
          onPointerLeave={() => {
            setActive(null);
          }}
          className="min-w-0 flex-1 rounded-tile focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            preserveAspectRatio="none"
            className="block h-40 w-full"
          >
            {ticks.map((tick) => {
              const y = H - (tick / top) * H;
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={W}
                  y1={y}
                  y2={y}
                  className="stroke-line"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {days.map((d, i) => {
              const h = top > 0 ? (d.value / top) * H : 0;
              return (
                <g key={d.date}>
                  {h > 0 ? (
                    <rect
                      x={i * slot + gap / 2}
                      y={H - h}
                      width={Math.max(slot - gap, 1)}
                      height={h}
                      rx={Math.min(3, (slot - gap) / 2)}
                      className={active === i ? 'fill-ink' : BAR_FILL[tone]}
                    />
                  ) : null}
                  <rect
                    x={i * slot}
                    y={0}
                    width={slot}
                    height={H}
                    fill="transparent"
                    onPointerEnter={() => {
                      setActive(i);
                    }}
                  />
                </g>
              );
            })}
          </svg>
          <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{days[0] ? shortDay(days[0].date, locale) : ''}</span>
            <span>{days.length > 1 ? shortDay(days[days.length - 1]?.date ?? '', locale) : ''}</span>
          </div>
        </div>
      </div>
      <p id={hintId} className="sr-only">
        {t('analytics_api_chart_hint')}
      </p>
      <details className="mt-3 text-sm">
        <summary className="press inline-flex min-h-11 cursor-pointer items-center font-bold text-accent-soft-text">
          {t('analytics_api_chart_table')}
        </summary>
        <DataTable
          caption={title}
          columns={[
            { label: t('analytics_api_col_day') },
            { label: t('analytics_api_col_value'), numeric: true },
          ]}
          rows={days.map((d) => [shortDay(d.date, locale), format(d.value)])}
          empty={t('analytics_api_table_empty')}
        />
      </details>
    </figure>
  );
}

/** A plain data table: captioned, scrolls sideways inside its card on phones, numbers right-aligned. */
export function DataTable({
  caption,
  columns,
  rows,
  empty,
  hideCaption = true,
}: {
  caption: string;
  columns: readonly { label: string; numeric?: boolean }[];
  rows: readonly (readonly ReactNode[])[];
  empty: string;
  hideCaption?: boolean;
}) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-muted">{empty}</p>;
  return (
    <ScrollRegion label={caption} className="mt-2">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className={hideCaption ? 'sr-only' : 'pb-2 text-left font-bold text-ink'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={`border-b border-line px-2 py-2 text-xs font-bold text-muted ${
                  c.numeric ? 'text-right' : 'text-left'
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            // Rows are positional (a ranked list that is re-rendered whole), so the index is their identity.
            <tr key={r} className="border-b border-line last:border-b-0">
              {row.map((cell, i) => (
                <td
                  key={columns[i]?.label ?? i}
                  className={`px-2 py-2 text-ink ${columns[i]?.numeric ? 'text-right tabular-nums' : 'text-left'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
