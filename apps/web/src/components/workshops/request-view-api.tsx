'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ServiceRequestDetail } from '@mechdost/shared/service-api';
import { SERVICE_CANCEL_REASONS } from '@mechdost/shared/state';
import { lazy, Suspense, useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import {
  CUSTOMER_STEPS,
  customerMayCancel,
  customerStepIndex,
  rangeOf,
  serviceErrorKey,
} from '@/lib/service-views';
import { StatusTimeline } from '../commerce/status-timeline';
import { ServiceBillView } from './service-estimate';
import { EstimateApprovalApi, EstimateChoicesApi } from './service-estimate-api';

/** Workshop review once the service is paid (spec 06): its own chunk, fetched only then. */
const WriteReviewApi = lazy(() =>
  import('../reviews/write-review-api').then((m) => ({ default: m.WriteReviewApi })),
);

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; req: ServiceRequestDetail };
const POLL_MS = 30_000;
const box = 'rounded-card border border-line-card bg-surface p-6 shadow-card';

/**
 * Service request on the API (real data mode; spec 06, Stream E): `GET /v1/service-requests/{code}` for the signed-in
 * customer — status stepper, the workshop's proposal to accept or turn down, the estimate to approve line by line
 * with consent, the bill, and "cancel" until the workshop has the vehicle. Every action sends the request's
 * `version` and reloads; the page also refreshes every 30 seconds while open (live pings come later).
 */
export function RequestViewApi({ code }: { code: string }) {
  const t = useTranslations('request');
  const w = useTranslations('workshop');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [justDecided, setJustDecided] = useState(false);
  const prefix = locale === 'hi' ? '/hi' : '';

  const refresh = useCallback(async () => {
    const { fetchMyServiceRequest } = await import('@/lib/service-api');
    const res = await fetchMyServiceRequest(locale, code);
    setLoad(res.ok ? { kind: 'ok', req: res.data } : { kind: 'error', code: res.code });
  }, [code, locale]);

  useEffect(() => {
    if (!code) return;
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [code, refresh]);

  if (!code || (load.kind === 'error' && (load.code === 'NOT_FOUND' || load.code === 'HTTP_404')))
    return (
      <div className={box}>
        <p className="text-muted">{t('api_notFound')}</p>
        <Link
          href={`${prefix}/account/services`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white"
        >
          {t('api_allRequests')}
        </Link>
      </div>
    );
  if (load.kind === 'error' && load.code === 'AUTH_REQUIRED')
    return (
      <div className={box}>
        <p className="text-ink">{t('api_signIn')}</p>
        <Link
          href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/service/${code}`)}`}
          className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('api_signInLink')}
        </Link>
      </div>
    );
  if (load.kind === 'error')
    return (
      <div className={`${box} flex flex-wrap items-center gap-3`}>
        <p role="alert" className="font-bold text-ink">
          {t(serviceErrorKey(load.code) as 'api_err_generic')}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
        >
          {t('api_retry')}
        </button>
      </div>
    );
  if (load.kind === 'loading')
    return (
      <p role="status" className={`${box} text-muted`}>
        {t('api_loading')}
      </p>
    );

  const req = load.req;
  const workshopName = req.workshop?.name ?? null;
  const range = req.proposal
    ? { low: req.proposal.lowPaise, high: req.proposal.highPaise }
    : rangeOf(req.services);
  const slot = req.proposal?.slot ?? req.preferredSlot;
  const step = customerStepIndex(req.status);
  const steps = CUSTOMER_STEPS.map((s) => ({
    key: s,
    title: t(`step_${s}`),
    detail: s === 'requested' && req.status === 'proposed' ? t('stepDetail_proposed') : t(`stepDetail_${s}`),
  }));
  const noWork = req.status === 'no_work_approved' || (req.status === 'completed' && req.bill === null);
  const estimate = req.estimate;
  const cancelReason = SERVICE_CANCEL_REASONS.find((x) => x === req.reasonCode);

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_380px] nav:items-start">
      <div className="space-y-6">
        {isNew && req.status !== 'cancelled' ? (
          <div
            role="status"
            className="animate-page-in flex items-center gap-3 rounded-card bg-success-bg p-5 text-success"
          >
            <PartyPopper aria-hidden="true" className="size-6 shrink-0" />
            <p className="font-heading font-bold">
              {workshopName ? t('thanks', { workshop: workshopName }) : t('api_thanksChoose')}
            </p>
          </div>
        ) : null}
        <section className={box}>
          <h2 className="font-heading text-lg font-extrabold text-ink">{t('statusLabel')}</h2>
          {req.status === 'needs_routing' ? (
            <p
              role="status"
              className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning"
            >
              {t('api_findingWorkshop')}
            </p>
          ) : null}
          {req.status === 'cancelled' ? (
            <div id="request-cancelled" role="status" tabIndex={-1} className="mt-5 rounded-tile bg-pill p-5">
              <p className="font-heading font-bold text-ink">{t('cancelledTitle')}</p>
              <p className="mt-1 text-sm text-muted">
                {t('api_cancelledOn', { date: formatDate(req.updatedAt, locale) })}
                {cancelReason ? ` · ${t(`cancelReason_${cancelReason}`)}` : ''}
              </p>
            </div>
          ) : req.status === 'rejected' ? (
            <div role="status" className="mt-5 rounded-tile bg-pill p-5">
              <p className="font-heading font-bold text-ink">{t('api_rejectedTitle')}</p>
              {req.customerMessage ? (
                <p className="mt-1 text-sm text-muted" data-user-content>
                  {req.customerMessage}
                </p>
              ) : null}
            </div>
          ) : noWork ? (
            <div role="status" className="mt-5 rounded-tile bg-pill p-5">
              <p className="font-heading font-bold text-ink">{t('noWorkTitle')}</p>
              <p className="mt-1 text-sm text-muted">
                {req.status === 'completed'
                  ? t('noWorkClosed', { date: formatDate(req.updatedAt, locale) })
                  : t('noWorkBody', { workshop: workshopName ?? '' })}
              </p>
            </div>
          ) : step !== null ? (
            <div className="mt-5">
              <StatusTimeline
                label={t('statusLabel')}
                steps={steps}
                current={step}
                currentLabel={t('current')}
              />
            </div>
          ) : null}

          {req.status === 'proposed' && req.proposal ? <ProposalBox req={req} onChanged={refresh} /> : null}
          {req.status === 'estimate_sent' && estimate?.status === 'sent' ? (
            <EstimateApprovalApi
              key={`${req.code}-r${String(estimate.revision)}`}
              code={req.code}
              version={req.version}
              revision={estimate.revision}
              items={estimate.items}
              onChanged={async (decided) => {
                setJustDecided(decided);
                await refresh();
              }}
            />
          ) : null}
          {estimate?.status === 'decided' && req.status !== 'estimate_sent' && !req.bill ? (
            <EstimateChoicesApi
              revision={estimate.revision}
              items={estimate.items}
              fresh={justDecided && req.status === 'approved'}
            />
          ) : null}
          {req.bill ? (
            <ServiceBillView
              bill={req.bill}
              workshopName={workshopName ?? ''}
              gstRegistered={req.bill.gstRegistered}
              requestCode={req.code}
            />
          ) : null}
          {customerMayCancel(req.status) ? <CancelRequestApi req={req} onChanged={refresh} /> : null}
        </section>
        {req.status === 'paid' || req.status === 'completed' ? (
          <Suspense fallback={null}>
            <WriteReviewApi kind="service" code={req.code} />
          </Suspense>
        ) : null}
      </div>

      <aside className="space-y-4 rounded-card border border-line-card bg-surface p-6 text-sm shadow-card">
        <div>
          <h2 className="font-heading font-bold text-ink">{workshopName ?? t('api_workshopPending')}</h2>
          {req.workshop ? <p className="text-muted">{req.workshop.area}</p> : null}
          {req.workshop?.phone ? (
            <a
              href={`tel:${req.workshop.phone}`}
              className="inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
            >
              {t('api_callWorkshop')}
            </a>
          ) : null}
          <p className="text-muted">{formatDate(req.createdAt, locale)}</p>
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('vehicle')}</h3>
          <p className="text-muted">
            {req.vehicle.type} · <span data-user-content>{req.vehicle.text}</span>
          </p>
          {req.odometerKm !== null ? (
            <p className="text-muted">
              {t('odometer', { km: new Intl.NumberFormat('en-IN').format(req.odometerKm) })}
            </p>
          ) : null}
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('when')}</h3>
          <p className="text-muted">
            {formatDate(req.proposal?.date ?? req.preferredDate, locale)} · {w(slot)}
          </p>
          {req.pickup ? <p className="text-muted">{w('api_pickup')}</p> : null}
        </div>
        {req.services.length > 0 ? (
          <div>
            <h3 className="font-bold text-ink">{t('services')}</h3>
            <ul className="mt-1 space-y-1">
              {req.services.map((s) => (
                <li key={s.key} className="flex justify-between gap-3">
                  <span>{s.title}</span>
                  <span className="text-muted">
                    {formatPrice(s.lowPaise)}–{formatPrice(s.highPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {range.high > 0 ? (
          <p className="font-bold text-ink">
            {w('estimate', { min: formatPrice(range.low), max: formatPrice(range.high) })}
          </p>
        ) : null}
        {req.concern ? (
          <p data-user-content className="rounded-lg bg-surface-alt p-3 text-muted">
            {req.concern}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function ProposalBox({ req, onChanged }: { req: ServiceRequestDetail; onChanged: () => Promise<void> }) {
  const t = useTranslations('request');
  const w = useTranslations('workshop');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = req.proposal;
  if (!p) return null;

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);
    const { decideProposal } = await import('@/lib/service-api');
    const res = await decideProposal(locale, req.code, accept, req.version);
    setBusy(false);
    if (!res.ok) setError(res.code);
    else
      track('click', {
        id: accept ? 'service_proposal_accepted' : 'service_proposal_declined',
        path: window.location.pathname,
      });
    await onChanged();
  }

  return (
    <div
      className="mt-6 rounded-tile border border-accent-soft bg-accent-soft p-4"
      aria-busy={busy || undefined}
    >
      <p className="text-sm font-bold text-accent-soft-text">
        {t('proposal', {
          date: formatDate(p.date, locale),
          slot: w(p.slot),
          min: formatPrice(p.lowPaise),
          max: formatPrice(p.highPaise),
        })}
      </p>
      {p.note ? (
        <p data-user-content className="mt-1 text-sm text-ink">
          “{p.note}”
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-error">
          {t(serviceErrorKey(error) as 'api_err_generic')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
        >
          {t('accept')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-ink underline-offset-4 hover:underline disabled:opacity-70"
        >
          {t('api_proposalDecline')}
        </button>
      </div>
    </div>
  );
}

/** Cancel until the workshop has the vehicle (spec 06), with a reason code nobody picked for the customer. */
function CancelRequestApi({ req, onChanged }: { req: ServiceRequestDetail; onChanged: () => Promise<void> }) {
  const t = useTranslations('request');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const picked = new FormData(e.currentTarget).get('reasonCode');
    const reasonCode = SERVICE_CANCEL_REASONS.find((r) => r === picked);
    if (!reasonCode) {
      setMissing(true);
      document.getElementById('request-cancel-reason')?.focus();
      return;
    }
    setBusy(true);
    const { cancelServiceRequest } = await import('@/lib/service-api');
    const res = await cancelServiceRequest(locale, req.code, reasonCode, req.version);
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      await onChanged();
      return;
    }
    track('booking_cancelled', { code: req.code, workshop: req.workshop?.slug ?? 'mechdost', reasonCode });
    await onChanged();
    requestAnimationFrame(() => document.getElementById('request-cancelled')?.focus());
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {t('cancelAction')}
      </button>
    );
  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-5 space-y-2 rounded-tile border border-line-card p-4"
    >
      <p className="text-sm text-ink">{t('cancelNote')}</p>
      <label htmlFor="request-cancel-reason" className="text-sm font-bold text-ink">
        {t('cancelReasonLabel')}
      </label>
      <select
        id="request-cancel-reason"
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
      {error ? (
        <p role="alert" className="text-xs font-bold text-error">
          {t(serviceErrorKey(error) as 'api_err_generic')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="press inline-flex min-h-11 items-center rounded-button border border-ink px-4 text-sm font-bold text-ink hover:bg-surface-alt disabled:opacity-70"
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
