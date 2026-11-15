'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  ServiceChangedDto,
  ServiceRequestDetailDto,
  ServiceRequestPageDto,
  type ServiceRequestDetail,
  type ServiceRequestSummary,
} from '@mechdost/shared/service-api';
import { computeServiceBill } from '@mechdost/shared/service-bill';
import { SERVICE_DECLINE_REASONS, type ServiceDeclineReason } from '@mechdost/shared/state';
import { VEHICLE_ICON } from '@mechdost/shared/vehicles';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { homeJobNextAction, validMechanicName } from '@/lib/home-service-views';
import { rangeOf, requestStatusKey, rupeesToPaise, workshopMayRevise } from '@/lib/service-views';
import { ApiListState, LoadMore } from './api-list-state';
import { ArrivalFormApi, HomeJobExtrasApi, HomeSettingsApi } from './home-visit-portal-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';
import { ServiceApiError } from './service-api-error';
import { PushPromptSlot } from '../notices/push-prompt-slot';
import { useApiList } from './use-api-list';
import { JobPhotosPanelLazy } from '../photos/photos-lazy';
import { EstimateBuilderApi, JobStepsApi, OdometerFormApi } from './workshop-job-api';
import { HourPickerApi, MyWorkshopApi } from './workshop-tier1-api';
import { isTier1Error, Tier1Error } from '../workshops/tier1-error';

const NEW_POLL_MS = 30_000;
const loc = (locale: string) => (locale === 'hi' ? 'hi' : 'en');

/**
 * Workshop portal on the API (spec 06/07, real sign-in only; loaded by `workshop-portal.tsx` on demand so demo
 * builds do not carry it): new requests to propose a slot and cost for (or decline with a reason), jobs with one
 * next step each (vehicle received + odometer, estimate, start, ready, bill, paid), and recently closed requests.
 * The API scopes everything to the workshops in the signed-in person's grants; every step sends the `version`.
 */
export function WorkshopRequestsApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const page = useCallback(
    (view: 'new' | 'active' | 'done') => async (cursor: string | null) => {
      const q = new URLSearchParams({ view, locale: loc(locale) });
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/workshop/requests?${q.toString()}`, ServiceRequestPageDto);
      return res.ok ? { ok: true as const, data: { items: res.data.items, next: res.data.nextCursor } } : res;
    },
    [locale],
  );
  const newPage = useCallback((c: string | null) => page('new')(c), [page]);
  const activePage = useCallback((c: string | null) => page('active')(c), [page]);
  const donePage = useCallback((c: string | null) => page('done')(c), [page]);
  const fresh = useApiList(newPage, NEW_POLL_MS);
  const active = useApiList(activePage, NEW_POLL_MS);
  const done = useApiList(donePage);
  const refresh = useCallback(async () => {
    await Promise.all([fresh.reload(), active.reload(), done.reload()]);
  }, [fresh, active, done]);
  const name = [...fresh.items, ...active.items, ...done.items].find((x) => x.workshop)?.workshop?.name;

  return (
    <>
      <PushPromptSlot />
      {name ? (
        <section className="blueprint rounded-card p-6 text-white shadow-card">
          <h2 className="font-heading text-2xl font-extrabold">🔧 {name}</h2>
        </section>
      ) : null}

      <MyWorkshopApi />

      <HomeSettingsApi />

      <section aria-labelledby="new-requests">
        <h2 id="new-requests" className="font-heading text-xl font-extrabold text-ink">
          {t('newRequests')}{' '}
          {fresh.loading ? null : <span className="text-muted tabular-nums">({fresh.items.length})</span>}
        </h2>
        <ApiListState
          loading={fresh.loading}
          error={fresh.error}
          count={fresh.items.length}
          empty={t('noneRequests')}
          onRetry={() => void fresh.reload()}
        />
        {fresh.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {fresh.items.map((r) => (
              <li key={`${r.code}-${String(r.version)}`}>
                <NewRequestApi request={r} onChanged={refresh} />
              </li>
            ))}
          </ul>
        ) : null}
        <LoadMore show={Boolean(fresh.next)} onClick={() => void fresh.loadMore()} />
      </section>

      <section aria-labelledby="jobs-title">
        <h2 id="jobs-title" className="font-heading text-xl font-extrabold text-ink">
          {t('jobs')}
        </h2>
        <ApiListState
          loading={active.loading}
          error={active.error}
          count={active.items.length}
          empty={t('noneJobs')}
          onRetry={() => void active.reload()}
        />
        {active.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {active.items.map((r) => (
              <li key={r.code}>
                <JobCardApi summary={r} onChanged={refresh} />
              </li>
            ))}
          </ul>
        ) : null}
        <LoadMore show={Boolean(active.next)} onClick={() => void active.loadMore()} />
      </section>

      <section aria-labelledby="completed-jobs">
        <h2 id="completed-jobs" className="font-heading text-xl font-extrabold text-ink">
          {t('completedJobs')}
        </h2>
        <ApiListState
          loading={done.loading}
          error={done.error}
          count={done.items.length}
          empty={t('noneCompleted')}
          onRetry={() => void done.reload()}
        />
        {done.items.length > 0 ? <DoneList items={done.items} /> : null}
        <LoadMore show={Boolean(done.next)} onClick={() => void done.loadMore()} />
      </section>
    </>
  );
}

function DoneList({ items }: { items: ServiceRequestSummary[] }) {
  const s = useTranslations('request');
  const locale = useLocale();
  return (
    <ul className={`mt-3 divide-y divide-line-card ${portalCard}`}>
      {items.map((r) => (
        <li key={r.code} className="flex flex-wrap justify-between gap-x-4 py-2 text-sm">
          <span className="font-heading font-extrabold text-ink">{r.code}</span>
          <span className="text-muted">
            {formatDate(r.updatedAt, locale)} · {s(requestStatusKey(r.status) as 'stage_requested')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Status, code, vehicle, preferred time, the services asked for; the customer once the visit is confirmed. */
function SummaryHead({
  request: r,
  detail,
}: {
  request: ServiceRequestSummary | ServiceRequestDetail;
  detail?: ServiceRequestDetail | null;
}) {
  const t = useTranslations('portal');
  const s = useTranslations('request');
  const locale = useLocale();
  const customer = detail?.customer;
  return (
    <>
      <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
        {s(requestStatusKey(r.status) as 'stage_requested')}
      </p>
      <p className="font-heading text-lg font-extrabold text-ink">{r.code}</p>
      <p className="text-sm text-muted">
        {VEHICLE_ICON[r.vehicle.type]} <span data-user-content>{r.vehicle.text}</span> ·{' '}
        {formatDate(r.preferredDate, locale)}, {t(`slot_${r.preferredSlot}`)}
      </p>
      {customer?.name || customer?.phone ? (
        <p className="mt-1 text-sm text-ink">
          <span data-user-content>{customer.name}</span>
          {customer.phone ? (
            <>
              {' · '}
              <a
                href={`tel:${customer.phone}`}
                className="font-bold text-accent-soft-text underline-offset-4 hover:underline"
              >
                {customer.phone}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {r.services.length > 0 ? (
        <p className="mt-2 text-sm text-ink">
          {t('customerAsked', { services: r.services.map((x) => x.title).join(', ') })}
        </p>
      ) : null}
      {detail?.concern ? (
        <p data-user-content className="mt-1 text-sm text-muted">
          “{detail.concern}”
        </p>
      ) : null}
    </>
  );
}

/** A new request: propose a date, part of the day and expected cost, or decline with a reason (never preselected). */
function NewRequestApi({
  request: r,
  onChanged,
}: {
  request: ServiceRequestSummary;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const h = useTranslations('homeService');
  const w1 = useTranslations('workshopTier1');
  const locale = useLocale();
  const [detail, setDetail] = useState<ServiceRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState(false);
  const [mechanicError, setMechanicError] = useState(false);
  const [date, setDate] = useState(r.preferredDate.slice(0, 10));
  const [hourError, setHourError] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<ServiceDeclineReason | ''>('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const range = rangeOf(r.services);
  const id = (k: string) => `${r.code}-${k}`;

  // The concern ("Let MechDost choose" requests have only that) lives in the detail.
  useEffect(() => {
    let live = true;
    void adminApi(
      locale,
      `/workshop/requests/${encodeURIComponent(r.code)}?locale=${loc(locale)}`,
      ServiceRequestDetailDto,
    ).then((res) => {
      if (live && res.ok) setDetail(res.data);
    });
    return () => {
      live = false;
    };
  }, [locale, r.code]);

  async function post(path: string, body: Record<string, unknown>, trackId: string) {
    setBusy(true);
    setError(null);
    const res = await adminApi(
      locale,
      `/workshop/requests/${encodeURIComponent(r.code)}/${path}`,
      ServiceChangedDto,
      { method: 'POST', body: { ...body, version: r.version } },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      if (res.code !== 'VALIDATION' && res.code !== 'RANGE') await onChanged();
      return;
    }
    track('click', { id: trackId, path: window.location.pathname });
    await onChanged();
  }

  function onPropose(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const low = rupeesToPaise(text('min'));
    const high = rupeesToPaise(text('max'));
    const hour = Number(text('hour'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || low === null || high === null || low <= 0 || high < low) {
      setFormError(true);
      document.getElementById(id('min'))?.focus();
      return;
    }
    setFormError(false);
    if (text('hour') === '' || !Number.isInteger(hour)) {
      setHourError(true);
      document.getElementById(id('hour'))?.focus();
      return;
    }
    setHourError(false);
    const mechanic = text('mechanic');
    if (r.serviceMode === 'home' && !validMechanicName(mechanic)) {
      setMechanicError(true);
      document.getElementById(id('mechanic'))?.focus();
      return;
    }
    setMechanicError(false);
    const note = text('note').slice(0, 300);
    void post(
      'propose',
      {
        date,
        hour,
        lowPaise: low,
        highPaise: high,
        ...(note ? { note } : {}),
        ...(r.serviceMode === 'home' ? { mechanicName: mechanic } : {}),
      },
      'workshop_proposal_sent',
    );
  }

  function onDecline() {
    if (!reason) {
      setMissing(true);
      document.getElementById(id('reason'))?.focus();
      return;
    }
    void post('decline', { reasonCode: reason }, 'workshop_request_declined');
  }

  return (
    <article className={`${portalCard} border-accent-button/50`} aria-busy={busy || undefined}>
      <SummaryHead request={r} detail={detail} />
      {detail?.reschedule.from ? (
        <p role="status" className="mt-2 rounded-tile bg-pill p-3 text-sm font-bold text-ink">
          {w1('customerMoved', {
            from: `${formatDate(detail.reschedule.from.date, locale)}, ${t(`slot_${detail.reschedule.from.slot}`)}`,
            to: `${formatDate(detail.preferredDate, locale)}, ${t(`slot_${detail.preferredSlot}`)}`,
          })}
        </p>
      ) : null}
      {hourError ? (
        <p id={id('hour-error')} role="alert" className="mt-2 text-sm font-bold text-error">
          {w1('hourRequired')}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          {isTier1Error(error) ? <Tier1Error code={error} /> : <ServiceApiError code={error} />}
        </div>
      ) : null}
      {declining ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <label htmlFor={id('reason')} className="text-sm font-bold text-ink">
            {t('ws_api_declineReason')}
          </label>
          <select
            id={id('reason')}
            value={reason}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? id('reason-error') : undefined}
            onChange={(e) => {
              setReason(SERVICE_DECLINE_REASONS.find((x) => x === e.target.value) ?? '');
              setMissing(false);
            }}
            className={portalField}
          >
            <option value="">{t('ws_api_reasonChoose')}</option>
            {SERVICE_DECLINE_REASONS.map((x) => (
              <option key={x} value={x}>
                {t(`ws_api_declineReason_${x}`)}
              </option>
            ))}
          </select>
          {missing ? (
            <p id={id('reason-error')} className="text-xs font-bold text-error">
              {t('ws_api_reasonRequired')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={onDecline} className={`${portalPrimary} flex-1`}>
              {t('ws_api_declineConfirm')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeclining(false);
              }}
              className={portalQuiet}
            >
              {t('ws_api_keepRequest')}
            </button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={onPropose} className="mt-4 space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-extrabold text-ink">{t('propose')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={id('date')} className="text-xs font-bold text-muted">
                {t('proposeDate')}
              </label>
              <input
                id={id('date')}
                name="date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
                className={portalField}
              />
            </div>
            <HourPickerApi
              workshopId={detail?.workshop?.id ?? null}
              date={date}
              id={id('hour')}
              invalid={hourError}
              describedBy={hourError ? id('hour-error') : undefined}
            />
            <div>
              <label htmlFor={id('min')} className="text-xs font-bold text-muted">
                {t('minCost')}
              </label>
              <input
                id={id('min')}
                name="min"
                inputMode="numeric"
                defaultValue={range.low > 0 ? range.low / 100 : ''}
                aria-invalid={formError ? true : undefined}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor={id('max')} className="text-xs font-bold text-muted">
                {t('maxCost')}
              </label>
              <input
                id={id('max')}
                name="max"
                inputMode="numeric"
                defaultValue={range.high > 0 ? range.high / 100 : ''}
                aria-invalid={formError ? true : undefined}
                className={portalField}
              />
            </div>
          </div>
          {r.serviceMode === 'home' ? (
            <div>
              <label htmlFor={id('mechanic')} className="text-xs font-bold text-muted">
                {h('mechanicLabel')}
              </label>
              <input
                id={id('mechanic')}
                name="mechanic"
                maxLength={30}
                autoComplete="off"
                aria-invalid={mechanicError ? true : undefined}
                aria-describedby={id('mechanic-hint')}
                className={portalField}
              />
              <p
                id={id('mechanic-hint')}
                className={`mt-1 text-xs ${mechanicError ? 'font-bold text-error' : 'text-muted'}`}
              >
                {mechanicError ? h('errMechanic') : h('mechanicHint')}
              </p>
            </div>
          ) : null}
          <div>
            <label htmlFor={id('note')} className="text-xs font-bold text-muted">
              {t('proposalNote')}
            </label>
            <input id={id('note')} name="note" maxLength={300} className={portalField} />
          </div>
          {formError ? (
            <p role="alert" className="text-sm font-bold text-error">
              {t('errProposal')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={`${portalPrimary} flex-1`}>
              {t('sendProposal')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeclining(true);
              }}
              className={portalQuiet}
            >
              {t('decline')}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

/** One job: loads its detail (estimate, bill, customer) and shows the one next step for its status. */
function JobCardApi({
  summary,
  onChanged,
}: {
  summary: ServiceRequestSummary;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const w = useTranslations('workshop');
  const locale = useLocale();
  const [detail, setDetail] = useState<ServiceRequestDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);

  const load = useCallback(async () => {
    const res = await adminApi(
      locale,
      `/workshop/requests/${encodeURIComponent(summary.code)}?locale=${loc(locale)}`,
      ServiceRequestDetailDto,
    );
    if (res.ok) {
      setDetail(res.data);
      setLoadError(null);
    } else setLoadError(res.code);
  }, [locale, summary.code]);

  // Reload whenever the list says the request moved (its version changed).
  useEffect(() => {
    void load();
  }, [load, summary.version]);

  const changed = useCallback(async () => {
    setRevising(false);
    await Promise.all([load(), onChanged()]);
  }, [load, onChanged]);

  if (!detail)
    return (
      <article className={portalCard}>
        <SummaryHead request={summary} />
        {loadError ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ServiceApiError code={loadError} />
            <button type="button" onClick={() => void load()} className={portalQuiet}>
              {t('api_retry')}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{t('api_loading')}</p>
        )}
      </article>
    );

  const action = homeJobNextAction(detail);
  const est = detail.estimate;
  // The estimate's full value as sent, whatever the customer decided (the bill counts approved lines only).
  const estTotal = est
    ? computeServiceBill(
        est.items.map((l) => ({ ...l, decision: 'approved' as const })),
        { gstRegistered: true },
      ).totalPaise
    : 0;

  return (
    <article className={portalCard}>
      <SummaryHead request={detail} detail={detail} />
      {detail.proposal && action === 'wait_customer' ? (
        <p className="mt-3 rounded-lg bg-accent-soft p-3 text-sm font-bold text-accent-soft-text">
          {t('waitingCustomer')} · {formatDate(detail.proposal.date, locale)}, {w(detail.proposal.slot)} ·{' '}
          {formatPrice(detail.proposal.lowPaise)} – {formatPrice(detail.proposal.highPaise)}
        </p>
      ) : null}
      {detail.odometerKm !== null ? (
        <p className="mt-2 text-xs text-muted">
          {t('ws_api_odometerAt', { km: new Intl.NumberFormat('en-IN').format(detail.odometerKm) })}
        </p>
      ) : null}
      <HomeJobExtrasApi detail={detail} onDone={changed} />
      <JobPhotosPanelLazy code={detail.code} status={detail.status} />
      {est && !revising && action !== 'estimate' ? (
        <div className="mt-3 rounded-lg bg-surface-alt p-3 text-sm">
          <p className="font-bold text-ink">
            {t('estimateSummary', { version: est.revision, total: formatPrice(estTotal) })}
          </p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {est.items.map((l) => (
              <li key={l.id} className={l.decision === 'declined' ? 'line-through' : undefined}>
                <span data-user-content>{l.description}</span> · {l.qty} × {formatPrice(l.unitPaise)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {revising && est ? (
        <EstimateBuilderApi
          detail={detail}
          initial={(est.items.some((l) => l.decision === 'approved')
            ? est.items.filter((l) => l.decision === 'approved')
            : est.items
          ).map((l) => ({
            description: l.description,
            serviceKey: l.serviceKey,
            qty: l.qty,
            unitPaise: l.unitPaise,
            gstRateBp: l.gstRateBp,
          }))}
          title={t('estimateRevision', { version: est.revision + 1 })}
          onDone={changed}
          onCancel={() => {
            setRevising(false);
          }}
        />
      ) : action === 'receive' ? (
        detail.serviceMode === 'home' ? (
          <ArrivalFormApi detail={detail} onDone={changed} />
        ) : (
          <OdometerFormApi detail={detail} onDone={changed} />
        )
      ) : action === 'estimate' ? (
        <EstimateBuilderApi
          detail={detail}
          initial={detail.services.map((x) => ({
            description: x.title,
            serviceKey: x.key,
            qty: 1,
            unitPaise: Math.round((x.lowPaise + x.highPaise) / 200) * 100,
            gstRateBp: 1800,
          }))}
          title={t('estimateBuilder')}
          onDone={changed}
        />
      ) : action === 'wait_approval' ? (
        <p className="mt-3 text-sm font-bold text-warning">{t('waitingApproval')}</p>
      ) : action ? (
        <JobStepsApi detail={detail} action={action} onDone={changed} />
      ) : null}
      {workshopMayRevise(detail.status) && est && !revising ? (
        <button
          type="button"
          onClick={() => {
            setRevising(true);
          }}
          className={`${portalQuiet} mt-2 w-full`}
        >
          {t('reviseEstimate')}
        </button>
      ) : null}
    </article>
  );
}
