'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { savingsLineText } from '@mechdost/shared/content';
import { savingsBand } from '@mechdost/shared/savings';
import type { OrderSavingsViewDto } from '@mechdost/shared/savings-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { savingsRows } from '@/lib/savings-view';

/**
 * "Your savings" on the order page (decision 2026-11-26): "You saved ₹X vs the maker's printed MRP on this order" with
 * the components that saved something. Final after delivery (net of refunds), an estimate while a part is on its way;
 * nothing when the admin switched it off, the order was cancelled, or nothing was saved. Its own lazy chunk.
 */
export interface Figures {
  status: 'final' | 'estimate' | 'none';
  mrpPaise: number;
  couponPaise: number;
  coinsPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  excludedLines: number;
  refunded: boolean;
}

export function OrderSavingsPanel({
  figures,
  override,
  headingLevel = 2,
}: {
  figures: Figures;
  override: string | null;
  /** 2 on the real-mode order page; 3 inside the demo page's "Status" section (accessibility review). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const t = useTranslations('savings');
  const seen = useRef('');
  const state = figures.status === 'final' ? 'final' : 'estimate';
  useEffect(() => {
    const key = `${state}:${String(figures.totalPaise)}`;
    if (seen.current === key) return;
    seen.current = key;
    track('savings_viewed', {
      surface: 'order',
      state,
      band: savingsBand(figures.totalPaise),
      excluded: Math.min(figures.excludedLines, 99),
    });
  }, [state, figures.totalPaise, figures.excludedLines]);
  const amount = formatPrice(figures.totalPaise);
  const headline =
    state === 'final'
      ? savingsLineText('savings.order', override, t('order', { amount: '{amount}' }), amount)
      : t('orderEstimate', { amount });
  const rows = savingsRows(figures);
  return (
    <section aria-labelledby="order-savings" className="rounded-card bg-success-bg p-5 tab:p-6">
      {/* A short, stable heading; the sentence with the amount is the text under it (accessibility review). */}
      <Heading id="order-savings" className="text-sm font-bold text-ink">
        {t('title')}
      </Heading>
      <p className="mt-1 font-heading text-base font-extrabold text-success">{headline}</p>
      {rows.length > 0 ? (
        <dl className="mt-3 max-w-md space-y-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.key} className="flex justify-between gap-3">
              <dt className="text-ink">{t(r.key)}</dt>
              <dd className="font-bold text-ink tabular-nums">{formatPrice(r.paise)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {state === 'estimate' ? <p className="mt-3 text-xs text-ink">{t('estimateNote')}</p> : null}
      {figures.refunded ? <p className="mt-2 text-xs text-ink">{t('refunded')}</p> : null}
      {figures.excludedLines > 0 ? (
        <p className="mt-2 text-xs text-ink">{t('excluded', { count: figures.excludedLines })}</p>
      ) : null}
    </section>
  );
}

export const shown = (f: Figures | null): f is Figures =>
  f !== null && f.status !== 'none' && f.totalPaise > 0;

/** Real data mode: `GET /v1/me/orders/{code}/savings`, again whenever a part's status changes (`version`). */
export function OrderSavingsApi({
  code,
  version,
  override,
}: {
  code: string;
  version: string;
  override: string | null;
}) {
  const locale = useLocale();
  const [figures, setFigures] = useState<Figures | null>(null);
  useEffect(() => {
    let live = true;
    void import('@/lib/savings-api').then(async ({ fetchOrderSavings }) => {
      const res = await fetchOrderSavings(locale, code);
      if (!live) return;
      // A failure or the switch off shows nothing: savings are good news, never a reason to break the order page.
      setFigures(res.ok && res.data.enabled ? (res.data satisfies OrderSavingsViewDto) : null);
    });
    return () => {
      live = false;
    };
  }, [code, locale, version]);
  return shown(figures) ? <OrderSavingsPanel figures={figures} override={override} /> : null;
}
