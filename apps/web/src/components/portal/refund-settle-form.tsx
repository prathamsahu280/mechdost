'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import type { AdminRefund } from '@mechdost/shared/refunds-api';
import {
  REFUND_SETTLE_OUTCOMES,
  REFUND_SETTLE_REASONS,
  type RefundSettleOutcome,
  type RefundSettleReason,
} from '@mechdost/shared/state';
import { track } from '@/lib/analytics';
import { refundErrorKey, settleBody, type SettleForm, type SettleFormError } from '@/lib/refund-views';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';

/**
 * Finance settles an unsure refund by hand after looking at Razorpay (spec 05 "Settling by hand"): what happened there,
 * how finance checked, a written note, and (when money moved) Razorpay's refund id and the amount. One primary action;
 * "Never mind" and Escape close it, and the caller returns focus to the button that opened it. The API repeats every
 * rule; a stale refund is reloaded by the caller.
 */
export function RefundSettleForm({
  refund,
  onSettled,
  onStale,
  onClose,
}: {
  refund: AdminRefund;
  onSettled: (next: AdminRefund) => void;
  onStale: (fresh: AdminRefund) => void;
  onClose: () => void;
}) {
  const t = useTranslations('refunds');
  const locale = useLocale();
  const [form, setForm] = useState<SettleForm>({
    outcome: 'not_refunded',
    reasonCode: 'dashboard_checked',
    note: '',
    providerRefundId: '',
    amount: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const hasProviderId = refund.providerRefundId !== null;
  const needsId = form.outcome !== 'not_refunded';

  useEffect(() => {
    first.current?.focus();
  }, []);

  const set = <K extends keyof SettleForm>(key: K, value: SettleForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const fail = (e: SettleFormError) => {
    setError(e === 'note' ? 'SETTLE_NOTE' : e === 'amount' ? 'SETTLE_AMOUNT' : 'SETTLE_PROVIDER_ID');
    // Focus goes to the first field with a problem (the form order is id, amount, note).
    window.setTimeout(() => {
      (e === 'note' ? noteRef : e === 'amount' ? amountRef : idRef).current?.focus();
    }, 0);
  };

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const built = settleBody(refund.version, form, { hasProviderId });
    if (!built.ok) {
      fail(built.error);
      return;
    }
    track('click', { id: `admin_refund_settle_${form.outcome}`, path: window.location.pathname });
    setBusy(true);
    setError(null);
    const { settleRefund, fetchRefund } = await import('@/lib/refunds-api');
    const res = await settleRefund(locale, refund.id, built.body);
    setBusy(false);
    if (res.ok) {
      onSettled(res.data);
      return;
    }
    setError(res.code);
    if (res.code === 'STALE_REFUND' || res.code === 'NOT_UNSURE') {
      const fresh = await fetchRefund(locale, refund.id);
      if (fresh.ok) onStale(fresh.data);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
      onKeyDown={onKeyDown}
      className="mt-5 space-y-4"
      noValidate
      aria-labelledby="refund-settle-title"
    >
      <div>
        <h4 id="refund-settle-title" className="font-heading text-base font-extrabold text-ink">
          {t('settleTitle')}
        </h4>
        <p className="mt-1 text-sm text-muted">{t('settleIntro')}</p>
      </div>
      <fieldset>
        <legend className="text-sm font-bold text-ink">{t('settleOutcomeLabel')}</legend>
        <div className="mt-2 space-y-2">
          {REFUND_SETTLE_OUTCOMES.map((o: RefundSettleOutcome, i) => (
            <label key={o} className="flex min-h-10 items-center gap-2 text-sm text-ink">
              <input
                ref={i === 0 ? first : undefined}
                type="radio"
                name="settle-outcome"
                value={o}
                checked={form.outcome === o}
                onChange={() => {
                  set('outcome', o);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {t(`settleOutcome_${o}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {needsId && !hasProviderId ? (
        <label className="block text-sm font-bold text-ink">
          {t('settleProviderIdLabel')}
          <input
            ref={idRef}
            name="providerRefundId"
            spellCheck={false}
            aria-invalid={error === 'SETTLE_PROVIDER_ID'}
            value={form.providerRefundId}
            onChange={(e) => {
              set('providerRefundId', e.target.value);
            }}
            autoComplete="off"
            maxLength={40}
            aria-describedby="settle-id-hint"
            className={portalField}
          />
          <span id="settle-id-hint" className="mt-1 block text-xs font-normal text-muted">
            {t('settleProviderIdHint')}
          </span>
        </label>
      ) : null}
      {form.outcome === 'refunded_other_amount' ? (
        <label className="block text-sm font-bold text-ink">
          {t('settleAmountLabel')}
          <input
            ref={amountRef}
            name="amount"
            aria-invalid={error === 'SETTLE_AMOUNT'}
            value={form.amount}
            onChange={(e) => {
              set('amount', e.target.value);
            }}
            inputMode="decimal"
            autoComplete="off"
            aria-describedby="settle-amount-hint"
            className={portalField}
          />
          <span id="settle-amount-hint" className="mt-1 block text-xs font-normal text-muted">
            {t('settleAmountHint')}
          </span>
        </label>
      ) : null}
      <label className="block text-sm font-bold text-ink">
        {t('settleReasonLabel')}
        <select
          value={form.reasonCode}
          onChange={(e) => {
            set('reasonCode', e.target.value as RefundSettleReason);
          }}
          className={portalField}
        >
          {REFUND_SETTLE_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`settleReason_${r}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-bold text-ink">
        {t('settleNoteLabel')}
        <textarea
          ref={noteRef}
          name="note"
          aria-invalid={error === 'SETTLE_NOTE'}
          value={form.note}
          onChange={(e) => {
            set('note', e.target.value);
          }}
          rows={3}
          maxLength={300}
          aria-describedby="settle-note-hint"
          className={portalField}
        />
        <span id="settle-note-hint" className="mt-1 block text-xs font-normal text-muted">
          {t('settleNoteHint')}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm font-bold text-ink">
          {t(refundErrorKey(error))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {busy ? t('settleBusy') : t('settleConfirm')}
        </button>
        <button type="button" onClick={onClose} className={portalQuiet}>
          {t('settleCancel')}
        </button>
      </div>
    </form>
  );
}
