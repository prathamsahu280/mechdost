'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { DailyBars } from '@/components/partner';
import { payoutBars } from '@/lib/delivery/agent-stats-view';
import type { AgentDailyStatsDto, AgentEarningsView } from '@/lib/delivery/types';
import { useLiveReload } from '@/lib/delivery/use-delivery-client';
import { formatPrice } from '@/lib/format';
import { useAgent } from './agent-portal';

const STATS_DAYS = 14;

/**
 * The rider's earnings numbers (design 2026-11-27 § 7): the net "Paid to you" (corrections included; the rows below
 * still list each payment and correction) and jobs delivered as two tiles, then the net paid per payout period as
 * money-green bars (every chart also as a table).
 */
export function EarningsNumbers({ data }: { data: AgentEarningsView }) {
  const t = useTranslations('partnerRider');
  const locale = useLocale();
  const bars = payoutBars(data.payouts);
  const net = data.totalPaise;
  return (
    <div className="mt-3 grid gap-3">
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-card bg-success-bg p-3">
          <dt className="text-sm font-bold text-ink">{t('earn_total')}</dt>
          <dd className="mt-1 font-heading text-[28px] leading-none font-extrabold text-success tabular-nums">
            {net < 0 ? `− ${formatPrice(-net)}` : formatPrice(net)}
          </dd>
        </div>
        <div className="rounded-card bg-info-bg p-3">
          <dt className="text-sm font-bold text-ink">{t('earn_jobs')}</dt>
          <dd className="mt-1 font-heading text-[28px] leading-none font-extrabold text-info tabular-nums">
            {data.deliveredJobs}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted">{t('earn_total_hint')}</p>
      {bars.length > 1 ? (
        <DailyBars
          title={t('earn_chart')}
          days={bars}
          format={(n) => formatPrice(n)}
          locale={locale}
          tone="success"
        />
      ) : null}
    </div>
  );
}

/** Delivered jobs per IST day for the last two weeks (`GET /v1/agent/me/stats`, Q-PP-F5), in the count blue. */
export function DeliveredChart() {
  const t = useTranslations('partnerRider');
  const locale = useLocale();
  const ctx = useAgent();
  const [data, setData] = useState<AgentDailyStatsDto | null>(null);
  const client = ctx?.client ?? null;
  const reload = useCallback(() => {
    if (!client) return;
    void client.stats(STATS_DAYS).then((r) => {
      if (r.ok) setData(r.data);
    });
  }, [client]);
  useLiveReload(client, reload, 120_000);
  if (!data) return <div className="skeleton mt-3 h-56 rounded-card" aria-hidden="true" />;
  return (
    <div className="mt-3">
      <DailyBars
        title={t('stats_chart', { days: STATS_DAYS })}
        days={data.days.map((d) => ({ date: d.date, value: d.delivered }))}
        format={(n) => new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(n)}
        locale={locale}
        tone="info"
      />
    </div>
  );
}
