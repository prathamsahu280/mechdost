'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { CoinEntryView, MyCoinsView } from '@mechdost/shared/coins-api';
import { fetchMyCoinLedger, fetchMyCoins } from '@/lib/coins-api';
import { coinEntryLabel } from '@/lib/coins-view';
import { formatDate, formatPrice } from '@/lib/format';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';

/**
 * Account → MechDost Coins on the API (real data mode; spec 20): balance, coins on the way (usable after the unlock
 * days), the next expiry, how coins work with the admin's current rules, and the history (cursor "Show more").
 * Coins have no cash value: the rules say so, and nothing here offers money.
 */
export function CoinsSectionApi() {
  const t = useTranslations('account');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  const [coins, setCoins] = useState<MyCoinsView | null>(null);
  const [entries, setEntries] = useState<CoinEntryView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState<'idle' | 'busy' | 'error'>('idle');

  const load = useCallback(async () => {
    setState('loading');
    const [summary, page] = await Promise.all([fetchMyCoins(locale), fetchMyCoinLedger(locale)]);
    if (!summary.ok || !page.ok) {
      setState('error');
      return;
    }
    setCoins(summary.data);
    setEntries(page.data.entries);
    setCursor(page.data.nextCursor);
    setState('ready');
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setMore('busy');
    const page = await fetchMyCoinLedger(locale, cursor);
    if (!page.ok) {
      setMore('error');
      return;
    }
    setEntries((prev) => [...prev, ...page.data.entries]);
    setCursor(page.data.nextCursor);
    setMore('idle');
  }

  if (state === 'loading') return <div className="skeleton h-72 rounded-card" aria-hidden="true" />;
  if (state === 'error' || !coins)
    return (
      <div role="alert" className={card}>
        <p className="text-sm font-bold text-ink">{t('coins_api_error')}</p>
        <button type="button" onClick={() => void load()} className={`${quiet} mt-3`}>
          {t('coins_api_retry')}
        </button>
      </div>
    );

  const r = coins.rules;
  const value = formatPrice(r.coinValuePaise);
  const percent = r.maxRedeemBp / 100;
  const earnRules = [
    r.earnOrderBp > 0 ? t('coins_api_earn_order', { percent: r.earnOrderBp / 100 }) : null,
    r.firstOrderBonus > 0 ? t('coins_api_earn_first', { coins: r.firstOrderBonus }) : null,
    r.workshopBookingBonus > 0 ? t('coins_api_earn_workshop', { coins: r.workshopBookingBonus }) : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="space-y-6">
      <section aria-labelledby="coins-title" className="blueprint rounded-card p-6 text-white tab:p-8">
        <h2 id="coins-title" className="eyebrow text-accent-light">
          {t('nav_coins')}
        </h2>
        <p className="mt-3 flex items-baseline gap-3">
          <span aria-hidden="true" className="text-[36px] leading-none">
            🪙
          </span>
          <span className="font-heading text-[44px] leading-none font-extrabold tabular-nums">
            {coins.balance}
          </span>
          <span className="text-hero-copy">{t('coinsUnit')}</span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-hero-copy">{t('coinsLead', { value, percent })}</p>
        {coins.nextExpiry ? (
          <p className="mt-2 text-sm text-hero-copy">
            {t('coins_api_expiring', {
              coins: coins.nextExpiry.coins,
              date: formatDate(coins.nextExpiry.at, locale),
            })}
          </p>
        ) : null}
        <Link
          href={`${prefix}/shop`}
          data-track="account_coins_shop"
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('coinsShop')}
        </Link>
      </section>

      {coins.pending.length > 0 ? (
        <section aria-labelledby="coins-pending" className={card}>
          <h2 id="coins-pending" className="font-heading text-lg font-extrabold text-ink">
            {t('coins_api_pending_title', { coins: coins.pendingCoins })}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('coins_api_pending_lead', { days: r.unlockDays })}</p>
          <ul className="mt-3 divide-y divide-line">
            {coins.pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-bold text-ink">
                    {t(`coins_api_source_${p.source}`, { code: p.orderCode ?? '' })}
                  </span>
                  <span className="block text-xs text-muted">
                    {t('coins_api_pending_on', { date: formatDate(p.availableAt, locale) })}
                  </span>
                </span>
                <span className="shrink-0 font-heading font-extrabold text-muted tabular-nums">
                  +{p.coins}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="coins-rules" className={card}>
        <h2 id="coins-rules" className="font-heading text-lg font-extrabold text-ink">
          {t('coinsRulesTitle')}
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-ink">
          {[
            t('coinsRule1', { value }),
            t('coinsRule2', { percent }),
            ...earnRules,
            ...(earnRules.length > 0 ? [t('coins_api_rule_unlock', { days: r.unlockDays })] : []),
            t('coins_api_rule_expiry', { days: r.expiryDays }),
            t('coinsRule3'),
            t('coinsRule4'),
          ].map((rule) => (
            <li key={rule} className="flex gap-2">
              <span aria-hidden="true">•</span>
              {rule}
            </li>
          ))}
        </ul>
        {earnRules.length === 0 ? (
          <p className="mt-4 rounded-lg bg-surface-alt px-3 py-2 text-sm text-muted">{t('coinsEarnSoon')}</p>
        ) : null}
      </section>

      <section aria-labelledby="coins-history" className={card}>
        <h2 id="coins-history" className="font-heading text-lg font-extrabold text-ink">
          {t('coinsHistory')}
        </h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('coinsHistoryEmpty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {entries.map((e) => {
              const label = coinEntryLabel(e);
              return (
                <li key={e.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-bold text-ink">
                      {t(label.key, { code: label.code, reason: label.reason ? t(label.reason) : '' })}
                    </span>
                    {/* A staff note is written by a person (user content, hard rule 10 allowlist). */}
                    {e.note ? (
                      <span data-user-content className="block text-xs text-ink">
                        {e.note}
                      </span>
                    ) : null}
                    <span className="block text-xs text-muted">{formatDate(e.createdAt, locale)}</span>
                  </span>
                  <span
                    className={`shrink-0 font-heading font-extrabold tabular-nums ${e.delta > 0 ? 'text-success' : 'text-ink'}`}
                  >
                    {e.delta > 0 ? '+' : '−'}
                    {Math.abs(e.delta)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {cursor ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={more === 'busy'}
            className={`${quiet} mt-4`}
          >
            {more === 'busy' ? t('coins_api_loading') : t('coins_api_more')}
          </button>
        ) : null}
        {more === 'error' ? (
          <p role="alert" className="mt-2 text-sm font-bold text-error">
            {t('coins_api_error')}
          </p>
        ) : null}
      </section>
    </div>
  );
}
