'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EstimateItem } from '@mechdost/shared/service-api';
import { computeServiceBill } from '@mechdost/shared/service-bill';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { anyApproved, approvedTotalKey } from '@/lib/estimate-summary';
import { estimateDecisions, ratePct, serviceErrorKey } from '@/lib/service-views';

/** A line with its GST as the workshop sent it (the bill applies the workshop's registration). */
const lineGross = (l: EstimateItem) => {
  const b = computeServiceBill([{ ...l, decision: 'approved' }], { gstRegistered: true });
  return b.taxablePaise + b.cgstPaise + b.sgstPaise;
};

/**
 * The customer approves or declines every line of the current estimate revision, with consent (spec 06, real data
 * mode). Nothing is pre-chosen; the approved total updates as they choose. A newer revision or a request that moved
 * meanwhile is refused by the API (`STALE_ESTIMATE` / `STALE_REQUEST`) and the page reloads it.
 */
export function EstimateApprovalApi({
  code,
  version,
  revision,
  items,
  onChanged,
}: {
  code: string;
  version: number;
  revision: number;
  items: EstimateItem[];
  onChanged: (decided: boolean) => Promise<void>;
}) {
  const t = useTranslations('request');
  const locale = useLocale();
  const formId = useId();
  const [choices, setChoices] = useState<Record<string, 'approved' | 'declined'>>({});
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (items.length > 0) track('estimate_viewed', { code, version: revision, lines: items.length });
  }, [code, revision, items.length]);

  const approvedTotal = computeServiceBill(
    items.map((l) => ({ ...l, decision: choices[l.id] ?? 'pending' })),
    { gstRegistered: true },
  ).totalPaise;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = estimateDecisions(items, choices);
    if (!body.ok) {
      setError(t('errUndecided'));
      document.getElementById(`${formId}-${body.missing}-approved`)?.focus();
      return;
    }
    if (!consent) {
      setError(t('errConsent'));
      document.getElementById(`${formId}-consent`)?.focus();
      return;
    }
    setBusy(true);
    const { decideServiceEstimate } = await import('@/lib/service-api');
    const res = await decideServiceEstimate(locale, code, {
      revision,
      version,
      decisions: body.decisions,
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.code === 'STALE_ESTIMATE'
          ? t('errStale')
          : res.code === 'DECISION_INCOMPLETE'
            ? t('errUndecided')
            : t(serviceErrorKey(res.code) as 'api_err_generic'),
      );
      await onChanged(false);
      return;
    }
    const approved = body.decisions.filter((d) => d.decision === 'approved').length;
    track('job_card_approved', {
      code,
      version: revision,
      approved,
      declined: body.decisions.length - approved,
    });
    await onChanged(true);
  }

  const titleId = `${formId}-title`;
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className="mt-6 rounded-tile border border-accent-soft bg-surface p-4 tab:p-5"
    >
      <h3 id={titleId} className="font-heading text-lg font-extrabold text-ink">
        {t('estimateTitle', { version: revision })}
      </h3>
      {revision > 1 ? (
        <p role="status" className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('estimateRevised')}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-muted">{t('estimateIntro')}</p>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-3">
        {items.map((l) => (
          <fieldset
            key={l.id}
            aria-labelledby={`${formId}-${l.id}-desc`}
            className="rounded-lg border border-line-card p-3"
          >
            {/* The visible description names the group: one copy in the page, not a hidden legend as well (QA 2026-11-16, bug 8). */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p id={`${formId}-${l.id}-desc`} className="font-bold text-ink" data-user-content>
                {l.description}
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
          {anyApproved(choices)
            ? t(approvedTotalKey(items.some((l) => l.gstRateBp > 0)), { total: formatPrice(approvedTotal) })
            : t('approvedTotalHint')}
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
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
        >
          {t('confirmChoices')}
        </button>
      </form>
    </section>
  );
}

/** The customer's decisions on the current revision, after they confirmed. */
export function EstimateChoicesApi({
  revision,
  items,
  fresh,
}: {
  revision: number;
  items: EstimateItem[];
  fresh: boolean;
}) {
  const t = useTranslations('request');
  return (
    <section className="mt-6 rounded-tile border border-line-card p-4">
      {fresh ? (
        <p role="status" className="mb-3 rounded-lg bg-success-bg px-3 py-2 text-sm font-bold text-success">
          {t('approvedDone')}
        </p>
      ) : null}
      <h3 className="font-heading font-bold text-ink">{t('yourChoices', { version: revision })}</h3>
      <ul className="mt-2 divide-y divide-line-card text-sm">
        {items.map((l) => (
          <li key={l.id} className="flex flex-wrap justify-between gap-x-3 py-2">
            <span
              data-user-content
              className={l.decision === 'declined' ? 'text-muted line-through' : 'text-ink'}
            >
              {l.description}
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
