'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { adjustCoins, coinBalanceOf, useCoinEntries } from '@/demo/coins';
import { findAccount, normalisePhone, useAccounts } from '@/demo/session';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { portalCard, portalField, portalPrimary } from './portal-guard';

/**
 * Admin coins desk (spec 20, permission `coins:adjust`): grant or deduct MechDost Coins for one customer with a
 * reason, and see recent coin activity. Earning rules are added here once the owner decides them (inbox Q24).
 */
export function AdminCoins({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const entries = useCoinEntries().slice(0, 15);
  const accounts = useAccounts();
  const [error, setError] = useState<{ message: string; field: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    setDone(null);
    const phone = normalisePhone(text('phone'));
    const account = phone ? findAccount(phone) : undefined;
    if (account?.role !== 'customer') {
      setError({ message: t('coinsErrCustomer'), field: 'coins-phone' });
      document.getElementById('coins-phone')?.focus();
      return;
    }
    const amount = Number(text('amount'));
    const delta = text('direction') === 'remove' ? -amount : amount;
    const result = adjustCoins(account.id, delta, text('reason'), actor);
    if (!result.ok) {
      const field = result.reason === 'reason' ? 'coins-reason' : 'coins-amount';
      setError({
        message: t(`coinsErr_${result.reason}`, { balance: coinBalanceOf(account.id) }),
        field,
      });
      document.getElementById(field)?.focus();
      return;
    }
    setError(null);
    setDone(t('coinsDone', { name: account.name, balance: coinBalanceOf(account.id) }));
    track('click', {
      id: delta > 0 ? 'admin_coins_granted' : 'admin_coins_removed',
      path: window.location.pathname,
    });
    form.reset();
  }

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const invalid = (f: string) => (error?.field === f ? true : undefined);

  return (
    <section aria-labelledby="coins-admin-title" className="space-y-4">
      <div>
        <h2 id="coins-admin-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_coins')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('coinsAdminLead')}</p>
      </div>
      <p className="rounded-lg bg-private-bg p-3 text-sm text-private">{t('coinsRulesPending')}</p>

      <form noValidate onSubmit={onSubmit} className={portalCard}>
        <h3 className="font-heading text-lg font-extrabold text-ink">{t('coinsAdjustTitle')}</h3>
        <div className="mt-3 grid gap-4 tab:grid-cols-2">
          <div>
            <label htmlFor="coins-phone" className="text-sm font-bold text-ink">
              {t('coinsPhone')}
            </label>
            <input
              id="coins-phone"
              name="phone"
              inputMode="numeric"
              maxLength={14}
              aria-invalid={invalid('coins-phone')}
              aria-describedby={error?.field === 'coins-phone' ? 'coins-error' : undefined}
              className={portalField}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-bold text-ink">{t('coinsDirection')}</legend>
            <div className="mt-1 flex gap-4">
              {(['add', 'remove'] as const).map((d) => (
                <label key={d} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="direction"
                    value={d}
                    defaultChecked={d === 'add'}
                    className="size-5 accent-[var(--color-accent-button)]"
                  />
                  {t(`coinsDirection_${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="coins-amount" className="text-sm font-bold text-ink">
              {t('coinsAmount')}
            </label>
            <input
              id="coins-amount"
              name="amount"
              inputMode="numeric"
              maxLength={6}
              aria-invalid={invalid('coins-amount')}
              aria-describedby={error?.field === 'coins-amount' ? 'coins-error' : undefined}
              className={portalField}
            />
          </div>
          <div>
            <label htmlFor="coins-reason" className="text-sm font-bold text-ink">
              {t('coinsReason')}
            </label>
            <input
              id="coins-reason"
              name="reason"
              maxLength={200}
              aria-invalid={invalid('coins-reason')}
              aria-describedby={error?.field === 'coins-reason' ? 'coins-error' : undefined}
              className={portalField}
            />
          </div>
        </div>
        {error ? (
          <p id="coins-error" role="alert" className="mt-3 text-sm font-bold text-error">
            {error.message}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" className={portalPrimary}>
            {t('coinsSave')}
          </button>
          <p role="status" className="text-sm font-bold text-success">
            {done ?? ''}
          </p>
        </div>
      </form>

      <section aria-labelledby="coins-activity" className={portalCard}>
        <h3 id="coins-activity" className="font-heading text-lg font-extrabold text-ink">
          {t('coinsActivity')}
        </h3>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('coinsActivityEmpty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span className="min-w-0 text-ink">
                  <span data-user-content className="font-bold">
                    {nameOf(e.accountId)}
                  </span>{' '}
                  · {t(`coinsKind_${e.kind}`)} ·{' '}
                  {e.orderCode ? (
                    <span className="text-muted">{e.orderCode}</span>
                  ) : e.kind === 'adjust' ? (
                    <span data-user-content className="text-muted">
                      {e.reason}
                    </span>
                  ) : (
                    <span className="text-muted">{t('coinsReasonSeed')}</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">{formatDate(e.at, locale)}</span>
                  <span
                    className={`font-heading font-extrabold tabular-nums ${e.delta > 0 ? 'text-success' : 'text-ink'}`}
                  >
                    {e.delta > 0 ? '+' : '−'}
                    {Math.abs(e.delta)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
