'use client';

import { CreditCard } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { serviceErrorKey } from '@/lib/service-views';

type Phase = 'idle' | 'opening' | 'confirming';
type Notice = 'cancelled' | 'failed' | 'not_confirmed' | 'sign_in' | 'unavailable';

/**
 * "Pay online" under the bill (spec 03 "Service bill payments", real sign-in only): one primary action. Razorpay
 * Checkout is loaded only on the tap (`lib/payments/pay-bill.ts`, a dynamic import), so the request page carries none
 * of it. The amount is the bill total the server holds. "Pay the workshop directly" stays the other way to settle, and
 * the page says so; both can never settle the same bill (the server decides, a late online payment is refunded).
 */
export function PayBillApi({
  code,
  totalPaise,
  onChanged,
}: {
  code: string;
  totalPaise: number;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('request');
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (phase !== 'idle') return; // a second tap while one is open does nothing (the server is idempotent too)
    setNotice(null);
    setError(null);
    setPhase('opening');
    track('click', { id: 'service_bill_pay_online', path: window.location.pathname });
    const { payBill } = await import('@/lib/payments/pay-bill');
    const result = await payBill({ code, locale });
    if (result.ok) {
      setPhase('idle');
      await onChanged();
      return;
    }
    setPhase(result.reason === 'not_confirmed' ? 'confirming' : 'idle');
    if (result.reason === 'api') {
      setError(result.code ?? 'generic');
      await onChanged();
    } else setNotice(result.reason);
    if (result.reason === 'not_confirmed') {
      await onChanged();
      setPhase('idle');
    }
  }

  const message =
    notice === 'cancelled'
      ? t('api_payCancelled')
      : notice === 'failed'
        ? t('api_payFailed')
        : notice === 'not_confirmed'
          ? t('api_payNotConfirmed')
          : notice === 'sign_in'
            ? t('api_paySignIn')
            : notice === 'unavailable'
              ? t('api_payUnavailable')
              : null;

  return (
    <div className="mt-4 rounded-tile border border-line-card p-4" aria-busy={phase !== 'idle' || undefined}>
      <p id={`pay-hint-${code}`} className="text-sm text-muted">
        {t('api_payOnlineHint', { total: formatPrice(totalPaise) })}
      </p>
      <button
        type="button"
        disabled={phase !== 'idle'}
        aria-describedby={`pay-hint-${code}`}
        onClick={() => void pay()}
        className="press mt-3 inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
      >
        <CreditCard aria-hidden="true" className="size-4" />
        {phase === 'opening' ? t('api_payOnlineBusy') : t('api_payOnline')}
      </button>
      <p className="mt-2 text-sm text-muted">{t('api_payAtWorkshopAlt')}</p>
      {phase === 'confirming' ? (
        <p role="status" className="mt-2 text-sm font-bold text-ink">
          {t('api_payConfirming')}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="mt-2 text-sm font-bold text-error">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-error">
          {t(serviceErrorKey(error) as 'api_err_generic')}
        </p>
      ) : null}
    </div>
  );
}
