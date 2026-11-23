'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { MyRefund } from '@mechdost/shared/refunds-api';
import { track } from '@/lib/analytics';
import { fetchMyRefunds } from '@/lib/my-refunds-api';
import { RefundsFrame, RefundsList } from './refunds-list';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';

/**
 * Account → Refunds on the API (real data mode; spec 05): the customer's own refunds, newest first, "Show more" by
 * cursor. Loaded only when the section opens (`React.lazy` in the account area).
 */
export function RefundsSectionApi() {
  const t = useTranslations('myRefunds');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [refunds, setRefunds] = useState<MyRefund[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState<'idle' | 'busy' | 'error'>('idle');

  const load = useCallback(async () => {
    setState('loading');
    const page = await fetchMyRefunds(locale);
    if (!page.ok) {
      setState('error');
      return;
    }
    setRefunds(page.data.refunds);
    setCursor(page.data.nextCursor);
    setState('ready');
    track('my_refunds_viewed', {
      count: page.data.refunds.length,
      inProgress: page.data.refunds.filter((r) => r.stage !== 'completed' && r.stage !== 'declined').length,
    });
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setMore('busy');
    const page = await fetchMyRefunds(locale, cursor);
    if (!page.ok) {
      setMore('error');
      return;
    }
    setRefunds((prev) => [...prev, ...page.data.refunds]);
    setCursor(page.data.nextCursor);
    setMore('idle');
  }

  if (state === 'loading')
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{t('loading')}</span>
        <div className="skeleton h-72 rounded-card" aria-hidden="true" />
      </div>
    );
  if (state === 'error')
    return (
      <div role="alert" className={card}>
        <p className="text-sm font-bold text-ink">{t('loadError')}</p>
        <button type="button" onClick={() => void load()} className={`${quiet} mt-3`}>
          {t('retry')}
        </button>
      </div>
    );

  return (
    <RefundsFrame>
      {refunds.length === 0 ? (
        <section className={`${card} text-center`}>
          <h3 className="font-heading text-lg font-extrabold text-ink">{t('emptyTitle')}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t('emptyBody')}</p>
          <Link
            href={`${prefix}/account/orders`}
            data-track="my_refunds_empty_orders"
            className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {t('emptyAction')}
          </Link>
        </section>
      ) : (
        <RefundsList refunds={refunds} linkTargets />
      )}
      {cursor ? (
        <div className="text-center">
          <button
            type="button"
            data-track="my_refunds_more"
            disabled={more === 'busy'}
            onClick={() => void loadMore()}
            className={quiet}
          >
            {t('loadMore')}
          </button>
          {more === 'error' ? (
            <p role="alert" className="mt-2 text-sm text-muted">
              {t('loadError')}
            </p>
          ) : null}
        </div>
      ) : null}
    </RefundsFrame>
  );
}
