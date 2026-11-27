'use client';

import { DailyBars } from './analytics-charts';
import { ShopStaffPerformance, type ShopStaffPerformanceDto } from '@mechdost/shared/shop-staff-performance';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import {
  acceptTime,
  istDayLabel,
  percentOf,
  staffIsEmpty,
  staffKindKey,
  STAFF_DAYS_SHOWN,
} from '@/lib/shop-tools-view';
import { ApiError } from './api-list-state';
import { portalCard, portalQuiet } from './portal-styles';

type Days = 30 | 90;
type Member = ShopStaffPerformanceDto['members'][number];

/**
 * "Your team" for the shop owner and "Your work" for a staff member (design 2026-11-16; spec 07): per person, what was
 * accepted, packed, handed over, delivered and given up, the median time to accept and the on-time share, and, for the
 * owner, the shop's payout ledger (integer paise) by kind and by IST day. The API decides who sees what (an owner sees
 * everyone and the ledger, a staff member only their own row); this screen shows what it is given. Real API mode only,
 * loaded on demand by `shop-staff-performance-lazy.tsx` (JS budget). Changing the period keeps the old numbers on screen
 * until the new ones arrive (no jump); bars always carry their value as text.
 */
export function ShopStaffPerformanceApi({ shopId }: { shopId: string }) {
  const t = useTranslations('shopTier2');
  const locale = useLocale();
  const [data, setData] = useState<ShopStaffPerformanceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [days, setDays] = useState<Days>(30);
  // Answers can overtake each other when the period is changed quickly: only the newest request may write.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true);
    const res = await adminApi(
      locale,
      `/shop/staff-performance/${shopId}?days=${String(days)}`,
      ShopStaffPerformance,
    );
    if (mine !== seq.current) return;
    setBusy(false);
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else setError(res.code);
  }, [locale, shopId, days]);
  useEffect(() => {
    void load();
  }, [load]);

  const owner = data?.scope === 'owner';
  const id = `shop-staff-${shopId}`;
  const heading = data ? (owner ? t('staffTitleOwner') : t('staffTitleSelf')) : t('staffTitleOwner');

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className={portalCard}>
      <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        {heading}
      </h3>
      <p className="mt-1 text-sm text-muted">{owner ? t('staffLeadOwner') : t('staffLeadSelf')}</p>
      <div role="group" aria-label={t('perfWindow')} className="mt-3 flex flex-wrap items-center gap-2">
        {([30, 90] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => {
              setDays(d);
              track('click', { id: `shop_staff_perf_${String(d)}`, path: window.location.pathname });
            }}
            className={`${portalQuiet} ${days === d ? 'bg-pill' : ''}`}
          >
            {t(d === 30 ? 'perf30' : 'perf90')}
          </button>
        ))}
        {data ? (
          <span className="text-xs text-muted">
            {t('staffFrom', { date: istDayLabel(data.from, locale) })}
          </span>
        ) : null}
      </div>

      {!data && !error ? <div className="skeleton mt-4 h-40 rounded-card" aria-hidden="true" /> : null}
      {error ? (
        <div className="mt-4" role="alert">
          <ApiError code={error} />
          <button type="button" onClick={() => void load()} className={`${portalQuiet} mt-2`}>
            {t('staffRetry')}
          </button>
        </div>
      ) : null}
      {data && !error ? (
        <div className={`mt-4 space-y-5 ${busy ? 'opacity-70' : ''}`}>
          {staffIsEmpty(data) ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">{t('staffEmpty')}</p>
              {days === 30 ? (
                <button
                  type="button"
                  className={portalQuiet}
                  onClick={() => {
                    setDays(90);
                    track('click', { id: 'shop_staff_perf_90', path: window.location.pathname });
                  }}
                >
                  {t('staffShow90')}
                </button>
              ) : (
                <a href="#offered-title" className={portalQuiet}>
                  {t('staffSeeOrders')}
                </a>
              )}
            </div>
          ) : (
            <>
              {data.earnings ? <Earnings earnings={data.earnings} locale={locale} /> : null}
              <People data={data} />
              <p className="text-xs text-muted">{t('staffNote')}</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Earnings({
  earnings,
  locale,
}: {
  earnings: NonNullable<ShopStaffPerformanceDto['earnings']>;
  locale: string;
}) {
  const t = useTranslations('shopTier2');
  const days = earnings.byDay.slice(0, STAFF_DAYS_SHOWN);
  return (
    <div>
      <h4 className="text-sm font-extrabold text-ink">{t('staffEarnTitle')}</h4>
      <p className="text-xs text-muted">{t('staffEarnLead')}</p>
      {earnings.totalPaise === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('staffNoEarnings')}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">{t('staffEarnTotal')}</p>
          <p className="font-heading text-2xl font-extrabold text-ink">{formatPrice(earnings.totalPaise)}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {earnings.byKind.map((k) => (
              <li key={k.kind}>
                <span className="font-bold">{t(staffKindKey(k.kind))}: </span>
                {formatPrice(k.paise)}
                <span className="text-muted"> ({t('staffEntries', { count: k.entries })})</span>
              </li>
            ))}
          </ul>
          {/* Day-by-day bars in money green (design 2026-11-27 § 5.3; own SVG, Q-PP-F1), with a table view. */}
          <div className="mt-3">
            <DailyBars
              title={t('staffByDay')}
              days={days
                .toSorted((x, y) => x.day.localeCompare(y.day))
                .map((d) => ({ date: d.day, value: d.paise }))}
              format={(n) => formatPrice(n)}
              locale={locale}
              tone="success"
            />
          </div>
        </>
      )}
    </div>
  );
}

function People({ data }: { data: ShopStaffPerformanceDto }) {
  const t = useTranslations('shopTier2');
  return (
    <div>
      <h4 className="text-sm font-extrabold text-ink">{t('staffPeople')}</h4>
      <ul className="mt-2 space-y-3">
        {data.members.map((m) => (
          <li key={m.userId} className="rounded-lg border border-line-card p-3">
            <Stats
              title={
                <>
                  <span data-user-content className="font-bold text-ink">
                    {m.name ?? (m.role === 'owner' ? t('staffOwner') : t('staffUnnamed'))}
                  </span>
                  <span className="ml-2 rounded-full bg-pill px-2 py-0.5 text-xs font-bold text-ink">
                    {m.role === 'owner' ? t('staffOwner') : t('staffStaff')}
                  </span>
                  {m.isYou ? (
                    <span className="ml-2 text-xs font-bold text-muted">{t('staffYou')}</span>
                  ) : null}
                </>
              }
              m={m}
              hours={data.onTimeHours}
              ledgerLabel={data.scope === 'owner' ? t('staffLedgerOwner') : t('staffLedgerSelf')}
            />
          </li>
        ))}
        {data.shop ? (
          <li className="rounded-lg bg-pill p-3">
            <Stats
              title={<span className="font-bold text-ink">{t('staffWholeShop')}</span>}
              m={{ ...data.shop, deliveredLedgerPaise: 0 }}
              hours={data.onTimeHours}
              ledgerLabel={null}
            />
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Stats({
  title,
  m,
  hours,
  ledgerLabel,
}: {
  title: React.ReactNode;
  m: Pick<
    Member,
    | 'accepted'
    | 'packed'
    | 'handedOver'
    | 'delivered'
    | 'giveUps'
    | 'medianAcceptSeconds'
    | 'onTimeBp'
    | 'deliveredLedgerPaise'
  >;
  hours: number;
  ledgerLabel: string | null;
}) {
  const t = useTranslations('shopTier2');
  const none = t('perfNoData');
  const time = (s: number | null) => {
    if (s === null) return none;
    const a = acceptTime(s);
    return t(a.unit === 'seconds' ? 'perfSeconds' : 'perfMinutes', { count: a.count });
  };
  const cells: [string, string][] = [
    [t('staffAccepted'), String(m.accepted)],
    [t('staffPacked'), String(m.packed)],
    [t('staffHandedOver'), String(m.handedOver)],
    [t('staffDelivered'), String(m.delivered)],
    [t('staffGiveUps'), String(m.giveUps)],
    [t('staffAcceptTime'), time(m.medianAcceptSeconds)],
    [t('staffOnTime', { hours }), m.onTimeBp === null ? none : `${String(percentOf(m.onTimeBp))}%`],
  ];
  if (ledgerLabel) cells.push([ledgerLabel, formatPrice(m.deliveredLedgerPaise)]);
  return (
    <>
      <p className="flex flex-wrap items-center">{title}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-bold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
