'use client';

import { ShopPerformance, type ShopPerformanceDto } from '@mechdost/shared/shop-tools';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { acceptTime, barWidth, percentOf, ratingText } from '@/lib/shop-tools-view';
import { ApiError } from './api-list-state';
import { portalCard, portalQuiet } from './portal-styles';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; data: ShopPerformanceDto };
type Window = ShopPerformanceDto['windows'][number];

/**
 * "How your shop is doing" (design 2026-11-15, item 6; spec 07), owner only. Last 30 or 90 days: acceptance, median
 * time to accept, give-ups, on-time hand-over and ratings, each next to the anonymous middle of the other shops in the
 * city (hidden when fewer than five other shops have a value; the API decides). Bars are drawn in SVG with the value
 * written beside every bar, so colour is never the only signal; "You" is the accent, "City middle" the ink colour.
 * Real API mode only; own module (JS budget).
 */
export function ShopPerformanceApi({ shopId }: { shopId: string }) {
  const t = useTranslations('shopTier2');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [days, setDays] = useState<30 | 90>(30);
  const id = `shop-perf-${shopId}`;

  const reload = useCallback(async () => {
    const res = await adminApi(locale, `/shop/performance/${shopId}`, ShopPerformance);
    setLoad(res.ok ? { kind: 'ok', data: res.data } : { kind: 'error', code: res.code });
  }, [locale, shopId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const w = load.kind === 'ok' ? load.data.windows.find((x) => x.days === days) : undefined;

  return (
    <section aria-labelledby={`${id}-title`} id="shop-performance" className={portalCard}>
      <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('perfTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('perfLead')}</p>
      <div role="group" aria-label={t('perfWindow')} className="mt-3 flex gap-2">
        {([30, 90] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => {
              setDays(d);
              track('click', { id: `shop_perf_${String(d)}`, path: window.location.pathname });
            }}
            className={`${portalQuiet} ${days === d ? 'bg-pill' : ''}`}
          >
            {t(d === 30 ? 'perf30' : 'perf90')}
          </button>
        ))}
      </div>

      {load.kind === 'loading' ? (
        <div className="skeleton mt-4 h-40 rounded-card" aria-hidden="true" />
      ) : null}
      {load.kind === 'error' ? (
        <div className="mt-4">
          <ApiError code={load.code} />
          <button type="button" onClick={() => void reload()} className={`${portalQuiet} mt-2`}>
            {t('perfError')}
          </button>
        </div>
      ) : null}
      {w && load.kind === 'ok' ? <Metrics w={w} hours={load.data.onTimeHours} /> : null}
    </section>
  );
}

function Metrics({ w, hours }: { w: Window; hours: number }) {
  const t = useTranslations('shopTier2');
  const { mine, city } = w;
  const none = t('perfNoData');
  const time = (s: number | null) => {
    if (s === null) return none;
    const a = acceptTime(s);
    return t(a.unit === 'seconds' ? 'perfSeconds' : 'perfMinutes', { count: a.count });
  };
  const rate = (bp: number | null) => (bp === null ? none : `${String(percentOf(bp))}%`);
  const stars = (x: number | null) => ratingText(x) ?? none;

  return (
    <div className="mt-4 space-y-5">
      <div className="flex flex-wrap gap-4 text-xs font-bold text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm bg-accent-button" />
          {t('perfYou')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm bg-ink" />
          {t('perfCity')}
        </span>
      </div>
      <Row
        label={t('perfAcceptance')}
        sub={t('perfOfOffers', { count: mine.offers })}
        mine={{ text: rate(mine.acceptanceBp), bp: mine.acceptanceBp }}
        city={city ? { text: rate(city.acceptanceBp), bp: city.acceptanceBp } : null}
      />
      <Row
        label={t('perfOnTime')}
        sub={t('perfOnTimeNote', { hours })}
        mine={{ text: rate(mine.onTimeBp), bp: mine.onTimeBp }}
        city={city ? { text: rate(city.onTimeBp), bp: city.onTimeBp } : null}
      />
      <Row
        label={t('perfGiveUps')}
        sub={`${t('perfOrders', { count: mine.giveUps })} · ${t('perfLower')}`}
        mine={{ text: rate(mine.giveUpBp), bp: mine.giveUpBp }}
        city={city ? { text: rate(city.giveUpBp), bp: city.giveUpBp } : null}
      />
      <div>
        <h4 className="text-sm font-extrabold text-ink">{t('perfTime')}</h4>
        <p className="mt-1 text-sm text-ink">
          <span className="font-bold">{t('perfYou')}: </span>
          {time(mine.medianAcceptSeconds)}
          {city ? (
            <>
              {' · '}
              <span className="font-bold">{t('perfCity')}: </span>
              {time(city.medianAcceptSeconds)}
            </>
          ) : null}
          <span className="text-muted"> · {t('perfLower')}</span>
        </p>
      </div>
      <div>
        <h4 className="text-sm font-extrabold text-ink">{t('perfRating')}</h4>
        <p className="mt-1 text-sm text-ink">
          <span className="font-bold">{t('perfYou')}: </span>
          {stars(mine.ratingX100)}
          {mine.ratingCount > 0 ? (
            <span className="text-muted"> ({t('perfReviews', { count: mine.ratingCount })})</span>
          ) : null}
          {city ? (
            <>
              {' · '}
              <span className="font-bold">{t('perfCity')}: </span>
              {stars(city.ratingX100)}
            </>
          ) : null}
        </p>
      </div>
      {city === null ? <p className="text-xs text-muted">{t('perfNoCity')}</p> : null}
    </div>
  );
}

function Row({
  label,
  sub,
  mine,
  city,
}: {
  label: string;
  sub: string;
  mine: { text: string; bp: number | null };
  city: { text: string; bp: number | null } | null;
}) {
  const t = useTranslations('shopTier2');
  const bars = [
    { name: t('perfYou'), ...mine, cls: 'fill-accent-button' },
    ...(city ? [{ name: t('perfCity'), ...city, cls: 'fill-ink' }] : []),
  ];
  return (
    <div>
      <h4 className="text-sm font-extrabold text-ink">{label}</h4>
      <p className="text-xs text-muted">{sub}</p>
      <ul className="mt-1 space-y-1">
        {bars.map((b) => (
          <li key={b.name} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 text-sm">
            <span className="truncate text-muted">{b.name}</span>
            <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden="true">
              <rect width="100" height="8" rx="2" className="fill-line-card" />
              <rect width={barWidth(b.bp)} height="8" rx="2" className={b.cls} />
            </svg>
            <span className="text-right font-bold text-ink">{b.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
