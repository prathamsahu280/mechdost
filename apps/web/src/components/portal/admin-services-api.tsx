'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  ServiceCancelledDto,
  ServiceChangedDto,
  ServiceRequestDetailDto,
  ServiceRequestPageDto,
  WorkshopSuggestionsDto,
  type AdminWorkshop,
  type ServiceRequestDetail,
  type ServiceRequestSummary,
  type WorkshopSuggestion,
} from '@mechdost/shared/service-api';
import {
  SERVICE_DECLINE_REASONS,
  SERVICE_REJECT_REASONS,
  SERVICE_STAFF_CANCEL_REASONS,
  type ServiceRejectReason,
  type ServiceStaffCancelReason,
} from '@mechdost/shared/state';
import { VEHICLE_ICON } from '@mechdost/shared/vehicles';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { requestStatusKey, routableWorkshops } from '@/lib/service-views';
import { useAdminWorkshops } from './admin-workshops-api';
import { ApiListState, LoadMore } from './api-list-state';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';
import { ServiceApiError } from './service-api-error';
import { useApiList } from './use-api-list';

type View = 'needs_routing' | 'awaiting' | 'active' | 'closed';
const VIEWS: readonly View[] = ['needs_routing', 'awaiting', 'active', 'closed'];
const POLL_MS = 30_000;
const SUGGESTIONS = 5;
const loc = (locale: string) => (locale === 'hi' ? 'hi' : 'en');

/**
 * Admin → Services on the API (spec 06/08, real sign-in; Stream E): requests in the staff member's cities by view —
 * needs routing ("Let MechDost choose" and workshop declines), waiting for a workshop, active, closed. A request
 * needing routing (or still waiting) goes to an eligible workshop in one click (same PIN first; paused, suspended,
 * busy or unlisted workshops are never offered) or is rejected with a reason code and a message for the customer.
 */
export function ServiceRoutingApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [view, setView] = useState<View>('needs_routing');
  // Whether this person holds `service:cancel` (the API says so on every page; it still enforces it on the write).
  const [canCancel, setCanCancel] = useState(false);
  const { load: workshops } = useAdminWorkshops();
  const page = useCallback(
    async (cursor: string | null) => {
      const q = new URLSearchParams({ view, locale: loc(locale) });
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/admin/service-requests?${q.toString()}`, ServiceRequestPageDto);
      if (res.ok) setCanCancel(res.data.canCancel === true);
      return res.ok ? { ok: true as const, data: { items: res.data.items, next: res.data.nextCursor } } : res;
    },
    [locale, view],
  );
  const list = useApiList(page, view === 'needs_routing' ? POLL_MS : undefined, ['request']);
  const routable = view === 'needs_routing' || view === 'awaiting';

  return (
    <section aria-labelledby="admin-page-title" className="space-y-4">
      <div role="tablist" aria-label={t('ws_api_servicesTitle')} className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`svc-tab-${v}`}
            aria-selected={view === v}
            aria-controls="svc-panel"
            onClick={() => {
              setView(v);
            }}
            className={`press inline-flex min-h-11 items-center rounded-pill px-4 text-sm font-bold ${
              view === v
                ? 'bg-accent-soft text-accent-soft-text'
                : 'border border-line-card text-ink hover:bg-pill'
            }`}
          >
            {t(`ws_api_view_${v}`)}
          </button>
        ))}
      </div>
      <div id="svc-panel" role="tabpanel" aria-labelledby={`svc-tab-${view}`}>
        <ApiListState
          loading={list.loading}
          error={list.error}
          count={list.items.length}
          empty={t('emptyQueue')}
          onRetry={() => void list.reload()}
        />
        {list.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 xl:grid-cols-2">
            {list.items.map((r) => (
              <li key={`${r.code}-${String(r.version)}`}>
                {routable ? (
                  <RoutingCard
                    request={r}
                    workshops={workshops.kind === 'ok' ? workshops.workshops : null}
                    workshopsError={workshops.kind === 'error' ? workshops.code : null}
                    canCancel={canCancel}
                    onChanged={list.reload}
                  />
                ) : (
                  <RequestCard request={r} canCancel={canCancel} onChanged={list.reload} />
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <LoadMore show={Boolean(list.next)} onClick={() => void list.loadMore()} />
      </div>
    </section>
  );
}

function RequestHead({ request: r }: { request: ServiceRequestSummary }) {
  const s = useTranslations('request');
  const t = useTranslations('portal');
  const locale = useLocale();
  return (
    <>
      <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
        {s(requestStatusKey(r.status) as 'stage_requested')}
      </p>
      <p className="font-heading text-lg font-extrabold text-ink">{r.code}</p>
      <p className="text-sm text-muted">
        {VEHICLE_ICON[r.vehicle.type]} <span data-user-content>{r.vehicle.text}</span> · {r.pincode} ·{' '}
        {formatDate(r.preferredDate, locale)}, {t(`slot_${r.preferredSlot}`)}
      </p>
      <p className="mt-1 text-sm text-ink">
        {r.workshop ? r.workshop.name : s('api_workshopPending')}
        {r.services.length > 0 ? ` · ${r.services.map((x) => x.title).join(', ')}` : ''}
      </p>
    </>
  );
}

const FINISHED: readonly string[] = ['completed', 'cancelled', 'rejected'];

function RequestCard({
  request,
  canCancel,
  onChanged,
}: {
  request: ServiceRequestSummary;
  canCancel: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <article className={adminCard}>
      <RequestHead request={request} />
      {canCancel && !FINISHED.includes(request.status) ? (
        <StaffCancel request={request} onDone={onChanged} />
      ) : null}
    </article>
  );
}

/**
 * Staff cancel (permission `service:cancel`, enforced by the API): a reason code from the closed list, no free text.
 * The customer is told; a paid bill is refunded through the Refunds queue after finance approves.
 */
function StaffCancel({
  request: r,
  onDone,
}: {
  request: ServiceRequestSummary;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ServiceStaffCancelReason | ''>('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `cancel-${r.code}`;

  if (!open)
    return (
      <button
        data-disclosure-trigger={`cancel-${r.code}`}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {t('ws_api_cancelRequest')}
      </button>
    );

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason) {
      setMissing(true);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/service-requests/${encodeURIComponent(r.code)}/cancel`,
      ServiceCancelledDto,
      { method: 'POST', body: { reasonCode: reason, version: r.version } },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: 'admin_service_cancelled', path: window.location.pathname });
    await onDone();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-3 space-y-2 border-t border-line pt-3"
    >
      <p className="text-sm text-muted">{t('ws_api_cancelNote')}</p>
      <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
        {t('ws_api_cancelReasonLabel')}
      </label>
      <select
        id={`${id}-reason`}
        value={reason}
        aria-invalid={missing ? true : undefined}
        aria-describedby={missing ? `${id}-error` : undefined}
        onChange={(e) => {
          setReason(SERVICE_STAFF_CANCEL_REASONS.find((x) => x === e.target.value) ?? '');
          setMissing(false);
        }}
        className={portalField}
      >
        <option value="">{t('ws_api_reasonChoose')}</option>
        {SERVICE_STAFF_CANCEL_REASONS.map((x) => (
          <option key={x} value={x}>
            {t(`ws_api_cancelReason_${x}`)}
          </option>
        ))}
      </select>
      {missing ? (
        <p id={`${id}-error`} className="text-xs font-bold text-error">
          {t('ws_api_reasonRequired')}
        </p>
      ) : null}
      {error ? <ServiceApiError code={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {busy ? t('ws_api_cancelBusy') : t('ws_api_cancelConfirm')}
        </button>
        <button
          data-panel-cancel={`cancel-${r.code}`}
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {t('ws_api_cancel')}
        </button>
      </div>
    </form>
  );
}

/** One ranked suggestion's reasons in words, one line per factor (spec 06 "Ranking": shown with the reasons). */
function SuggestionReasons({ s }: { s: WorkshopSuggestion }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const lines = [
    s.distanceM === null
      ? t('ws_api_suggestNoPin')
      : t('ws_api_suggestDistance', { km: nf.format(s.distanceM / 1000) }),
    s.ratingX100 === null
      ? t('ws_api_suggestNoRating')
      : t('ws_api_suggestRating', { rating: nf.format(s.ratingX100 / 100) }),
    s.acceptancePercent === null
      ? t('ws_api_suggestNoAccept')
      : t('ws_api_suggestAccept', { percent: s.acceptancePercent }),
    s.medianMinutesToPropose === null
      ? t('ws_api_suggestNoSpeed')
      : t('ws_api_suggestSpeed', { minutes: s.medianMinutesToPropose }),
    t('ws_api_suggestLoad', { open: s.openJobs, capacity: s.slotCapacity }),
  ];
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function RoutingCard({
  request: r,
  workshops,
  workshopsError,
  canCancel,
  onChanged,
}: {
  request: ServiceRequestSummary;
  workshops: AdminWorkshop[] | null;
  workshopsError: string | null;
  canCancel: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [detail, setDetail] = useState<ServiceRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    let live = true;
    void adminApi(
      locale,
      `/admin/service-requests/${encodeURIComponent(r.code)}?locale=${loc(locale)}`,
      ServiceRequestDetailDto,
    ).then((res) => {
      if (live && res.ok) setDetail(res.data);
    });
    return () => {
      live = false;
    };
  }, [locale, r.code]);

  // Ranked suggestions (distance, rating, acceptance, speed, load); the plain nearest-PIN list below is the fallback.
  const [ranked, setRanked] = useState<WorkshopSuggestion[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    void adminApi(
      locale,
      `/admin/service-requests/${encodeURIComponent(r.code)}/suggestions?locale=${loc(locale)}`,
      WorkshopSuggestionsDto,
    ).then((res) => {
      if (live) setRanked(res.ok ? res.data.items : 'failed');
    });
    return () => {
      live = false;
    };
  }, [locale, r.code, r.version]);

  const lastDecline = SERVICE_DECLINE_REASONS.find((x) => x === detail?.reasonCode);
  const options = workshops
    ? routableWorkshops(workshops, {
        vehicleType: r.vehicle.type,
        pincode: r.pincode,
        workshopSlug: r.workshop?.slug ?? null,
      }).slice(0, SUGGESTIONS)
    : [];

  async function send(workshopId: string, rank: number | null = null) {
    setBusy(true);
    setError(null);
    const res = await adminApi(
      locale,
      `/admin/service-requests/${encodeURIComponent(r.code)}/reassign`,
      ServiceChangedDto,
      { method: 'POST', body: { workshopId, version: r.version } },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', {
      id:
        rank === null
          ? 'admin_service_routed'
          : rank === 1
            ? 'admin_service_routed_top'
            : 'admin_service_routed_other',
      path: window.location.pathname,
    });
    await onChanged();
  }

  const showRanked = Array.isArray(ranked) && ranked.length > 0;
  return (
    <article className={`${adminCard} border-accent-button/60`} aria-busy={busy || undefined}>
      <RequestHead request={r} />
      {detail?.customer?.name ? (
        <p className="mt-1 text-sm text-muted" data-user-content>
          {detail.customer.name}
          {detail.customer.phone ? ` · ${detail.customer.phone}` : ''}
        </p>
      ) : null}
      {detail?.concern ? (
        <p className="mt-2 rounded-lg bg-surface-alt p-3 text-sm text-ink" data-user-content>
          “{detail.concern}”
        </p>
      ) : null}
      {lastDecline ? (
        <p className="mt-2 text-xs font-bold text-warning">
          {t('ws_api_lastDecline', { reason: t(`ws_api_declineReason_${lastDecline}`) })}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ServiceApiError code={error} />
        </div>
      ) : null}
      {workshopsError ? (
        <div className="mt-3">
          <ServiceApiError code={workshopsError} />
        </div>
      ) : null}
      {ranked === 'failed' && options.length > 0 ? (
        <p className="mt-3 text-xs text-muted">{t('ws_api_suggestFallback')}</p>
      ) : null}
      {showRanked ? (
        <ol className="mt-3 space-y-3">
          {ranked.map((s) => (
            <li key={s.workshopId}>
              <button
                type="button"
                disabled={busy}
                aria-describedby={`why-${r.code}-${s.workshopId}`}
                onClick={() => void send(s.workshopId, s.rank)}
                className={`${s.rank === 1 ? portalPrimary : portalQuiet} w-full justify-between`}
              >
                <span>🔧 {t('assignTo', { workshop: s.name })}</span>
                <span className="text-xs">
                  {s.rank === 1 ? `${t('ws_api_suggestBest')} · ` : ''}
                  {t('ws_api_suggestScore', { percent: Math.round(s.scoreBp / 100) })}
                </span>
              </button>
              <div id={`why-${r.code}-${s.workshopId}`}>
                <SuggestionReasons s={s} />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {workshops && !showRanked && options.length === 0 && ranked !== null ? (
        <p className="mt-3 text-sm text-muted">{t('ws_api_noEligible')}</p>
      ) : null}
      {!showRanked && ranked !== null && options.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {options.map((w, i) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send(w.id)}
                className={`${i === 0 ? portalPrimary : portalQuiet} w-full justify-between`}
              >
                <span>🔧 {t('assignTo', { workshop: locale === 'hi' && w.nameHi ? w.nameHi : w.name })}</span>
                <span className="text-xs">{w.pincode === r.pincode ? t('ws_api_samePin') : w.pincode}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {rejecting ? (
        <RejectForm
          request={r}
          onDone={async () => {
            setRejecting(false);
            await onChanged();
          }}
          onCancel={() => {
            setRejecting(false);
          }}
        />
      ) : (
        <button
          data-disclosure-trigger={`reject-${r.code}`}
          type="button"
          onClick={() => {
            setRejecting(true);
          }}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {t('ws_api_reject')}
        </button>
      )}
      {canCancel ? <StaffCancel request={r} onDone={onChanged} /> : null}
    </article>
  );
}

/** Reject with a reason code and a message the customer reads (10–500 characters); nothing is preselected. */
function RejectForm({
  request: r,
  onDone,
  onCancel,
}: {
  request: ServiceRequestSummary;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [reason, setReason] = useState<ServiceRejectReason | ''>('');
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState<'reason' | 'message' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `reject-${r.code}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason) {
      setInvalid('reason');
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    if (message.trim().length < 10) {
      setInvalid('message');
      document.getElementById(`${id}-message`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/service-requests/${encodeURIComponent(r.code)}/reject`,
      ServiceChangedDto,
      { method: 'POST', body: { reasonCode: reason, message: message.trim(), version: r.version } },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: 'admin_service_rejected', path: window.location.pathname });
    await onDone();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-3 space-y-2 border-t border-line pt-3"
    >
      <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
        {t('ws_api_rejectReason')}
      </label>
      <select
        id={`${id}-reason`}
        value={reason}
        aria-invalid={invalid === 'reason' ? true : undefined}
        onChange={(e) => {
          setReason(SERVICE_REJECT_REASONS.find((x) => x === e.target.value) ?? '');
          setInvalid(null);
        }}
        className={portalField}
      >
        <option value="">{t('ws_api_reasonChoose')}</option>
        {SERVICE_REJECT_REASONS.map((x) => (
          <option key={x} value={x}>
            {t(`ws_api_rejectReason_${x}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-message`} className="text-xs font-bold text-muted">
        {t('ws_api_rejectMessage')}
      </label>
      <textarea
        id={`${id}-message`}
        value={message}
        rows={3}
        maxLength={500}
        aria-invalid={invalid === 'message' ? true : undefined}
        onChange={(e) => {
          setMessage(e.target.value);
          setInvalid(null);
        }}
        className={`${portalField} py-2`}
      />
      {invalid ? (
        <p className="text-xs font-bold text-error">
          {invalid === 'reason' ? t('ws_api_reasonRequired') : t('ws_api_rejectMessageShort')}
        </p>
      ) : null}
      {error ? <ServiceApiError code={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('ws_api_rejectConfirm')}
        </button>
        <button
          data-panel-cancel={`reject-${r.code}`}
          type="button"
          onClick={onCancel}
          className={portalQuiet}
        >
          {t('ws_api_cancel')}
        </button>
      </div>
    </form>
  );
}
