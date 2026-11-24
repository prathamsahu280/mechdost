'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { demoStep, demoView, useDemoRoadside } from '@/demo/roadside';
import { track } from '@/lib/analytics';
import { DATA_MODE } from '@/lib/data-mode';
import { formatPrice } from '@/lib/format';
import { CUSTOMER_STEPS, roadsideCall, roadsideErrorKey, stepIndex, type RoadsideView } from '@/lib/roadside';

const POLL_MS = 15_000;
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Tracking page of a roadside request (spec 22): the steps, the responder, the arrival code to show the mechanic, the
 * bill with the advance already paid and what is left, and the one next action (pay the advance if it was not paid, pay
 * the balance). No live map in phase 1; the page re-reads the request every 15 seconds. SOS is a call to MechDost.
 */
export function RoadsideTracker({ code }: { code: string }) {
  const demo = useDemoRoadside();
  return DATA_MODE === 'demo' ? (
    <TrackerBody
      code={code}
      view={demo?.code === code ? demoView(demo) : null}
      loading={false}
      error={null}
      reload={() => undefined}
    />
  ) : (
    <TrackerApi code={code} />
  );
}

function TrackerApi({ code }: { code: string }) {
  const locale = useLocale();
  const [view, setView] = useState<RoadsideView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const res = await roadsideCall<RoadsideView>(locale, `/roadside/requests/${encodeURIComponent(code)}`);
    if (res.ok) {
      setView(res.data);
      setError(null);
    } else setError(res.code);
    setLoading(false);
  }, [code, locale]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);
  return <TrackerBody code={code} view={view} loading={loading} error={error} reload={() => void load()} />;
}

function TrackerBody({
  code,
  view,
  loading,
  error,
  reload,
}: {
  code: string;
  view: RoadsideView | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  const t = useTranslations('roadside');
  const locale = useLocale();
  const base = locale === 'hi' ? '/hi' : '';
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (loading) return <div className="skeleton h-72 rounded-card" aria-hidden="true" />;
  if (!view)
    return (
      <div className="rounded-card border border-line-card bg-surface p-6 shadow-card">
        <p className="text-muted">{error ? t(roadsideErrorKey(error) as 'err_generic') : t('notFound')}</p>
        <Link href={`${base}/roadside`} className={`${primary} mt-4`}>
          {t('askAgain')}
        </Link>
      </div>
    );

  const pay = async (purpose: 'advance' | 'balance') => {
    setBusy(true);
    setNote(null);
    if (DATA_MODE === 'demo') {
      demoStep({ kind: purpose === 'advance' ? 'pay_advance' : 'pay_balance' });
    } else {
      const { payRoadside } = await import('@/lib/payments/pay-roadside');
      const res = await payRoadside({ code, purpose, locale });
      if (!res.ok && res.reason !== 'cancelled')
        setNote(res.reason === 'api' ? roadsideErrorKey(res.code ?? '') : `pay_${res.reason}`);
      reload();
    }
    setBusy(false);
  };
  const dropUnpaid = async () => {
    setBusy(true);
    if (DATA_MODE === 'demo') demoStep({ kind: 'reset' });
    else {
      await roadsideCall(locale, `/roadside/requests/${encodeURIComponent(code)}/cancel`, { method: 'POST' });
      reload();
    }
    setBusy(false);
  };

  const idx = stepIndex(view.status);
  const cancelled = view.status === 'cancelled';
  const responder = view.responder
    ? locale === 'hi' && view.responder.workshopNameHi
      ? view.responder.workshopNameHi
      : view.responder.workshopName
    : null;
  const bill = view.bill;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      {note ? (
        <p role="alert" className="rounded-card bg-error-bg p-3 text-sm font-bold text-error">
          {t(note as 'err_generic')}
        </p>
      ) : null}
      <section
        className="rounded-card border border-line-card bg-surface p-5 shadow-card"
        aria-labelledby="rsa-status"
      >
        <div role="status" aria-live="polite">
          <h2 id="rsa-status" className="font-heading text-lg font-extrabold text-ink">
            {t(`status_${view.status}` as 'status_requested')}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t(`statusHint_${view.status}` as 'statusHint_requested')}
          </p>
        </div>
        {view.status !== 'awaiting_payment' && !cancelled ? (
          <ol className="mt-4 space-y-2">
            {CUSTOMER_STEPS.map((s, i) => (
              <li
                key={s}
                aria-current={i === idx ? 'step' : undefined}
                className={`flex items-center gap-3 text-sm ${i <= idx ? 'font-bold text-ink' : 'text-muted'}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-6 place-items-center rounded-full text-xs ${i <= idx ? 'bg-success text-white' : 'bg-pill'}`}
                >
                  {i < idx ? <Check aria-hidden="true" className="size-4" /> : i + 1}
                </span>
                {t(`step_${s}` as 'step_requested')}
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {responder ? (
        <section className="rounded-card border border-line-card bg-surface p-5 shadow-card">
          <h2 className="font-heading text-base font-extrabold text-ink">{t('responder')}</h2>
          <p className="mt-1 font-bold">{responder}</p>
          {view.arrivalCode ? (
            <div className="mt-4 rounded-card bg-pill p-4">
              <p className="text-sm text-muted">{t('arrivalCodeHint')}</p>
              <p
                className="mt-1 font-heading text-3xl font-extrabold tracking-[0.3em] text-ink"
                aria-label={t('arrivalCode')}
              >
                {view.arrivalCode}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {bill ? (
        <section
          className="rounded-card border border-line-card bg-surface p-5 shadow-card"
          aria-labelledby="rsa-bill"
        >
          <h2 id="rsa-bill" className="font-heading text-base font-extrabold text-ink">
            {t('billTitle')}
          </h2>
          <ul className="mt-3 divide-y divide-line-card text-sm">
            {bill.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>
                  {l.description} × {l.quantity}
                </span>
                <span className="font-bold">{formatPrice(l.totalPaise)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>{t('total')}</dt>
              <dd className="font-bold">{formatPrice(bill.totalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('advancePaid')}</dt>
              <dd>− {formatPrice(Math.min(bill.advancePaise, bill.totalPaise))}</dd>
            </div>
            <div className="flex justify-between text-base">
              <dt className="font-bold">{t('balance')}</dt>
              <dd className="font-extrabold">{formatPrice(bill.balancePaise)}</dd>
            </div>
          </dl>
          {bill.overpaidPaise > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {t('overpaidNote', { amount: formatPrice(bill.overpaidPaise) })}
            </p>
          ) : null}
          {view.status === 'billed' && bill.balancePaise > 0 ? (
            <div className="mt-4 space-y-2">
              <button type="button" className={primary} disabled={busy} onClick={() => void pay('balance')}>
                {t('payBalance', { amount: formatPrice(bill.balancePaise) })}
              </button>
              <p className="text-sm text-muted">{t('orCash')}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {view.status === 'awaiting_payment' ? (
        <div className="space-y-2">
          <button type="button" className={primary} disabled={busy} onClick={() => void pay('advance')}>
            {t('payAdvance', { amount: formatPrice(view.advancePaid ? 0 : view.advancePaise) })}
          </button>
          <button type="button" className={`${quiet} ml-3`} disabled={busy} onClick={() => void dropUnpaid()}>
            {t('dropUnpaid')}
          </button>
        </div>
      ) : null}

      {view.refunds.length > 0 ? (
        <section
          className="rounded-card border border-line-card bg-surface p-5 shadow-card"
          aria-labelledby="rsa-refund"
        >
          <h2 id="rsa-refund" className="font-heading text-base font-extrabold text-ink">
            {t('refundTitle')}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {view.refunds.map((r, i) => (
              <li key={i}>
                {formatPrice(r.amountPaise)} · {t(`refund_${r.stage}` as 'refund_under_review')}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">{t('refundNote')}</p>
        </section>
      ) : null}

      {view.status === 'completed' || cancelled ? (
        <Link href={`${base}/roadside`} className={quiet} onClick={() => demoStep({ kind: 'reset' })}>
          {t('askAgain')}
        </Link>
      ) : (
        <a
          href="tel:112"
          className={quiet}
          onClick={() => {
            track('rsa_sos', { channel: 'call_112' });
          }}
        >
          {t('sos')}
        </a>
      )}
    </div>
  );
}
