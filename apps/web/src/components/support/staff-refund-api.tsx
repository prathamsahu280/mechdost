'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { AdminRefundDto } from '@mechdost/shared/refunds-api';
import type { RefundReason } from '@mechdost/shared/state';
import type { SupportRefundInfoDto } from '@mechdost/shared/support-thread';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { rupeesTextToPaise } from '@/lib/support-view';
import { threadErrorKey } from '@/lib/support-thread-api';
import { portalCard, portalField, portalPrimary } from '@/components/portal/portal-guard';

/** Reasons staff may pick for a support refund (the system-set ones are not offered). */
const REASONS = [
  'faulty',
  'damaged_in_transit',
  'wrong_item',
  'missing_item',
  'not_fulfilled',
  'goodwill',
  'other',
] as const satisfies readonly RefundReason[];

/**
 * Staff view of a cash-on-delivery request: the customer's payout destination (masked, never the full value) and the
 * button that asks finance for the manual refund. Needs `refunds:initiate`; finance approves later in the refunds queue.
 * One idempotency key per attempt, kept until it succeeds, so a retry or double tap replays instead of asking twice.
 */
export function StaffRefundApi({
  code,
  refund,
  onDone,
}: {
  code: string;
  refund: SupportRefundInfoDto;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('supportThread');
  const r = useTranslations('refunds');
  const locale = useLocale();
  const id = useId();
  const key = useRef<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('faulty');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!refund.eligible) return null;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const paise = rupeesTextToPaise(amount);
    if (paise === null) {
      setError('err_amount');
      document.getElementById(`${id}-amount`)?.focus();
      return;
    }
    key.current ??= `tkt${crypto.randomUUID().replace(/-/g, '')}`;
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/support/tickets/${encodeURIComponent(code)}/refund`,
      AdminRefundDto,
      {
        method: 'POST',
        body: { amountPaise: paise, reasonCode: reason },
        headers: { 'Idempotency-Key': key.current },
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(threadErrorKey(res.status === 403 ? 'FORBIDDEN' : res.code));
      return;
    }
    key.current = null;
    setError(null);
    setAmount('');
    setDone(true);
    track('support_ticket', { action: 'refund_requested', channel: 'web' });
    await onDone();
  }

  return (
    <section aria-labelledby={`${id}-title`} className={portalCard}>
      <h4 id={`${id}-title`} className="font-heading text-sm font-extrabold text-ink">
        {t('staffRefundTitle')}
      </h4>
      <p className="mt-1 text-sm text-ink">
        {refund.destination ? (
          <span data-user-content>{t('staffRefundDestination', { masked: refund.destination.masked })}</span>
        ) : (
          t('staffRefundNoDestination')
        )}
      </p>
      {refund.destination ? (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="mt-3 grid gap-3 tab:grid-cols-2"
        >
          <div>
            <label htmlFor={`${id}-amount`} className="text-xs font-bold text-muted">
              {t('staffRefundAmount')}
            </label>
            <input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              maxLength={12}
              aria-invalid={error === 'err_amount' ? true : undefined}
              onChange={(e) => {
                setAmount(e.target.value);
                setDone(false);
              }}
              className={portalField}
            />
          </div>
          <div>
            <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
              {t('staffRefundReason')}
            </label>
            <select
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => {
                const next = REASONS.find((x) => x === e.target.value);
                if (next) setReason(next);
              }}
              className={portalField}
            >
              {REASONS.map((x) => (
                <option key={x} value={x}>
                  {r(`reason_${x}`)}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-bold text-error tab:col-span-2">
              {t(error as 'err_generic')}
            </p>
          ) : null}
          <div className="tab:col-span-2">
            <button type="submit" disabled={busy} className={portalPrimary}>
              {t('staffRefundRequest')}
            </button>
            <p role="status" className="mt-2 text-sm font-bold text-success">
              {done ? t('staffRefundDone') : null}
            </p>
          </div>
        </form>
      ) : null}
    </section>
  );
}
