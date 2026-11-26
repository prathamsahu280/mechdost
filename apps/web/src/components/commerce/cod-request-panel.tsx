'use client';

import { COD_REQUEST_REASONS, type CodRequestReason } from '@mechdost/shared/cod-eligibility';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { DATA_MODE } from '@/lib/data-mode';
import { requestDemoCod } from '@/demo/cod';

const NOTE_MAX = 300;
const PIN = /^[1-9]\d{5}$/;
/** Real requests need the API and real sign-in; every other build uses the browser demo store. */
const REAL = DATA_MODE === 'api' && AUTH_MODE === 'firebase';

type ErrorKey =
  | 'errReason'
  | 'errPincode'
  | 'err_COD_REQUEST_PENDING'
  | 'err_COD_REQUEST_TOO_SOON'
  | 'err_COD_ALREADY_AVAILABLE'
  | 'err_COD_REQUESTS_CLOSED'
  | 'err_PINCODE_NOT_SERVICEABLE'
  | 'err_COD_NOTE_LENGTH'
  | 'err_RATE_LIMITED'
  | 'err_AUTH_REQUIRED'
  | 'err_VERIFICATION_REQUIRED'
  | 'err_generic';

const KNOWN = new Set<string>([
  'COD_REQUEST_PENDING',
  'COD_REQUEST_TOO_SOON',
  'COD_ALREADY_AVAILABLE',
  'COD_REQUESTS_CLOSED',
  'PINCODE_NOT_SERVICEABLE',
  'COD_NOTE_LENGTH',
  'RATE_LIMITED',
  'AUTH_REQUIRED',
  'VERIFICATION_REQUIRED',
]);
const errorKey = (code: string): ErrorKey =>
  KNOWN.has(code) ? (`err_${code}` as ErrorKey) : code === 'HTTP_429' ? 'err_RATE_LIMITED' : 'err_generic';

/**
 * "Request cash on delivery" (founder ruling 2026-11-26; spec 03): reason code + optional note, sent for the PIN the
 * customer shops from. Lazy-loaded by checkout and Account → Payments, never part of the page shell. Not a <form>:
 * at checkout it sits inside the order form. The opener carries `data-disclosure-trigger="cod-request"`; Cancel and
 * Escape close it and focus goes back to the opener (PanelDismiss).
 */
export default function CodRequestPanel({
  surface,
  pincode,
  accountId,
  onClose,
  onSent,
}: {
  surface: 'checkout' | 'account';
  /** The PIN the request is for; editable on the account page. */
  pincode: string;
  /** Demo store: the signed-in demo account. */
  accountId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useTranslations('codRequest');
  const locale = useLocale();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [reason, setReason] = useState<CodRequestReason | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState(pincode);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    heading.current?.focus();
    track('cod_request_opened', { surface });
  }, [surface]);

  async function send() {
    if (sending) return;
    if (!reason) {
      setError('errReason');
      document.getElementById(`${id}-reason-0`)?.focus();
      return;
    }
    if (!PIN.test(pin)) {
      setError('errPincode');
      document.getElementById(`${id}-pin`)?.focus();
      return;
    }
    setError(null);
    setSending(true);
    const trimmed = note.trim() === '' ? null : note.trim();
    if (REAL) {
      const { sendCodRequest } = await import('@/lib/cod-api');
      const res = await sendCodRequest(locale, { pincode: pin, reasonCode: reason, note: trimmed });
      setSending(false);
      if (!res.ok) {
        setError(errorKey(res.code));
        return;
      }
    } else {
      const res = accountId
        ? requestDemoCod({ accountId, pincode: pin, reasonCode: reason, note: trimmed })
        : ({ ok: false, code: 'AUTH_REQUIRED' } as const);
      setSending(false);
      if (!res.ok) {
        setError(errorKey(res.code));
        return;
      }
    }
    setSent(true);
    onSent();
    // The Send button is gone: focus the heading, next to the confirmation (a11y review 2026-11-26).
    window.requestAnimationFrame(() => heading.current?.focus());
  }

  const errorId = `${id}-error`;
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="mt-3 rounded-card border border-line-card bg-surface p-4 shadow-card"
    >
      {/* One persistent live region: it exists before its text, so "Sending" and "Request sent" are read. */}
      <p role="status" className="sr-only">
        {sending ? t('sending') : sent ? t('sent') : ''}
      </p>
      <h3
        id={`${id}-title`}
        ref={heading}
        tabIndex={-1}
        className="font-heading text-base font-bold text-ink"
      >
        {t('title')}
      </h3>
      {sent ? (
        <>
          <p className="mt-2 text-sm text-ink">{t('sent')}</p>
          <button
            type="button"
            data-panel-cancel="cod-request"
            onClick={onClose}
            className="press mt-3 min-h-11 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            {t('close')}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t('intro')}</p>
          <fieldset className="mt-3" aria-describedby={error === 'errReason' ? errorId : undefined}>
            <legend className="text-sm font-bold text-ink">{t('reasonLegend')}</legend>
            <div className="mt-2 grid gap-2">
              {COD_REQUEST_REASONS.map((r, i) => (
                <label
                  key={r}
                  className="flex min-h-11 items-center gap-3 rounded-input border border-input-border px-3 text-sm text-ink"
                >
                  <input
                    id={`${id}-reason-${String(i)}`}
                    type="radio"
                    name={`${id}-reason`}
                    // Not part of the checkout order form around it: no stray field, no Enter-to-submit.
                    form={`${id}-detached`}
                    value={r}
                    checked={reason === r}
                    onChange={() => {
                      setReason(r);
                      if (error === 'errReason') setError(null);
                    }}
                    className="size-6 shrink-0 accent-[var(--color-accent-button)]"
                  />
                  {t(`reason_${r}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {surface === 'account' ? (
            <div className="mt-3">
              <label htmlFor={`${id}-pin`} className="block text-sm font-bold text-ink">
                {t('pincodeLabel')}
              </label>
              <input
                id={`${id}-pin`}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (error === 'errPincode') setError(null);
                }}
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                aria-invalid={error === 'errPincode'}
                aria-describedby={error === 'errPincode' ? errorId : undefined}
                className="mt-1 min-h-11 w-40 rounded-input border border-input-border bg-surface px-3 text-base text-ink"
              />
            </div>
          ) : null}
          <div className="mt-3">
            <label htmlFor={`${id}-note`} className="block text-sm font-bold text-ink">
              {t('noteLabel')}
            </label>
            <textarea
              id={`${id}-note`}
              value={note}
              onChange={(e) => {
                setNote(e.target.value.slice(0, NOTE_MAX));
              }}
              rows={3}
              maxLength={NOTE_MAX}
              aria-describedby={`${id}-note-hint ${id}-note-count`}
              className="mt-1 w-full rounded-input border border-input-border bg-surface px-3 py-2 text-base text-ink"
            />
            <p id={`${id}-note-hint`} className="mt-1 text-xs text-muted">
              {t('noteHint')}
            </p>
            <p id={`${id}-note-count`} className="text-xs text-muted">
              {t('noteCount', { count: note.length })}
            </p>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="mt-3 text-sm font-bold text-error">
              {t(error)}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={sending}
              onClick={() => void send()}
              className="press min-h-11 rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover aria-disabled:opacity-70"
            >
              {sending ? t('sending') : t('submit')}
            </button>
            <button
              type="button"
              data-panel-cancel="cod-request"
              onClick={onClose}
              className="press min-h-11 rounded-button px-3 text-sm font-bold text-ink underline hover:bg-pill"
            >
              {t('close')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
