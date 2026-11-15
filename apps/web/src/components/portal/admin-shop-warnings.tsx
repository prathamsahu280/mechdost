'use client';

import {
  AdminPartnerWarnings,
  PARTNER_WARNING_REASONS,
  WarningIssued,
  type AdminPartnerWarningsDto,
  type PartnerWarningReason,
} from '@mechdost/shared/partner-warnings';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { ApiError } from './api-list-state';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';

const WARNING_ERRORS = new Set(['WARNING_REASON', 'WARNING_NOTE', 'WARNING_WITHDRAWN', 'NOT_FOUND']);

function WarningError({ code }: { code: string }) {
  const t = useTranslations('shopGiveUp');
  if (!WARNING_ERRORS.has(code)) return <ApiError code={code} />;
  return (
    <p role="alert" className="text-sm font-bold text-error">
      {t(`err_${code}` as 'err_NOT_FOUND')}
    </p>
  );
}

/** The warnings of one shop for the admin page; the pause prompt shows above the tabs and in the panel. */
export function useShopWarnings(shopId: string) {
  const locale = useLocale();
  const [warnings, setWarnings] = useState<AdminPartnerWarningsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const res = await adminApi(locale, `/admin/shops/${shopId}/warnings`, AdminPartnerWarnings);
    if (res.ok) {
      setWarnings(res.data);
      setError(null);
    } else setError(res.code);
  }, [locale, shopId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { warnings, error, reload, set: setWarnings };
}

/**
 * Staff prompt (spec 08, ruling 2026-11-15): enough warnings in the window, so staff may want to pause the shop.
 * Only a prompt — one quiet button to the existing standing panel; nothing is paused here.
 */
export function PausePrompt({
  warnings,
  onReview,
}: {
  warnings: AdminPartnerWarningsDto | null;
  onReview: () => void;
}) {
  const t = useTranslations('shopGiveUp');
  if (!warnings?.suggestPause) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-bg p-3"
    >
      <p className="text-sm font-bold text-warning">
        {t('a_prompt', { count: warnings.counting, days: warnings.windowDays })}
      </p>
      <button type="button" onClick={onReview} className={portalQuiet}>
        {t('a_goStanding')}
      </button>
    </div>
  );
}

export function WarningsPanel({
  shopId,
  warnings,
  onChanged,
  onReviewStanding,
}: {
  shopId: string;
  warnings: AdminPartnerWarningsDto | null;
  onChanged: (next: AdminPartnerWarningsDto) => void;
  onReviewStanding: () => void;
}) {
  const t = useTranslations('shopGiveUp');
  const locale = useLocale();
  const [reason, setReason] = useState<PartnerWarningReason | ''>('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState<'reason' | 'note' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'issued' | 'withdrawn' | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawNote, setWithdrawNote] = useState('');
  const id = `warn-${shopId}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const bad = !reason ? 'reason' : reason === 'other' && note.trim().length < 5 ? 'note' : null;
    if (bad) {
      setInvalid(bad);
      document.getElementById(`${id}-${bad}`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/shops/${shopId}/warnings`, WarningIssued, {
      method: 'POST',
      body: { reasonCode: reason, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      setSaved(null);
      return;
    }
    track('click', { id: 'admin_partner_warning_issued', path: window.location.pathname });
    setError(null);
    setSaved('issued');
    setReason('');
    setNote('');
    onChanged(res.data.warnings);
  }

  async function onWithdraw(e: SyntheticEvent<HTMLFormElement>, warningId: string) {
    e.preventDefault();
    if (withdrawNote.trim().length < 5) {
      setInvalid('note');
      document.getElementById(`${id}-withdraw-note`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/shops/${shopId}/warnings/${warningId}/withdraw`,
      AdminPartnerWarnings,
      {
        method: 'POST',
        body: { note: withdrawNote.trim() },
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: 'admin_partner_warning_withdrawn', path: window.location.pathname });
    setError(null);
    setSaved('withdrawn');
    setWithdrawing(null);
    setWithdrawNote('');
    setInvalid(null);
    onChanged(res.data);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('a_intro')}</p>
      <PausePrompt warnings={warnings} onReview={onReviewStanding} />
      <form noValidate onSubmit={(e) => void onSubmit(e)} aria-busy={busy || undefined} className="space-y-2">
        <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
          {t('a_reasonLabel')}
        </label>
        <select
          id={`${id}-reason`}
          value={reason}
          aria-invalid={invalid === 'reason' ? true : undefined}
          onChange={(e) => {
            setReason(PARTNER_WARNING_REASONS.find((r) => r === e.target.value) ?? '');
            setInvalid(null);
          }}
          className={portalField}
        >
          <option value="">{t('choose')}</option>
          {PARTNER_WARNING_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`wr_${r}`)}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-note`} className="text-xs font-bold text-muted">
          {t('a_noteLabel')}
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          maxLength={300}
          rows={2}
          aria-invalid={invalid === 'note' ? true : undefined}
          onChange={(e) => {
            setNote(e.target.value);
            setInvalid(null);
          }}
          className={`${portalField} py-2`}
        />
        {invalid ? (
          <p role="alert" className="text-xs font-bold text-error">
            {invalid === 'note' ? t('a_noteRequired') : t('reasonRequired')}
          </p>
        ) : null}
        {error && !withdrawing ? <WarningError code={error} /> : null}
        {saved ? (
          <p role="status" className="text-sm font-bold text-success">
            {saved === 'issued' ? t('a_issued') : t('a_withdrawn')}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('a_issue')}
        </button>
      </form>

      <section aria-labelledby={`${id}-history`}>
        <h4 id={`${id}-history`} className="text-sm font-extrabold text-ink">
          {t('a_history')}
        </h4>
        {!warnings ? null : warnings.warnings.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{t('a_empty', { days: warnings.windowDays })}</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {t('a_count', { count: warnings.counting, days: warnings.windowDays })}
            </p>
            <ul className="mt-2 divide-y divide-line">
              {warnings.warnings.map((w) => (
                <li key={w.id} className="py-2 text-sm text-ink">
                  <span className="font-bold">{formatDate(w.createdAt, locale)}</span> ·{' '}
                  {t(`wr_${w.reasonCode}`)}
                  {w.withdrawn ? ` · ${t('w_withdrawn')}` : ''}
                  {w.note ? (
                    <>
                      {' · '}
                      <span data-user-content>{w.note}</span>
                    </>
                  ) : null}
                  {w.withdrawn ? null : withdrawing === w.id ? (
                    <form
                      noValidate
                      onSubmit={(e) => void onWithdraw(e, w.id)}
                      className="mt-2 space-y-2 rounded-lg bg-pill p-3"
                    >
                      <label htmlFor={`${id}-withdraw-note`} className="text-xs font-bold text-muted">
                        {t('a_withdrawWhy')}
                      </label>
                      <textarea
                        id={`${id}-withdraw-note`}
                        value={withdrawNote}
                        maxLength={300}
                        rows={2}
                        aria-invalid={invalid === 'note' ? true : undefined}
                        onChange={(e) => {
                          setWithdrawNote(e.target.value);
                          setInvalid(null);
                        }}
                        className={`${portalField} py-2`}
                      />
                      {invalid === 'note' ? (
                        <p role="alert" className="text-xs font-bold text-error">
                          {t('a_noteRequired')}
                        </p>
                      ) : null}
                      {error ? <WarningError code={error} /> : null}
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={busy} className={portalQuiet}>
                          {t('a_withdrawConfirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWithdrawing(null);
                            setError(null);
                          }}
                          className={portalQuiet}
                        >
                          {t('a_cancel')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setWithdrawing(w.id);
                        setError(null);
                      }}
                      className="ml-2 min-h-11 px-2 text-xs font-bold text-accent-soft-text underline-offset-4 hover:underline"
                    >
                      {t('a_withdraw')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
