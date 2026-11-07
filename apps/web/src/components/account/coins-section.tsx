'use client';

import { Coins } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCoins, type CoinEntry } from '@/demo/coins';
import type { DemoAccount } from '@/demo/session';
import { useSiteSettings } from '@/demo/site-config';
import { formatDate, formatPrice } from '@/lib/format';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';

/**
 * MechDost Coins in the account (spec 20): balance, the fixed rules (no cash value) and history. Ways to earn are
 * set later by the owner (inbox Q24), so the page says they are coming instead of inventing rules.
 */
export function CoinsSection({ account }: { account: DemoAccount }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const settings = useSiteSettings();
  const { balance, entries } = useCoins(account.id);
  const prefix = locale === 'hi' ? '/hi' : '';
  const percent = settings.coinMaxRedeemBp / 100;

  return (
    <div className="space-y-6">
      <section aria-labelledby="coins-title" className="blueprint rounded-card p-6 text-white tab:p-8">
        <h2 id="coins-title" className="eyebrow text-accent-light">
          {t('nav_coins')}
        </h2>
        <p className="mt-3 flex items-baseline gap-3">
          <Coins
            aria-hidden="true"
            className="size-9 shrink-0 self-center text-accent-light"
            strokeWidth={1.75}
          />
          <span className="font-heading text-[44px] leading-none font-extrabold tabular-nums">{balance}</span>
          <span className="text-hero-copy">{t('coinsUnit')}</span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-hero-copy">
          {t('coinsLead', { value: formatPrice(settings.coinValuePaise), percent })}
        </p>
        <Link
          href={`${prefix}/shop`}
          data-track="account_coins_shop"
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('coinsShop')}
        </Link>
      </section>

      <section aria-labelledby="coins-rules" className={card}>
        <h2 id="coins-rules" className="font-heading text-lg font-extrabold text-ink">
          {t('coinsRulesTitle')}
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-ink">
          {[
            t('coinsRule1', { value: formatPrice(settings.coinValuePaise) }),
            t('coinsRule2', { percent }),
            t('coinsRule3'),
            t('coinsRule4'),
          ].map((rule) => (
            <li key={rule} className="flex gap-2">
              <span aria-hidden="true">•</span>
              {rule}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-lg bg-surface-alt px-3 py-2 text-sm text-muted">{t('coinsEarnSoon')}</p>
      </section>

      <section aria-labelledby="coins-history" className={card}>
        <h2 id="coins-history" className="font-heading text-lg font-extrabold text-ink">
          {t('coinsHistory')}
        </h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('coinsHistoryEmpty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="min-w-0">
                  {/* A staff adjustment carries the reason staff typed (user content). */}
                  <span
                    data-user-content={e.kind === 'adjust' ? true : undefined}
                    className="block font-bold text-ink"
                  >
                    {describe(e, t)}
                  </span>
                  <span className="block text-xs text-muted">{formatDate(e.at, locale)}</span>
                </span>
                <span
                  className={`shrink-0 font-heading font-extrabold tabular-nums ${e.delta > 0 ? 'text-success' : 'text-ink'}`}
                >
                  {e.delta > 0 ? '+' : '−'}
                  {Math.abs(e.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function describe(e: CoinEntry, t: ReturnType<typeof useTranslations<'account'>>): string {
  switch (e.kind) {
    case 'redeem':
      return t('coinsUsed', { code: e.orderCode ?? '' });
    case 'restore':
      return t('coinsRestored', { code: e.orderCode ?? '' });
    case 'adjust':
      return e.delta > 0 ? t('coinsAdded', { reason: e.reason }) : t('coinsRemoved', { reason: e.reason });
    default:
      return e.reason === 'Demo coins' ? t('coinsDemo') : t('coinsEarned', { reason: e.reason });
  }
}
