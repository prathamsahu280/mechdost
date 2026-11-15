'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  AdminCoinAccountDto,
  AdminCoinActivityDto,
  CoinAdjustedDto,
  type AdminCoinAccountView,
  type AdminCoinActivityView,
  type CoinEntryView,
} from '@mechdost/shared/coins-api';
import { COIN_ADJUST_REASONS, type CoinAdjustReason } from '@mechdost/shared/coins';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { adjustDeltaFrom, coinEntryLabel, coinErrorKey, type CoinErrorKey } from '@/lib/coins-view';
import { customerIdFrom } from '@/lib/customer-blocks-view';
import { formatDate } from '@/lib/format';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

type ErrorText = CoinErrorKey | CommonErrorKey | 'coins_api_err_reason';
const errorOf = (code: string): ErrorText => coinErrorKey(code) ?? commonErrorKey(code);
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const isReason = (v: string): v is CoinAdjustReason => (COIN_ADJUST_REASONS as readonly string[]).includes(v);

/**
 * Admin → Coins on the API (real sign-in builds; spec 20). Staff with `coins:read` open a customer by account id
 * (or from recent activity) and see the balance, coins on the way and history; `coins:adjust` grants or deducts
 * with a reason code (never preselected) and an optional note the customer sees. Each change carries the account
 * version the screen showed and one Idempotency-Key per attempt, so a double tap applies once. Coin rules live in
 * Admin → Settings (`coins:rules`).
 */
export function AdminCoinsApi() {
  const t = useTranslations('portal');
  const [raw, setRaw] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [idError, setIdError] = useState(false);

  function open(id: string) {
    setRaw(id);
    setIdError(false);
    setUserId(id);
  }

  function onFind(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = customerIdFrom(raw);
    setIdError(id === null);
    if (id === null) {
      document.getElementById('api-coins-id')?.focus();
      return;
    }
    setUserId(id);
  }

  return (
    <section aria-labelledby="coins-admin-title" className="space-y-4">
      <div>
        <h2 id="coins-admin-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_coins')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('coins_api_lead')}</p>
      </div>
      <form onSubmit={onFind} className={portalCard} noValidate>
        <label htmlFor="api-coins-id" className="text-sm font-bold text-ink">
          {t('api_block_id_label')}
        </label>
        <p id="api-coins-id-help" className="text-xs text-muted">
          {t('coins_api_id_help')}
        </p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <input
            id="api-coins-id"
            value={raw}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            aria-invalid={idError ? true : undefined}
            aria-describedby={`api-coins-id-help${idError ? ' api-coins-id-error' : ''}`}
            onChange={(e) => {
              setRaw(e.target.value);
            }}
            className={`${portalField} max-w-md`}
          />
          <button type="submit" className={portalPrimary}>
            {t('api_block_open')}
          </button>
        </div>
        {idError ? (
          <p id="api-coins-id-error" className="mt-1 text-sm font-bold text-error">
            {t('api_block_id_error')}
          </p>
        ) : null}
      </form>
      {userId ? <CoinAccount key={userId} userId={userId} /> : null}
      <Activity onOpen={open} />
    </section>
  );
}

function EntryRow({ e, extra }: { e: CoinEntryView; extra?: ReactNode }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const label = coinEntryLabel(e);
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block font-bold text-ink">
          {t(label.key, { code: label.code, reason: label.reason ? t(label.reason) : '' })}
        </span>
        {e.note ? (
          <span data-user-content className="block text-xs text-ink">
            {e.note}
          </span>
        ) : null}
        <span className="block text-xs text-muted">{formatDate(e.createdAt, locale)}</span>
        {extra}
      </span>
      <span
        className={`shrink-0 font-heading font-extrabold tabular-nums ${e.delta > 0 ? 'text-success' : 'text-ink'}`}
      >
        {e.delta > 0 ? '+' : '−'}
        {Math.abs(e.delta)}
      </span>
    </li>
  );
}

function CoinAccount({ userId }: { userId: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [acct, setAcct] = useState<AdminCoinAccountView | null>(null);
  const [loadError, setLoadError] = useState<ErrorText | null>(null);
  const [error, setError] = useState<{ text: ErrorText; field: string } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt: a retry after a lost answer applies once; a new attempt gets a new key.
  const attempt = useRef<string | null>(null);
  const idBase = `api-coins-${userId}`;

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/coins/accounts/${userId}`, AdminCoinAccountDto);
    if (!res.ok) {
      setLoadError(errorOf(res.code));
      return;
    }
    setLoadError(null);
    setAcct(res.data);
  }, [locale, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdjust(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acct) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const direction = text(data.get('direction'));
    const delta = adjustDeltaFrom(direction, text(data.get('amount')));
    const reasonCode = text(data.get('reason'));
    const note = text(data.get('note')).trim();
    setDone(null);
    if (delta === null) {
      setError({ text: 'coins_api_err_amount', field: `${idBase}-amount` });
      document.getElementById(`${idBase}-amount`)?.focus();
      return;
    }
    if (!isReason(reasonCode)) {
      setError({ text: 'coins_api_err_reason', field: `${idBase}-reason` });
      document.getElementById(`${idBase}-reason`)?.focus();
      return;
    }
    if (note.length > 0 && (note.length < 3 || note.length > 200)) {
      setError({ text: 'coins_api_err_note', field: `${idBase}-note` });
      document.getElementById(`${idBase}-note`)?.focus();
      return;
    }
    if (delta < 0 && -delta > acct.balance) {
      setError({ text: 'coins_api_err_balance', field: `${idBase}-amount` });
      document.getElementById(`${idBase}-amount`)?.focus();
      return;
    }
    setBusy(true);
    attempt.current ??= crypto.randomUUID().replace(/-/g, '');
    const res = await adminApi(locale, `/admin/coins/accounts/${userId}/adjust`, CoinAdjustedDto, {
      method: 'POST',
      headers: { 'Idempotency-Key': attempt.current },
      body: { delta, reasonCode, note: note || null, version: acct.version },
    });
    setBusy(false);
    if (!res.ok) {
      // A refused change is final for this attempt (stale, overdrawn): the next try is a new request.
      if (res.status >= 400 && res.status < 500) attempt.current = null;
      setError({ text: errorOf(res.code), field: `${idBase}-amount` });
      if (res.code === 'STALE_COINS' || res.code === 'INSUFFICIENT_COINS') await load();
      return;
    }
    attempt.current = null;
    track('click', {
      id: delta > 0 ? 'admin_coins_granted' : 'admin_coins_removed',
      path: window.location.pathname,
    });
    setError(null);
    setDone(res.data.balanceAfter);
    form.reset();
    await load();
  }

  if (!acct)
    return loadError ? (
      <div role="alert" className={`${portalCard} space-y-3`}>
        <p className="text-sm font-bold text-error">{t(loadError)}</p>
        <button
          type="button"
          className={portalQuiet}
          onClick={() => {
            setLoadError(null);
            void load();
          }}
        >
          {t('api_common_retry')}
        </button>
      </div>
    ) : (
      <p role="status" className={`${portalCard} text-sm text-muted`}>
        {t('api_common_loading')}
      </p>
    );

  const described = (field: string) =>
    error?.field === field ? { 'aria-invalid': true, 'aria-describedby': `${idBase}-error` } : {};

  return (
    <article className={portalCard} aria-labelledby={`${idBase}-title`}>
      <p
        id={`${idBase}-title`}
        className="font-heading text-base font-extrabold break-all text-ink"
        lang="en"
      >
        {userId}
      </p>
      <p className="mt-2 text-sm text-ink">
        <span className="font-heading text-2xl font-extrabold tabular-nums">{acct.balance}</span>{' '}
        {t('coins_api_balance')}
        {acct.pending.length > 0
          ? ` · ${t('coins_api_pending', { coins: acct.pending.reduce((a, p) => a + p.coins, 0) })}`
          : ''}
      </p>

      <form onSubmit={(e) => void onAdjust(e)} className="mt-4 grid gap-3 tab:grid-cols-2" noValidate>
        <fieldset className="tab:col-span-2">
          <legend className="text-sm font-bold text-ink">{t('coinsDirection')}</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm text-ink">
            {(['add', 'remove'] as const).map((d) => (
              <label key={d} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="direction"
                  value={d}
                  defaultChecked={d === 'add'}
                  className="size-6 accent-[var(--color-accent-button)]"
                />
                {t(`coinsDirection_${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={`${idBase}-amount`} className="text-sm font-bold text-ink">
            {t('coinsAmount')}
          </label>
          <input
            id={`${idBase}-amount`}
            name="amount"
            inputMode="numeric"
            maxLength={6}
            className={portalField}
            {...described(`${idBase}-amount`)}
          />
        </div>
        <div>
          <label htmlFor={`${idBase}-reason`} className="text-sm font-bold text-ink">
            {t('coins_api_reason')}
          </label>
          <select
            id={`${idBase}-reason`}
            name="reason"
            defaultValue=""
            className={portalField}
            {...described(`${idBase}-reason`)}
          >
            <option value="" disabled>
              {t('coins_api_reason_choose')}
            </option>
            {COIN_ADJUST_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`coins_api_reason_${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="tab:col-span-2">
          <label htmlFor={`${idBase}-note`} className="text-sm font-bold text-ink">
            {t('coins_api_note')}
          </label>
          <input
            id={`${idBase}-note`}
            name="note"
            maxLength={200}
            className={portalField}
            {...described(`${idBase}-note`)}
          />
        </div>
        <div className="tab:col-span-2">
          <button type="submit" disabled={busy} className={portalPrimary}>
            {busy ? t('api_common_loading') : t('coinsSave')}
          </button>
          {error ? (
            <p id={`${idBase}-error`} role="alert" className="mt-2 text-sm font-bold text-error">
              {t(error.text, { balance: acct.balance })}
            </p>
          ) : null}
          {done !== null ? (
            <p role="status" className="mt-2 text-sm font-bold text-success">
              {t('coins_api_done', { balance: done })}
            </p>
          ) : null}
        </div>
      </form>

      <h3 className="mt-5 text-sm font-bold text-ink">{t('coinsActivity')}</h3>
      {acct.entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t('coinsActivityEmpty')}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {acct.entries.map((e) => (
            <EntryRow key={e.id} e={e} />
          ))}
        </ul>
      )}
    </article>
  );
}

function Activity({ onOpen }: { onOpen: (userId: string) => void }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [page, setPage] = useState<AdminCoinActivityView | null>(null);
  const [loadError, setLoadError] = useState<ErrorText | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/coins/activity?limit=20', AdminCoinActivityDto);
    if (!res.ok) {
      setLoadError(errorOf(res.code));
      return;
    }
    setLoadError(null);
    setPage(res.data);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="coins-activity-title" className={portalCard}>
      <h3 id="coins-activity-title" className="font-heading text-lg font-extrabold text-ink">
        {t('coinsActivity')}
      </h3>
      {loadError ? (
        <div role="alert" className="mt-2 space-y-2">
          <p className="text-sm font-bold text-error">{t(loadError)}</p>
          <button type="button" className={portalQuiet} onClick={() => void load()}>
            {t('api_common_retry')}
          </button>
        </div>
      ) : !page ? (
        <p role="status" className="mt-2 text-sm text-muted">
          {t('api_common_loading')}
        </p>
      ) : page.entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('coinsActivityEmpty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {page.entries.map((e) => (
            <EntryRow
              key={e.id}
              e={e}
              extra={
                <button
                  type="button"
                  onClick={() => {
                    onOpen(e.userId);
                  }}
                  className="mt-1 min-h-6 text-xs font-bold text-accent-soft-text underline underline-offset-2"
                >
                  {t('coins_api_open_customer')}
                </button>
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
