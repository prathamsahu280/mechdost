'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { SERVICE_CANCEL_REASONS } from '@mechdost/shared/state';
import { useState, type SyntheticEvent } from 'react';
import { advanceRequest } from '@/demo/service-jobs';
import {
  acceptProposal,
  cancelDemoRequest,
  requestAdvanceable,
  requestCancellable,
  requestStage,
  useRequests,
  type DemoServiceRequest,
  type RequestStage,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { formatDate, formatPrice } from '@/lib/format';
import { StatusTimeline } from '../commerce/status-timeline';
import { serviceNameFor, workshopNameFor } from '@/demo/i18n/localize';
import { DEMO_WORKSHOPS, workshopGstRegistered } from '@/demo/workshops';
import { EstimateApproval, EstimateChoices, ServiceBillView } from './service-estimate';
import { SHOW_DEMO_CONTROLS } from '@/lib/data-mode';

/** The customer's stepper (spec 06 UI: Request, Estimate, Approved, In progress, Ready, Billed). */
const STEPS = [
  'requested',
  'confirmed',
  'received',
  'estimate',
  'in_progress',
  'ready',
  'billed',
  'completed',
] as const;
const STEP_OF: Record<Exclude<RequestStage, 'no_work_approved'>, number> = {
  requested: 0,
  proposed: 0,
  confirmed: 1,
  received: 2,
  estimate_sent: 3,
  approved: 4,
  in_progress: 4,
  ready: 5,
  billed: 6,
  completed: STEPS.length, // every step done
};

/**
 * Service request status (spec 06): requested → workshop proposes slot + cost → customer accepts → vehicle
 * received (odometer) → itemised estimate approved line by line → work → ready → bill → paid at the workshop →
 * rate the workshop. Demo controls stand in for the workshop's actions, never the customer's.
 */
export function RequestView({ code }: { code: string }) {
  const t = useTranslations('request');
  const w = useTranslations('workshop');
  const demo = useTranslations('demo');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const request = useRequests().find((r) => r.code === code);
  const base = locale === 'hi' ? '/hi' : '';
  const [justDecided, setJustDecided] = useState(false);

  if (!request) {
    return (
      <div className="rounded-card border border-line-card bg-surface p-8 shadow-card">
        <p className="text-muted">{t('notFound')}</p>
        <Link
          href={`${base}/workshops`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white"
        >
          {w('back')}
        </Link>
      </div>
    );
  }

  // The workshop's own proposal when it made one; otherwise the menu ranges of the requested services.
  const min = request.proposal?.minPaise ?? request.services.reduce((s, x) => s + x.minPaise, 0);
  const max = request.proposal?.maxPaise ?? request.services.reduce((s, x) => s + x.maxPaise, 0);
  const slotLabel = w(request.proposal?.slot ?? request.slot);
  const stage = requestStage(request);
  const steps = STEPS.map((s) => ({
    key: s,
    title: t(`step_${s}`),
    detail: s === 'requested' && stage === 'proposed' ? t('stepDetail_proposed') : t(`stepDetail_${s}`),
  }));
  const proposed = stage === 'proposed' && !request.cancellation;
  const noWork = !request.cancellation && (stage === 'no_work_approved' || Boolean(request.closedAt));
  const estimate = request.cancellation ? undefined : request.estimate;
  const workshopName = workshopNameFor(request.workshopSlug, request.workshopName, locale);
  // A decline and a reassignment are told to the customer, not done silently (QA 2026-11-14, U7).
  const declinedBy = request.declinedBy ?? [];
  const waitingForAnother = !request.cancellation && declinedBy.includes(request.workshopSlug);
  const previous = declinedBy.at(-1);
  const previousName = previous
    ? workshopNameFor(previous, DEMO_WORKSHOPS.find((w) => w.slug === previous)?.name ?? previous, locale)
    : null;
  const movedNote =
    !request.cancellation && !waitingForAnother && previousName && request.stage === 0
      ? t('reassignedTo', { previous: previousName, workshop: workshopName })
      : null;

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_380px] nav:items-start">
      <div className="space-y-6">
        {isNew ? (
          <div
            role="status"
            className="animate-page-in flex items-center gap-3 rounded-card bg-success-bg p-5 text-success"
          >
            <PartyPopper aria-hidden="true" className="size-6 shrink-0" />
            <p className="font-heading font-bold">{t('thanks', { workshop: workshopName })}</p>
          </div>
        ) : null}
        <section className="rounded-card border border-line-card bg-surface p-6 shadow-card">
          <h2 className="font-heading text-lg font-extrabold text-ink">{t('statusLabel')}</h2>
          {waitingForAnother || movedNote ? (
            <p
              role="status"
              className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning"
            >
              {waitingForAnother ? t('declinedFinding', { workshop: workshopName }) : movedNote}
            </p>
          ) : null}
          {noWork ? (
            <div role="status" className="mt-5 rounded-tile bg-pill p-5 text-ink">
              <p className="font-heading font-bold">{t('noWorkTitle')}</p>
              <p className="mt-1 text-sm text-muted">
                {request.closedAt
                  ? t('noWorkClosed', { date: formatDate(request.closedAt, locale) })
                  : t('noWorkBody', { workshop: workshopName })}
              </p>
            </div>
          ) : request.cancellation ? (
            <div
              id="request-cancelled"
              role="status"
              tabIndex={-1}
              className="mt-5 rounded-tile bg-pill p-5 text-ink"
            >
              <p className="font-heading font-bold">{t('cancelledTitle')}</p>
              <p className="mt-1 text-sm text-muted">
                {t('cancelledOn', { date: formatDate(request.cancellation.at, locale) })} ·{' '}
                {t(`cancelReason_${request.cancellation.reasonCode}`)}
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <StatusTimeline
                label={t('statusLabel')}
                steps={steps}
                current={stage === 'no_work_approved' ? 0 : STEP_OF[stage]}
                currentLabel={t('current')}
              />
            </div>
          )}
          {proposed ? (
            <div className="mt-6 rounded-tile border border-accent-soft bg-accent-soft p-4">
              <p className="text-sm font-bold text-accent-soft-text">
                {t('proposal', {
                  date: formatDate(request.proposal?.date ?? request.date, locale),
                  slot: slotLabel,
                  min: formatPrice(min),
                  max: formatPrice(max),
                })}
              </p>
              {request.proposal?.note ? (
                <p data-user-content className="mt-1 text-sm text-ink">
                  “{request.proposal.note}”
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  acceptProposal(request.code);
                }}
                className="press mt-3 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
              >
                {t('accept')}
              </button>
            </div>
          ) : null}
          {estimate && stage === 'estimate_sent' ? (
            <EstimateApproval
              key={`${request.code}-v${String(estimate.version)}`}
              request={request}
              estimate={estimate}
              onDecided={() => {
                setJustDecided(true);
              }}
            />
          ) : null}
          {estimate?.decidedAt && stage !== 'estimate_sent' && !request.bill ? (
            <EstimateChoices estimate={estimate} fresh={justDecided && stage === 'approved'} />
          ) : null}
          {request.bill ? (
            <ServiceBillView
              bill={request.bill}
              workshopName={workshopName}
              gstRegistered={workshopGstRegistered(request.workshopSlug)}
            />
          ) : null}
          {stage === 'completed' && !request.closedAt ? (
            <Link
              href={`${base}/workshops/${request.workshopSlug}#reviews-${request.workshopSlug}`}
              className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
            >
              {t('rateWorkshop', { workshop: workshopName })}
            </Link>
          ) : null}
          {requestCancellable(request) ? <CancelRequest request={request} /> : null}
          {SHOW_DEMO_CONTROLS && requestAdvanceable(request) ? (
            <details className="mt-6 rounded-lg border border-dashed border-line p-3 text-sm">
              <summary className="cursor-pointer font-bold text-muted">{demo('controls')}</summary>
              <button
                type="button"
                onClick={() => {
                  advanceRequest(request.code);
                }}
                className="press mt-3 inline-flex min-h-10 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {demo('advance')}
              </button>
            </details>
          ) : null}
        </section>
      </div>

      <aside className="space-y-4 rounded-card border border-line-card bg-surface p-6 shadow-card text-sm">
        <div>
          <h2 className="font-heading font-bold text-ink">{workshopName}</h2>
          <p className="text-muted">{formatDate(request.createdAt, locale)}</p>
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('vehicle')}</h3>
          <p className="text-muted">
            {request.vehicleType} · <span data-user-content>{request.vehicle}</span>
          </p>
          {request.odometerKm !== undefined ? (
            <p className="text-muted">
              {t('odometer', { km: new Intl.NumberFormat('en-IN').format(request.odometerKm) })}
            </p>
          ) : null}
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('when')}</h3>
          <p className="text-muted">
            {formatDate(request.date, locale)} · {slotLabel}
          </p>
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('services')}</h3>
          <ul className="mt-1 space-y-1">
            {request.services.map((s) => (
              <li key={s.key} className="flex justify-between gap-3">
                <span>{serviceNameFor(s.key, s.name, locale)}</span>
                <span className="text-muted">
                  {formatPrice(s.minPaise)}–{formatPrice(s.maxPaise)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-bold text-ink">
            {w('estimate', { min: formatPrice(min), max: formatPrice(max) })}
          </p>
        </div>
        {request.concern ? (
          <p data-user-content className="rounded-lg bg-surface-alt p-3 text-muted">
            {request.concern}
          </p>
        ) : null}
        <p className="text-[11px] text-muted">{demo('note')}</p>
      </aside>
    </div>
  );
}

/** Cancel a booking until the workshop has the vehicle (spec 06), with a reason code. */
function CancelRequest({ request }: { request: DemoServiceRequest }) {
  const t = useTranslations('request');
  const [open, setOpen] = useState(false);
  useDisclosureFocus(open ? 'request-cancel' : null);
  // No reason is chosen for the customer (QA 2026-11-14, U2; rule 16).
  const [missing, setMissing] = useState(false);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const picked = new FormData(e.currentTarget).get('reasonCode');
    const reasonCode = SERVICE_CANCEL_REASONS.find((r) => r === picked);
    if (!reasonCode) {
      setMissing(true);
      document.getElementById('request-cancel-reason')?.focus();
      return;
    }
    if (cancelDemoRequest(request.code, reasonCode)) {
      track('booking_cancelled', { code: request.code, workshop: request.workshopSlug, reasonCode });
      // This form unmounts with the booking closed: keep keyboard focus on the outcome, not on <body>.
      requestAnimationFrame(() => document.getElementById('request-cancelled')?.focus());
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-disclosure-trigger="request-cancel"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {t('cancelAction')}
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-2 rounded-tile border border-line-card p-4">
      <p className="text-sm text-ink">{t('cancelNote')}</p>
      <label htmlFor="request-cancel-reason" className="text-sm font-bold text-ink">
        {t('cancelReasonLabel')}
      </label>
      <select
        id="request-cancel-reason"
        data-disclosure-field="request-cancel"
        name="reasonCode"
        defaultValue=""
        aria-invalid={missing ? true : undefined}
        aria-describedby={missing ? 'request-cancel-reason-error' : undefined}
        onChange={() => {
          setMissing(false);
        }}
        className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
      >
        <option value="">{t('reasonChoose')}</option>
        {SERVICE_CANCEL_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`cancelReason_${r}`)}
          </option>
        ))}
      </select>
      {missing ? (
        <p id="request-cancel-reason-error" className="text-xs font-bold text-error">
          {t('reasonRequired')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="submit"
          className="press inline-flex min-h-11 items-center rounded-button border border-ink px-4 text-sm font-bold text-ink hover:bg-surface-alt"
        >
          {t('cancelConfirm')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-muted hover:text-ink"
        >
          {t('cancelKeep')}
        </button>
      </div>
    </form>
  );
}
