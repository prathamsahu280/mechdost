'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { myRefundSteps, type MyRefund, type MyRefundStage } from '@mechdost/shared/refunds-api';
import { formatDate, formatPrice } from '@/lib/format';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';

/** Where on the stepper a stage sits (declined, failed and checking have no stepper). */
export const hasStepper = (stage: MyRefundStage): boolean =>
  stage === 'requested' || stage === 'approved' || stage === 'sent' || stage === 'completed';

/** The line under the stepper, by stage and method (never "refunded" or a promise before the money is confirmed). */
export function statusKey(r: Pick<MyRefund, 'stage' | 'method'>) {
  if (r.stage === 'approved')
    return r.method === 'manual'
      ? ('status_approved_manual' as const)
      : ('status_approved_original' as const);
  return `status_${r.stage}` as const;
}

/** Heading and one-line lead shared by the demo and API versions of Account → Refunds. */
export function RefundsFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('myRefunds');
  return (
    <div className="space-y-4">
      <header>
        <h2 className="font-heading text-xl font-extrabold text-ink">{t('title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t('lead')}</p>
      </header>
      {children}
    </div>
  );
}

/**
 * The customer's refunds (spec 05, 2026-11-23), one card each: what it is for, how much, a stepper in plain words
 * (Requested → Approved → Sent to your bank or UPI → Completed), the dates reached, where the money goes, and for a
 * refund that was sent the Razorpay reference. Declined, failed and "being checked" refunds show a plain status line
 * and a way to reach support instead of a stepper. `linkTargets` is off in the browser demo (its orders are samples).
 */
export function RefundsList({
  refunds,
  linkTargets,
}: {
  refunds: readonly MyRefund[];
  linkTargets: boolean;
}) {
  const t = useTranslations('myRefunds');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
  return (
    <ul aria-label={t('listLabel')} className="space-y-4">
      {refunds.map((r) => {
        const steps = myRefundSteps(r.method);
        const at = steps.findIndex((s) => s === r.stage);
        const done = r.stage === 'completed';
        const href =
          r.target.kind === 'order'
            ? `${prefix}/orders/${encodeURIComponent(r.target.code)}`
            : `${prefix}/service/${encodeURIComponent(r.target.code)}`;
        const supportHref =
          r.target.kind === 'order'
            ? `${prefix}/account/support?order=${encodeURIComponent(r.target.code)}`
            : `${prefix}/account/support`;
        const when = (iso: string | null, key: 'requestedOn' | 'approvedOn' | 'sentOn' | 'completedOn') =>
          iso ? t(key, { date: formatDate(iso, locale) }) : null;
        const dates = [
          when(r.requestedAt, 'requestedOn'),
          when(r.approvedAt, 'approvedOn'),
          when(r.sentAt, 'sentOn'),
          when(r.completedAt, 'completedOn'),
        ].filter((x): x is string => x !== null);
        return (
          <li key={r.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-wide text-muted uppercase">
                  {r.target.kind === 'order' ? t('forOrder') : t('forService')}
                </p>
                <p className="mt-0.5 font-heading text-base font-extrabold break-all text-ink">
                  {linkTargets ? (
                    <Link href={href} data-track="my_refunds_target" className="underline underline-offset-4">
                      {r.target.code}
                    </Link>
                  ) : (
                    r.target.code
                  )}
                </p>
                <p className="mt-1 text-sm text-muted">
                  <span className="sr-only">{t('reasonLabel')}: </span>
                  {t(`reason_${r.reasonCode}`)}
                </p>
              </div>
              <p className="shrink-0 font-heading text-xl font-extrabold text-ink tabular-nums">
                {formatPrice(r.amountPaise)}
              </p>
            </div>

            {hasStepper(r.stage) ? (
              <ol aria-label={t('stepsLabel')} className="mt-5 grid grid-flow-col auto-cols-fr gap-2">
                {steps.map((step, i) => {
                  const reached = done || i <= at;
                  const current = !done && i === at;
                  return (
                    <li
                      key={step}
                      aria-current={current ? 'step' : undefined}
                      className="min-w-0 text-center"
                    >
                      <span
                        aria-hidden="true"
                        className={`mx-auto grid size-7 place-items-center rounded-full text-xs font-extrabold ${
                          reached
                            ? 'bg-accent-button text-white'
                            : 'border border-input-border bg-surface text-muted'
                        }`}
                      >
                        {reached && !current ? <Check className="size-4" /> : i + 1}
                      </span>
                      <span
                        className={`mt-1.5 block text-xs leading-snug break-words ${
                          current ? 'font-bold text-ink' : reached ? 'text-ink' : 'text-muted'
                        }`}
                      >
                        {step === 'completed' && r.method === 'manual'
                          ? t('step_completed_manual')
                          : t(`step_${step}`)}
                        <span className="sr-only">
                          {current ? `, ${t('stepNow')}` : reached ? `, ${t('stepDone')}` : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : null}

            <p className="mt-4 rounded-lg bg-surface-alt px-3 py-2 text-sm text-ink">
              {t(statusKey(r))}
              {r.stage === 'declined' || r.stage === 'failed' || r.stage === 'checking' ? (
                <>
                  {' '}
                  <Link
                    href={supportHref}
                    data-track="my_refunds_support"
                    className="font-bold underline underline-offset-4"
                  >
                    {t('support')}
                  </Link>
                </>
              ) : null}
            </p>

            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm tab:grid-cols-2">
              <div>
                <dt className="text-xs font-bold tracking-wide text-muted uppercase">{t('methodLabel')}</dt>
                <dd className="mt-0.5 text-ink">
                  {r.method === 'manual' ? t('methodManual') : t('methodOriginal')}
                  {r.method === 'original' &&
                  (r.stage === 'requested' || r.stage === 'approved' || r.stage === 'sent') ? (
                    <span className="mt-0.5 block text-muted">{t('bankTime')}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="sr-only">{t('stepsLabel')}</dt>
                <dd className="text-muted">
                  {dates.map((d) => (
                    <span key={d} className="block">
                      {d}
                    </span>
                  ))}
                </dd>
              </div>
              {r.providerRefundId ? (
                <div className="tab:col-span-2">
                  <dt className="text-xs font-bold tracking-wide text-muted uppercase">{t('reference')}</dt>
                  <dd className="mt-0.5 text-ink">
                    <code className="font-mono text-[13px] break-all">{r.providerRefundId}</code>
                    <span className="block text-muted">{t('referenceHelp')}</span>
                  </dd>
                </div>
              ) : null}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
