'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { savingsLineText } from '@mechdost/shared/content';
import { savingsBand } from '@mechdost/shared/savings';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { savingsRows } from '@/lib/savings-view';

/**
 * Account overview "Your savings" card (shopping personalisation phase 4, decision 2026-11-26): what the customer saved
 * vs the maker's printed MRP this month and this year (IST), delivered orders only, net of refunds, with the breakdown
 * behind a disclosure and the count of lines that had no printed MRP. Real data mode reads `GET /v1/me/savings`; the
 * demo store computes the same figures from the browser's orders (`savings-card-demo` source, loaded by this chunk
 * only in a demo build). Nothing shows when the admin switched it off. Its own lazy chunk (account-area.tsx).
 */
export interface PeriodFigures {
  mrpPaise: number;
  couponPaise: number;
  coinsPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  orders: number;
  excludedLines: number;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'off' }
  | { kind: 'ok'; month: PeriodFigures; year: PeriodFigures };

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';

async function loadFigures(locale: string): Promise<Load> {
  // Inline env (L233): the demo build folds this branch away and never ships the API client.
  if (process.env.NEXT_PUBLIC_DATA_MODE !== 'api') {
    const { demoSavings } = await import('./savings-card-demo');
    return { kind: 'ok', ...demoSavings(new Date()) };
  }
  const { fetchMySavings } = await import('@/lib/savings-api');
  const [month, year] = await Promise.all([fetchMySavings(locale, 'month'), fetchMySavings(locale, 'year')]);
  if (!month.ok || !year.ok) return { kind: 'error' };
  if (!year.data.enabled) return { kind: 'off' };
  return { kind: 'ok', month: month.data, year: year.data };
}

export function SavingsCard({ override }: { override: string | null }) {
  const t = useTranslations('savings');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const tracked = useRef(false);

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    setLoad(await loadFigures(locale).catch((): Load => ({ kind: 'error' })));
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (load.kind !== 'ok' || tracked.current) return;
    tracked.current = true;
    track('savings_viewed', {
      surface: 'account',
      state: load.year.orders === 0 ? 'empty' : 'final',
      band: savingsBand(load.year.totalPaise),
      excluded: Math.min(load.year.excludedLines, 99),
    });
  }, [load]);

  if (load.kind === 'off') return null;
  if (load.kind === 'loading') return <div className="skeleton h-44 rounded-card" aria-hidden="true" />;

  return (
    <section aria-labelledby="savings-card-title" className={card}>
      <h2 id="savings-card-title" className="text-sm font-bold text-muted">
        {t('title')}
      </h2>
      {load.kind === 'error' ? (
        <div className="mt-2">
          <p className="text-ink">{t('error')}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="press mt-3 inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            {t('retry')}
          </button>
        </div>
      ) : load.year.orders === 0 ? (
        <div className="mt-2">
          <p className="text-ink">{t('empty')}</p>
          <Link
            href={`${prefix}/shop`}
            data-track="savings_empty_shop"
            className="press mt-3 inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            {t('emptyAction')}
          </Link>
        </div>
      ) : (
        <Figures t={t} year={load.year} month={load.month} override={override} />
      )}
    </section>
  );
}

function Figures({
  t,
  month,
  year,
  override,
}: {
  t: ReturnType<typeof useTranslations<'savings'>>;
  month: PeriodFigures;
  year: PeriodFigures;
  override: string | null;
}) {
  const rows = savingsRows(year);
  return (
    <>
      <p className="mt-2 font-heading text-lg font-extrabold text-ink">
        {savingsLineText(
          'savings.account',
          override,
          t('account', { amount: '{amount}' }),
          formatPrice(year.totalPaise),
        )}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-tile bg-success-bg p-4">
          <dt className="text-sm text-ink">{t('thisMonth')}</dt>
          <dd className="mt-1 font-heading text-2xl font-extrabold text-success tabular-nums">
            {formatPrice(month.totalPaise)}
          </dd>
        </div>
        <div className="rounded-tile bg-success-bg p-4">
          <dt className="text-sm text-ink">{t('thisYear')}</dt>
          <dd className="mt-1 font-heading text-2xl font-extrabold text-success tabular-nums">
            {formatPrice(year.totalPaise)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-muted">{t('orders', { count: year.orders })}</p>
      {rows.length > 0 ? (
        <details className="mt-2">
          <summary
            data-track="savings_breakdown"
            className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-accent-soft-text underline underline-offset-4"
          >
            {t('breakdown')}
          </summary>
          <dl className="mt-1 max-w-md space-y-1.5 text-sm">
            {rows.map((r) => (
              <div key={r.key} className="flex justify-between gap-3">
                <dt className="text-ink">{t(r.key)}</dt>
                <dd className="font-bold text-ink tabular-nums">{formatPrice(r.paise)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      <p className="mt-3 text-xs text-muted">{t('basis')}</p>
      {year.excludedLines > 0 ? (
        <p className="mt-1 text-xs text-muted">{t('excluded', { count: year.excludedLines })}</p>
      ) : null}
    </>
  );
}
