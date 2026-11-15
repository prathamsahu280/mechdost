'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { RefundDestination } from '@mechdost/shared/refunds-api';
import { SupportDestinationSaved, type SupportRefundInfoDto } from '@mechdost/shared/support-thread';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { threadErrorKey } from '@/lib/support-thread-api';
import { portalCard, portalField, portalPrimary } from '@/components/portal/portal-guard';

/**
 * Where a cash-on-delivery refund goes (Q104): the customer gives a UPI id or bank account on the request. Shown only
 * for a COD order on a request that is still open. What they typed is sent once and never shown back: only the masked
 * form the API returns (`ra***@bank`, `••••1234 · IFSC`) is displayed.
 */
export function RefundDestinationApi({
  code,
  refund,
  onSaved,
}: {
  code: string;
  refund: SupportRefundInfoDto;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('supportThread');
  const locale = useLocale();
  const id = useId();
  const [kind, setKind] = useState<'upi' | 'bank'>('upi');
  const [upiId, setUpiId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(refund.destination === null);

  if (!refund.eligible) return null;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const candidate =
      kind === 'upi' ? { kind, upiId } : { kind, accountName, accountNumber, ifsc: ifsc.toUpperCase() };
    const parsed = RefundDestination.safeParse(candidate);
    if (!parsed.success) {
      setError('err_destination_invalid');
      document.getElementById(`${id}-${kind === 'upi' ? 'upi' : 'name'}`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(
      locale,
      `/support/tickets/${encodeURIComponent(code)}/refund-destination`,
      SupportDestinationSaved,
      { method: 'PUT', body: parsed.data },
    );
    setBusy(false);
    if (!res.ok) {
      setError(threadErrorKey(res.code));
      return;
    }
    // The typed values leave the page's state at once; only the masked answer is kept (by the reload).
    setUpiId('');
    setAccountName('');
    setAccountNumber('');
    setIfsc('');
    setError(null);
    setDone(true);
    setEditing(false);
    track('support_ticket', { action: 'destination_saved', channel: 'web' });
    await onSaved();
  }

  return (
    <section aria-labelledby={`${id}-title`} className={`${portalCard} mt-3`}>
      <h4 id={`${id}-title`} className="font-heading text-sm font-extrabold text-ink">
        {t('refundTitle')}
      </h4>
      <p className="mt-1 max-w-prose text-xs text-muted">{t('refundIntro')}</p>
      <p className="mt-2 text-sm font-bold text-ink" role="status">
        {refund.destination ? (
          <span data-user-content>{t('refundSaved', { masked: refund.destination.masked })}</span>
        ) : (
          t('refundNone')
        )}
        {done ? <span className="ml-2 text-success">{t('refundDone')}</span> : null}
      </p>
      {editing ? (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="mt-3 space-y-3"
        >
          <fieldset>
            <legend className="text-xs font-bold text-muted">{t('refundKind')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['upi', 'bank'] as const).map((k) => (
                <label
                  key={k}
                  className="press inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-line-card bg-pill px-4 text-sm font-bold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-soft-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
                >
                  <input
                    type="radio"
                    name={`${id}-kind`}
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  {t(k === 'upi' ? 'refundKindUpi' : 'refundKindBank')}
                </label>
              ))}
            </div>
          </fieldset>
          {kind === 'upi' ? (
            <div>
              <label htmlFor={`${id}-upi`} className="text-xs font-bold text-muted">
                {t('upiLabel')}
              </label>
              <input
                id={`${id}-upi`}
                type="text"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={upiId}
                maxLength={100}
                aria-describedby={`${id}-upi-help`}
                aria-invalid={error === 'err_destination_invalid' ? true : undefined}
                onChange={(e) => {
                  setUpiId(e.target.value);
                }}
                className={portalField}
              />
              <p id={`${id}-upi-help`} className="mt-1 text-xs text-muted">
                {t('upiHelp')}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 tab:grid-cols-2">
              <div className="tab:col-span-2">
                <label htmlFor={`${id}-name`} className="text-xs font-bold text-muted">
                  {t('accountNameLabel')}
                </label>
                <input
                  id={`${id}-name`}
                  type="text"
                  autoComplete="off"
                  value={accountName}
                  maxLength={80}
                  aria-invalid={error === 'err_destination_invalid' ? true : undefined}
                  onChange={(e) => {
                    setAccountName(e.target.value);
                  }}
                  className={portalField}
                />
              </div>
              <div>
                <label htmlFor={`${id}-acct`} className="text-xs font-bold text-muted">
                  {t('accountNumberLabel')}
                </label>
                <input
                  id={`${id}-acct`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={accountNumber}
                  maxLength={18}
                  aria-describedby={`${id}-acct-help`}
                  aria-invalid={error === 'err_destination_invalid' ? true : undefined}
                  onChange={(e) => {
                    setAccountNumber(e.target.value.replace(/\D/g, ''));
                  }}
                  className={portalField}
                />
                <p id={`${id}-acct-help`} className="mt-1 text-xs text-muted">
                  {t('accountNumberHelp')}
                </p>
              </div>
              <div>
                <label htmlFor={`${id}-ifsc`} className="text-xs font-bold text-muted">
                  {t('ifscLabel')}
                </label>
                <input
                  id={`${id}-ifsc`}
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={ifsc}
                  maxLength={11}
                  aria-describedby={`${id}-ifsc-help`}
                  aria-invalid={error === 'err_destination_invalid' ? true : undefined}
                  onChange={(e) => {
                    setIfsc(e.target.value);
                  }}
                  className={portalField}
                />
                <p id={`${id}-ifsc-help`} className="mt-1 text-xs text-muted">
                  {t('ifscHelp')}
                </p>
              </div>
            </div>
          )}
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {t(error as 'err_generic')}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className={portalPrimary}>
            {refund.destination ? t('refundReplace') : t('refundSave')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="press mt-2 min-h-11 rounded-pill bg-pill px-4 text-sm font-bold text-ink"
          onClick={() => {
            setEditing(true);
            setDone(false);
          }}
        >
          {t('refundReplace')}
        </button>
      )}
    </section>
  );
}
