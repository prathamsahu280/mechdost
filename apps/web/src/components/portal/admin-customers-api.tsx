'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  CustomerBlockCreated,
  CustomerBlockList,
  SavedVersion,
  type CustomerBlockDto,
} from '@mechdost/shared/admin-config-api';
import {
  CUSTOMER_BLOCK_LEVELS,
  CUSTOMER_BLOCK_REASONS,
  type CustomerBlockLevel,
  type CustomerBlockReason,
} from '@mechdost/shared/customers';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { blockErrorKey, endsAtFrom, type BlockErrorKey } from '@/lib/customer-blocks-view';
import { formatDate } from '@/lib/format';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

const PILL: Record<CustomerBlockLevel, string> = {
  cod_only: 'bg-warning-bg text-warning',
  orders: 'bg-warning-bg text-warning',
  full: 'bg-pill text-error',
};

const isLevel = (v: string): v is CustomerBlockLevel =>
  (CUSTOMER_BLOCK_LEVELS as readonly string[]).includes(v);
const isReason = (v: string): v is CustomerBlockReason =>
  (CUSTOMER_BLOCK_REASONS as readonly string[]).includes(v);

type ErrorText = BlockErrorKey | CommonErrorKey;
/** A form field's text ('' for a missing field or a file). */
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const errorOf = (code: string): ErrorText => blockErrorKey(code) ?? commonErrorKey(code);

/**
 * The block history and actions of one customer (real sign-in builds): block at one level with a reason (never
 * preselected), an optional end date and a staff-only note, or lift a block with a reason. History stays. Shown inside
 * the customer view (`admin-customer-view-api.tsx`).
 */
export function CustomerBlocks({ userId }: { userId: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [blocks, setBlocks] = useState<CustomerBlockDto[] | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [mode, setMode] = useState<'idle' | 'block' | { lift: string }>('idle');
  const [error, setError] = useState<ErrorText | null>(null);
  const [busy, setBusy] = useState(false);
  const idBase = `api-customer-${userId}`;

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/customers/${userId}/blocks`, CustomerBlockList);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setBlocks(res.data.blocks);
  }, [locale, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onBlock(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const level = text(data.get('level'));
    const reasonCode = text(data.get('reason'));
    if (!isLevel(level) || !isReason(reasonCode)) {
      setError('customersErr_reason');
      document.getElementById(`${idBase}-reason`)?.focus();
      return;
    }
    const day = text(data.get('endsAt'));
    const note = text(data.get('note')).trim();
    setBusy(true);
    const res = await adminApi(locale, `/admin/customers/${userId}/blocks`, CustomerBlockCreated, {
      method: 'POST',
      body: { level, reasonCode, note: note || null, endsAt: day ? endsAtFrom(day) : null },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorOf(res.code));
      document.getElementById(`${idBase}-level`)?.focus();
      return;
    }
    track('admin_customer_block', { action: 'blocked', level, reasonCode });
    setMode('idle');
    setError(null);
    await load();
  }

  async function onLift(e: SyntheticEvent<HTMLFormElement>, block: CustomerBlockDto) {
    e.preventDefault();
    const reason = text(new FormData(e.currentTarget).get('liftReason')).trim();
    if (reason.length < 5 || reason.length > 300) {
      setError('customersErr_liftReason');
      document.getElementById(`${idBase}-lift`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/customers/blocks/${block.id}/lift`, SavedVersion, {
      method: 'POST',
      body: { version: block.version, reason },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorOf(res.code));
      await load();
      return;
    }
    track('admin_customer_block', { action: 'lifted', level: block.level });
    setMode('idle');
    setError(null);
    await load();
  }

  if (!blocks)
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

  const active = blocks.filter((b) => b.inForce);
  const past = blocks.filter((b) => !b.inForce);
  const levelLabel = (level: CustomerBlockLevel) => t(`customersLevel_${level}`);
  const reasonLabel = (reason: CustomerBlockReason) => t(`customersReason_${reason}`);
  const errorLine = error ? (
    <p id={`${idBase}-error`} role="alert" className="mt-2 text-sm font-bold text-error">
      {t(error)}
    </p>
  ) : null;

  return (
    <article className={portalCard} aria-labelledby={`${idBase}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p
          id={`${idBase}-title`}
          className="font-heading text-base font-extrabold break-all text-ink"
          lang="en"
        >
          {userId}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {active.length === 0 ? (
            <span className="inline-flex rounded-pill bg-success-bg px-3 py-1 text-xs font-extrabold text-success">
              {t('customersClear')}
            </span>
          ) : (
            active.map((b) => (
              <span
                key={b.id}
                className={`inline-flex rounded-pill px-3 py-1 text-xs font-extrabold ${PILL[b.level]}`}
              >
                {levelLabel(b.level)}
              </span>
            ))
          )}
        </div>
      </div>

      {active.map((b) => (
        <div key={b.id} className="mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm">
          <p className="text-ink">
            {t(`customersEffect_${b.level}`)} · {reasonLabel(b.reasonCode)}
            {b.endsAt ? ` · ${t('customersUntil', { date: formatDate(b.endsAt, locale) })}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDate(b.createdAt, locale)}
            {b.note ? (
              <>
                {' · '}
                <span data-user-content>{b.note}</span>
              </>
            ) : null}
          </p>
          {typeof mode === 'object' && mode.lift === b.id ? (
            <form
              noValidate
              onSubmit={(e) => {
                void onLift(e, b);
              }}
              className="mt-2"
            >
              <label htmlFor={`${idBase}-lift`} className="text-sm font-bold text-ink">
                {t('customersLiftReason')}
              </label>
              <input
                id={`${idBase}-lift`}
                name="liftReason"
                autoComplete="off"
                maxLength={300}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${idBase}-error` : undefined}
                className={portalField}
              />
              {errorLine}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={portalPrimary}>
                  {t('customersLiftConfirm')}
                </button>
                <button
                  type="button"
                  className={portalQuiet}
                  onClick={() => {
                    setMode('idle');
                    setError(null);
                  }}
                >
                  {t('partnerCancel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className={`${portalQuiet} mt-1`}
              onClick={() => {
                setMode({ lift: b.id });
                setError(null);
              }}
            >
              {t('customersLift')}
            </button>
          )}
        </div>
      ))}

      {mode === 'block' ? (
        <form
          noValidate
          onSubmit={(e) => {
            void onBlock(e);
          }}
          className="mt-3 grid gap-3 min-[600px]:grid-cols-2"
        >
          <div>
            <label htmlFor={`${idBase}-level`} className="text-sm font-bold text-ink">
              {t('customersLevel')}
            </label>
            <select
              id={`${idBase}-level`}
              name="level"
              aria-describedby={error ? `${idBase}-error` : undefined}
              className={portalField}
              defaultValue="cod_only"
            >
              {CUSTOMER_BLOCK_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`customersLevel_${l}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idBase}-reason`} className="text-sm font-bold text-ink">
              {t('customersReason')}
            </label>
            <select
              id={`${idBase}-reason`}
              name="reason"
              className={portalField}
              defaultValue=""
              aria-invalid={error === 'customersErr_reason' ? true : undefined}
              aria-describedby={error ? `${idBase}-error` : undefined}
            >
              <option value="" disabled>
                {t('api_block_reason_choose')}
              </option>
              {CUSTOMER_BLOCK_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`customersReason_${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idBase}-ends`} className="text-sm font-bold text-ink">
              {t('customersEndsAt')}
            </label>
            <input id={`${idBase}-ends`} name="endsAt" type="date" className={portalField} />
          </div>
          <div>
            <label htmlFor={`${idBase}-note`} className="text-sm font-bold text-ink">
              {t('customersNote')}
            </label>
            <input
              id={`${idBase}-note`}
              name="note"
              autoComplete="off"
              maxLength={500}
              className={portalField}
            />
          </div>
          <div className="min-[600px]:col-span-2">
            {errorLine}
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={portalPrimary}>
                {t('api_block_confirm')}
              </button>
              <button
                type="button"
                className={portalQuiet}
                onClick={() => {
                  setMode('idle');
                  setError(null);
                }}
              >
                {t('partnerCancel')}
              </button>
            </div>
          </div>
        </form>
      ) : mode === 'idle' ? (
        <div className="mt-3">
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setMode('block');
              setError(null);
            }}
          >
            {t('customersBlock')}
          </button>
        </div>
      ) : null}

      {past.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-ink">
            {t('customersHistory', { count: past.length })}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {past.map((b) => (
              <li key={b.id}>
                {levelLabel(b.level)} · {reasonLabel(b.reasonCode)} · {formatDate(b.createdAt, locale)}
                {b.liftedReason ? (
                  <>
                    {' → '}
                    {t('customersLifted')}: <span data-user-content>{b.liftedReason}</span>
                  </>
                ) : (
                  ` → ${t('customersEnded')}`
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
