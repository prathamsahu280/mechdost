'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { formatINR } from '@mechdost/shared/money';
import { computeServiceBill, labourPromiseEndsAt } from '@mechdost/shared/service-bill';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { decideEstimate } from '@/demo/service-jobs';
import {
  type DemoEstimate,
  type DemoEstimateLine,
  type DemoServiceBill,
  type DemoServiceRequest,
} from '@/demo/store';
import { serviceNameFor } from '@/demo/i18n/localize';
import { workshopGstRegistered } from '@/demo/workshops';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';

/** "18" for 1800 bp, "2.5" for 250 bp. */
export const ratePct = (bp: number) => String(bp / 100);

/** A line's text: the localised service name when it came from the menu, else what the workshop typed. */
export function LineName({ line }: { line: { description: string; serviceKey?: string } }) {
  const locale = useLocale();
  return line.serviceKey ? (
    <>{serviceNameFor(line.serviceKey, line.description, locale)}</>
  ) : (
    <span data-user-content>{line.description}</span>
  );
}

/** A line with its GST, computed exactly as the bill will (the rate is already 0 for unregistered workshops). */
const lineGross = (l: DemoEstimateLine) => {
  const b = computeServiceBill([{ ...l, decision: 'approved' }], { gstRegistered: true });
  return b.taxablePaise + b.cgstPaise + b.sgstPaise;
};

/**
 * The customer approves or declines every line of the current estimate, with consent (spec 06, concept "Review
 * estimate v{n}"). Nothing is pre-chosen; the approved total updates as they choose.
 */
export function EstimateApproval({
  request,
  estimate,
  onDecided,
}: {
  request: DemoServiceRequest;
  estimate: DemoEstimate;
  onDecided: () => void;
}) {
  const t = useTranslations('request');
  const formId = useId();
  const [choices, setChoices] = useState<Record<string, 'approved' | 'declined'>>({});
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<'errUndecided' | 'errConsent' | 'errStale' | null>(null);

  useEffect(() => {
    track('estimate_viewed', { code: request.code, version: estimate.version, lines: estimate.lines.length });
  }, [request.code, estimate.version, estimate.lines.length]);

  const registered = workshopGstRegistered(request.workshopSlug);
  const approvedTotal = computeServiceBill(
    estimate.lines.map((l) => ({ ...l, decision: choices[l.id] ?? 'pending' })),
    { gstRegistered: registered },
  ).totalPaise;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const undecided = estimate.lines.find((l) => !choices[l.id]);
    if (undecided) {
      setError('errUndecided');
      document.getElementById(`${formId}-${undecided.id}-approved`)?.focus();
      return;
    }
    if (!consent) {
      setError('errConsent');
      document.getElementById(`${formId}-consent`)?.focus();
      return;
    }
    const outcome = decideEstimate(request.code, estimate.version, choices, true);
    if (!outcome) {
      setError('errStale');
      return;
    }
    const approved = Object.values(choices).filter((c) => c === 'approved').length;
    track('job_card_approved', {
      code: request.code,
      version: estimate.version,
      approved,
      declined: estimate.lines.length - approved,
    });
    onDecided();
  }

  const titleId = `${formId}-title`;
  return (
    <section
      aria-labelledby={titleId}
      className="mt-6 rounded-tile border border-accent-soft bg-surface p-4 tab:p-5"
    >
      <h3 id={titleId} className="font-heading text-lg font-extrabold text-ink">
        {t('estimateTitle', { version: estimate.version })}
      </h3>
      {estimate.version > 1 ? (
        <p role="status" className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('estimateRevised')}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-muted">{t('estimateIntro')}</p>
      <form noValidate onSubmit={onSubmit} className="mt-4 space-y-3">
        {estimate.lines.map((l) => (
          <fieldset key={l.id} className="rounded-lg border border-line-card p-3">
            <legend className="sr-only">
              <LineName line={l} />
            </legend>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p aria-hidden="true" className="font-bold text-ink">
                <LineName line={l} />
              </p>
              <p className="text-sm font-bold text-ink tabular-nums">{formatPrice(lineGross(l))}</p>
            </div>
            <p className="text-xs text-muted">
              {t('lineQty', { qty: l.qty, price: formatPrice(l.unitPaise) })} ·{' '}
              {l.gstRateBp > 0 ? t('lineGst', { rate: ratePct(l.gstRateBp) }) : t('lineNoGst')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['approved', 'declined'] as const).map((d) => (
                <label
                  key={d}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-3 text-sm font-bold text-ink has-[:checked]:border-accent-button has-[:checked]:bg-accent-soft"
                >
                  <input
                    id={`${formId}-${l.id}-${d}`}
                    type="radio"
                    name={l.id}
                    value={d}
                    checked={choices[l.id] === d}
                    onChange={() => {
                      setChoices((c) => ({ ...c, [l.id]: d }));
                      setError(null);
                    }}
                    className="size-4 accent-[var(--color-accent-button)]"
                  />
                  {d === 'approved' ? t('approve') : t('decline')}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="font-heading font-extrabold text-ink" aria-live="polite">
          {t('approvedTotal', { total: formatPrice(approvedTotal) })}
        </p>
        <label className="flex items-start gap-3 text-sm text-ink">
          <input
            id={`${formId}-consent`}
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.currentTarget.checked);
              setError(null);
            }}
            className="mt-0.5 size-5 shrink-0"
          />
          <span>{t('estimateConsent')}</span>
        </label>
        {error ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t(error)}
          </p>
        ) : null}
        <button
          type="submit"
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('confirmChoices')}
        </button>
      </form>
    </section>
  );
}

/** The customer's decisions on the current estimate, after they confirmed. */
export function EstimateChoices({ estimate, fresh }: { estimate: DemoEstimate; fresh: boolean }) {
  const t = useTranslations('request');
  return (
    <section className="mt-6 rounded-tile border border-line-card p-4">
      {fresh ? (
        <p role="status" className="mb-3 rounded-lg bg-success-bg px-3 py-2 text-sm font-bold text-success">
          {t('approvedDone')}
        </p>
      ) : null}
      <h3 className="font-heading font-bold text-ink">{t('yourChoices', { version: estimate.version })}</h3>
      <ul className="mt-2 divide-y divide-line-card text-sm">
        {estimate.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap justify-between gap-x-3 py-2">
            <span className={l.decision === 'declined' ? 'text-muted line-through' : 'text-ink'}>
              <LineName line={l} />
            </span>
            <span className={l.decision === 'approved' ? 'font-bold text-success' : 'text-muted'}>
              {l.decision === 'approved' ? t('decision_approved') : t('decision_declined')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The bill: approved lines only, tax, round-off and total; then the payment at the workshop (spec 06). */
export function ServiceBillView({
  bill,
  workshopName,
  gstRegistered,
  requestCode,
}: {
  bill: DemoServiceBill;
  workshopName: string;
  gstRegistered: boolean;
  /** The job's code: with a promise on the bill, the "ask for a free redo" link needs it. */
  requestCode?: string;
}) {
  const t = useTranslations('request');
  const trust = useTranslations('trust');
  const locale = useLocale();
  const titleId = useId();
  const rates = new Set(bill.lines.map((l) => l.gstRateBp));
  const single = rates.size === 1 ? [...rates][0] : undefined;
  const row = (label: string, value: string, strong = false) => (
    <div
      className={`flex justify-between gap-3 py-1 ${strong ? 'font-heading text-base font-extrabold text-ink' : ''}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby={titleId} className="mt-6 rounded-tile border border-line-card p-4 tab:p-5">
      <h3 id={titleId} className="font-heading text-lg font-extrabold text-ink">
        {t('billTitle')}
      </h3>
      <ul className="mt-3 divide-y divide-line-card text-sm">
        {bill.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap justify-between gap-x-3 py-2">
            <span className="text-ink">
              <LineName line={l} />
              <span className="block text-xs text-muted">
                {t('lineQty', { qty: l.qty, price: formatINR(l.unitPaise) })}
                {l.gstRateBp > 0 ? ` · ${t('lineGst', { rate: ratePct(l.gstRateBp) })}` : ''}
              </span>
            </span>
            <span className="tabular-nums text-ink">{formatINR(l.taxablePaise)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 border-t border-line pt-2 text-sm text-muted">
        {row(t('billTaxable'), formatINR(bill.taxablePaise))}
        {gstRegistered ? (
          <>
            {row(
              single !== undefined && single > 0
                ? t('billCgstRate', { rate: ratePct(single / 2) })
                : t('billCgst'),
              formatINR(bill.cgstPaise),
            )}
            {row(
              single !== undefined && single > 0
                ? t('billSgstRate', { rate: ratePct(single / 2) })
                : t('billSgst'),
              formatINR(bill.sgstPaise),
            )}
          </>
        ) : null}
        {bill.roundOffPaise !== 0
          ? row(t('billRoundOff'), `${bill.roundOffPaise > 0 ? '+' : ''}${formatINR(bill.roundOffPaise)}`)
          : null}
        {row(t('billTotal'), formatINR(bill.totalPaise), true)}
      </dl>
      {gstRegistered ? null : <p className="mt-2 text-xs text-muted">{t('billNoGst')}</p>}
      {bill.labourPromiseDays ? (
        <div className="mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm">
          <p className="font-bold text-ink">
            {trust('labourBillLine', {
              days: bill.labourPromiseDays,
              date: formatDate(
                labourPromiseEndsAt(new Date(bill.billedAt), bill.labourPromiseDays).toISOString(),
                locale,
              ),
            })}
          </p>
          {requestCode ? (
            <Link
              href={`${locale === 'hi' ? '/hi' : ''}/account/support?redo=${encodeURIComponent(requestCode)}`}
              data-track="labour_redo_claim_open"
              className="mt-1 inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
            >
              {trust('labourClaim')}
            </Link>
          ) : null}
        </div>
      ) : null}
      <p
        className={`mt-4 rounded-lg px-3 py-2 text-sm font-bold ${bill.paidAt ? 'bg-success-bg text-success' : 'bg-accent-soft text-accent-soft-text'}`}
      >
        {bill.paidAt
          ? t('billPaid', { date: formatDate(bill.paidAt, locale) })
          : t('billPay', { total: formatPrice(bill.totalPaise), workshop: workshopName })}
      </p>
    </section>
  );
}
