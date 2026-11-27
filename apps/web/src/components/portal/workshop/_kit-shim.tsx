'use client';

/**
 * TEMPORARY local stand-ins for the partner kit (batch 0, `components/partner/*`, design 2026-11-27 § 4), built in
 * parallel on another branch. Same names; the props below are this batch's reading of § 4 and § 13. On merge the lead
 * swaps these imports for `@/components/partner` and deletes this file. No text lives here: every word comes in props.
 */
import type { ReactNode } from 'react';
import { LocalLink } from '@/components/ui/local-link';

const focus = 'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Portal tabs: links with `aria-current="page"`, 48 px, two lines allowed for Hindi. */
export function PartnerTabs({
  label,
  tabs,
  current,
  onSelect,
}: {
  label: string;
  tabs: readonly { key: string; href: string; label: string }[];
  current: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <nav aria-label={label}>
      <ul
        className="grid gap-1 rounded-button border border-line-card bg-surface p-1"
        style={{ gridTemplateColumns: `repeat(${String(tabs.length)}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => (
          <li key={tab.key}>
            <LocalLink
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
              onClick={() => onSelect?.(tab.key)}
              className={`press flex min-h-12 items-center justify-center rounded-button px-1 text-center text-sm leading-tight font-bold text-ink hover:bg-pill aria-[current=page]:bg-navy aria-[current=page]:text-white ${focus}`}
            >
              {tab.label}
            </LocalLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type KpiTone = 'waiting' | 'progress' | 'done' | 'neutral';
const TONE: Record<KpiTone, string> = {
  waiting: 'bg-warning-bg',
  progress: 'bg-info-bg',
  done: 'bg-success-bg',
  neutral: 'bg-surface',
};
const NUMBER_TONE: Record<KpiTone, string> = {
  waiting: 'text-warning',
  progress: 'text-info',
  done: 'text-success',
  neutral: 'text-ink',
};

/** Number first, label, tone by meaning, "Needs you" in words when given; the whole tile links to its list. */
export function KpiTile({
  href,
  value,
  label,
  tone,
  needsYou,
  onClick,
}: {
  href: string;
  value: string;
  label: string;
  tone: KpiTone;
  needsYou?: string | undefined;
  onClick?: () => void;
}) {
  return (
    <LocalLink
      href={href}
      onClick={onClick}
      className={`press flex min-h-28 flex-col justify-between rounded-card border border-line-card p-4 shadow-card ${TONE[tone]} ${focus}`}
    >
      <span
        className={`font-heading text-[28px] leading-none font-extrabold tabular-nums ${NUMBER_TONE[tone]}`}
      >
        {value}
      </span>
      <span className="mt-2 text-sm font-bold text-ink">{label}</span>
      {needsYou ? <span className="mt-1 text-xs font-bold text-ink">{needsYou}</span> : null}
    </LocalLink>
  );
}

/** Lane tabs with counts; links keep `?lane=` in the URL; the row scrolls inside its own box at 360 px. */
export function LaneTabs({
  label,
  lanes,
  current,
  onSelect,
}: {
  label: string;
  lanes: readonly { key: string; href: string; label: string; count: string; accessibleName: string }[];
  current: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <nav aria-label={label} className="relative overflow-x-auto" tabIndex={-1}>
      <ul className="flex gap-2 pb-1">
        {lanes.map((l) => (
          <li key={l.key} className="shrink-0">
            <LocalLink
              href={l.href}
              scroll={false}
              aria-current={l.key === current ? 'page' : undefined}
              aria-label={l.accessibleName}
              onClick={() => onSelect?.(l.key)}
              className={`press inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-card bg-surface px-4 text-sm font-bold text-ink hover:bg-pill aria-[current=page]:border-transparent aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-text ${focus}`}
            >
              {l.label}
              <span className="rounded-pill bg-pill px-2 text-xs tabular-nums text-ink">{l.count}</span>
            </LocalLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Ordered steps (done / now / later) and "Step n of m" in words. */
export function StepRail({
  label,
  steps,
  current,
  allDone,
  caption,
}: {
  label: string;
  steps: readonly string[];
  current: number;
  allDone: boolean;
  caption: string;
}) {
  return (
    <div className="mt-3">
      <ol aria-label={label} className="flex gap-1">
        {steps.map((s, i) => {
          const done = allDone || i < current;
          const now = !allDone && i === current;
          return (
            <li key={s} aria-current={now ? 'step' : undefined} className="min-w-0 flex-1">
              <span
                aria-hidden="true"
                className={`block h-1.5 rounded-pill ${done ? 'bg-accent-button' : now ? 'bg-info' : 'bg-line'}`}
              />
              <span
                className={`mt-1 block truncate text-[11px] ${now ? 'font-extrabold text-ink' : 'text-muted'}`}
              >
                {s}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-sm font-bold text-ink">{caption}</p>
    </div>
  );
}

/** One measure: your bar (accent), the city middle as an ink marker, both values written (never colour alone). */
export function BulletBar({
  valuePct,
  medianPct,
  valueText,
  medianText,
}: {
  valuePct: number;
  medianPct: number | null;
  valueText: string;
  medianText: string | null;
}) {
  return (
    <div className="mt-2">
      <div className="relative h-2.5 rounded-pill bg-pill" aria-hidden="true">
        <div className="h-full rounded-pill bg-accent" style={{ width: `${String(valuePct)}%` }} />
        {medianPct === null ? null : (
          <span
            className="absolute -top-1 h-[18px] w-0.5 rounded-pill bg-ink"
            style={{ left: `calc(${String(medianPct)}% - 1px)` }}
          />
        )}
      </div>
      <p className="sr-only">{medianText ? `${valueText}. ${medianText}` : valueText}</p>
    </div>
  );
}

/** A labelled block for the tab bodies. */
export function KitSection({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-heading text-xl font-extrabold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}
