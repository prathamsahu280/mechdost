'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  APPLICATION_REJECT_REASONS,
  PRICE_REJECT_REASONS,
  type ApplicationRejectReason,
  type PriceRejectReason,
} from '@mechdost/shared/partner-codes';
import {
  AgreementPublished,
  ApplicationApproved,
  ApplicationDetail,
  ApplicationPage,
  CurrentAgreement,
  InviteCreated,
  InvitePage,
  PriceRequestPage,
  StatusAnswer,
  type ApplicationDetailDto,
  type ApplicationRowDto,
  type InviteRowDto,
  type PriceRequestRowDto,
} from '@mechdost/shared/partner-api';
import { AdminPincodeList } from '@mechdost/shared/geo-api';
import { InviteSchema } from '@mechdost/shared/partners';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { parseCoverage } from '@/lib/partner-onboarding-view';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

/**
 * Seller onboarding in the admin console on the API (Stream D, 2026-11-14; spec 07/08): applications (review,
 * approve with the delivery area, reject with a reason code), invites, the price queue and the seller agreement.
 * Same layout and copy as the demo screens; loaded with `next/dynamic` only when AUTH_MODE is firebase.
 */
type OwnErrorKey =
  'api_on_errNotSeller' | 'api_on_errInviteOpen' | 'api_on_errInviteCity' | 'api_on_errNotLive';

/** An API error code → a message: the screen's own codes first, then the shared ones. */
function useErrorText() {
  const t = useTranslations('portal');
  return useCallback(
    (code: string, own: Partial<Record<string, OwnErrorKey>> = {}) => t(own[code] ?? commonErrorKey(code)),
    [t],
  );
}

function Alert({ text, id }: { text: string | null; id?: string }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="text-sm font-bold text-error">
      {text}
    </p>
  );
}

/** A keyset-paged list from the API: loading, error with retry, and "Load more" (never a blank list that looks real). */
function usePaged<T>(path: string, schema: ResponseSchema<{ items: T[]; nextCursor: string | null }>) {
  const locale = useLocale();
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const sep = path.includes('?') ? '&' : '?';
      const res = await adminApi(
        locale,
        cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path,
        schema,
      );
      setLoading(false);
      if (!res.ok) {
        setError(res.code);
        return;
      }
      setError(null);
      setItems((prev) => (cursor ? [...prev, ...res.data.items] : res.data.items));
      setNext(res.data.nextCursor);
    },
    [locale, path, schema],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  return { items, next, loading, error, reload: () => void load(null), more: () => void load(next) };
}

function ListState({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('portal');
  const errorText = useErrorText();
  if (error)
    return (
      <div className="mt-3 space-y-2">
        <Alert text={errorText(error)} />
        <button type="button" onClick={onRetry} className={portalQuiet}>
          {t('api_on_retry')}
        </button>
      </div>
    );
  if (loading && empty)
    return (
      <p role="status" className="mt-3 text-sm text-muted">
        {t('api_on_loading')}
      </p>
    );
  if (empty) return <p className="mt-3 text-sm text-muted">{emptyText}</p>;
  return <>{children}</>;
}

function MoreButton({
  next,
  loading,
  onMore,
}: {
  next: string | null;
  loading: boolean;
  onMore: () => void;
}) {
  const t = useTranslations('portal');
  if (!next) return null;
  return (
    <button type="button" disabled={loading} onClick={onMore} className={`${portalQuiet} mt-3`}>
      {loading ? t('api_on_loading') : t('api_on_loadMore')}
    </button>
  );
}

/* ───────────────────────────── Applications ───────────────────────────── */

export function ApplicationsApi() {
  const t = useTranslations('portal');
  const list = usePaged<ApplicationRowDto>('/admin/partner-applications', ApplicationPage);
  return (
    <section aria-labelledby="applications-title">
      <h2 id="applications-title" className="font-heading text-xl font-extrabold text-ink">
        {t('nav_applications')}
      </h2>
      <ListState
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        emptyText={t('emptyQueue')}
        onRetry={list.reload}
      >
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {list.items.map((a) => (
            <ApplicationCard key={a.code} row={a} onChanged={list.reload} />
          ))}
        </ul>
      </ListState>
      <MoreButton next={list.next} loading={list.loading} onMore={list.more} />
    </section>
  );
}

function ApplicationCard({ row: a, onChanged }: { row: ApplicationRowDto; onChanged: () => void }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [detail, setDetail] = useState<ApplicationDetailDto | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const field = `app-${a.code}`;
  const decided = detail?.status === 'approved' || detail?.status === 'rejected';

  async function loadDetail() {
    const res = await adminApi(locale, `/admin/partner-applications/${a.code}`, ApplicationDetail);
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    setError(null);
    setDetail(res.data);
  }

  function toggle() {
    setOpen(!open);
    if (!open) void loadDetail();
  }

  /** After approve or reject: the card shows the decision, the list shows the new status. */
  function decidedNow() {
    setMode('idle');
    void loadDetail();
    onChanged();
  }

  return (
    <li className={portalCard}>
      <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
        {a.kind === 'seller' ? t('kind_seller') : a.kind === 'garage' ? t('kind_garage') : t('kind_mechanic')}{' '}
        · {t(`api_on_status_${a.status}`)}
        {a.source === 'invite' ? ` · ${t('appInvited')}` : ''}
      </p>
      <p data-user-content className="font-heading text-lg font-extrabold text-ink">
        {a.shopName ?? a.name}
      </p>
      <p className="text-sm text-muted">
        {a.code} · <span data-user-content>{a.name}</span> · PIN {a.pincode} ·{' '}
        {formatDate(a.createdAt, locale)}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${field}-detail`}
        onClick={toggle}
        className={`${portalQuiet} mt-3`}
      >
        {open ? t('api_on_hide') : t('api_on_review', { code: a.code })}
      </button>
      {open ? (
        <div id={`${field}-detail`} className="mt-3">
          <Alert text={error} />
          {!detail && !error ? (
            <p role="status" className="text-sm text-muted">
              {t('api_on_loading')}
            </p>
          ) : null}
          {detail ? <ApplicationDetails app={detail} /> : null}
          {detail && !decided ? (
            mode === 'approve' ? (
              <CoverageForm
                app={detail}
                onCancel={() => {
                  setMode('idle');
                }}
                onDone={decidedNow}
              />
            ) : mode === 'reject' ? (
              <RejectForm
                app={detail}
                onCancel={() => {
                  setMode('idle');
                }}
                onDone={decidedNow}
              />
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {a.kind === 'seller' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('approve');
                    }}
                    className={portalPrimary}
                  >
                    {t('appApproveWithArea')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMode('reject');
                  }}
                  className={portalQuiet}
                >
                  {t('rejectApplication')}
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const LOCATION_SOURCE = {
  gps: 'appLocationSource_gps',
  search: 'appLocationSource_search',
  pin: 'appLocationSource_pin',
} as const;

function ApplicationDetails({ app: a }: { app: ApplicationDetailDto }) {
  const t = useTranslations('portal');
  const source = a.location?.source;
  const reason = APPLICATION_REJECT_REASONS.find((r) => r === a.reasonCode);
  return (
    <>
      <dl className="space-y-1 text-sm text-ink">
        {a.businessName ? (
          <div data-user-content className="font-bold">
            {a.businessName}
          </div>
        ) : null}
        {a.gstNumber ? (
          <div>
            <dt className="inline font-bold">
              {a.gstStatus === 'enrolled' ? t('appEnrolment') : t('appGstin')}:
            </dt>{' '}
            <dd className="inline">{a.gstNumber}</dd>
          </div>
        ) : null}
        {a.addressLine ? (
          <div>
            <dt className="inline font-bold">{t('appAddress')}:</dt>{' '}
            <dd data-user-content className="inline">
              {a.addressLine}
              {a.landmark ? `, ${a.landmark}` : ''}
            </dd>
          </div>
        ) : null}
        {a.location ? (
          <div>
            <dt className="inline font-bold">{t('appLocation')}:</dt>{' '}
            <dd className="inline">
              <a
                href={`https://www.openstreetmap.org/?mlat=${String(a.location.lat)}&mlon=${String(a.location.lng)}#map=17/${String(a.location.lat)}/${String(a.location.lng)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-accent-soft-text underline"
              >
                {source === 'gps' || source === 'search' || source === 'pin'
                  ? t(LOCATION_SOURCE[source])
                  : t('appLocation')}
              </a>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="inline font-bold">{t('appProducts')}:</dt>{' '}
          <dd className="inline">{t('appProductCount', { count: a.products })}</dd>
        </div>
      </dl>
      {a.duplicateGstin ? (
        <p role="note" className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('api_on_duplicateGstin')}
        </p>
      ) : null}
      {a.status === 'rejected' && reason ? (
        <p className="mt-2 text-sm font-bold text-ink">
          {t('appRejectedReason', { reason: t(`appReject_${reason}`) })}
        </p>
      ) : null}
    </>
  );
}

const DEFAULT_CHARGE = OPERATIONAL_SETTINGS['partners.default_shipping_paise'].default;
const DEFAULT_DAYS = OPERATIONAL_SETTINGS['partners.default_lead_days'].default;

function CoverageForm({
  app,
  onCancel,
  onDone,
}: {
  app: ApplicationDetailDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pins, setPins] = useState(app.pincode);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const id = (k: string) => `coverage-${app.code}-${k}`;

  /** Pick list (spec 15 "PIN codes"): every active PIN code of the application's city, from the API. */
  async function fillServiceArea() {
    setPickNote(null);
    const res = await adminApi(locale, `/admin/pincodes?pincode=${app.pincode}`, AdminPincodeList);
    if (!res.ok) {
      setPickNote(errorText(res.code));
      return;
    }
    const active = res.data.pincodes.filter((p) => p.active).map((p) => p.pincode);
    setPins(active.join(', '));
    setPickNote(t('geo_api_pickDone', { count: active.length }));
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v : '';
    };
    const coverage = parseCoverage(text('pins'), text('charge'), text('days'));
    setInvalid(!coverage);
    if (!coverage) {
      document.getElementById(id('pins'))?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/partner-applications/${app.code}/approve`,
      ApplicationApproved,
      {
        method: 'POST',
        body: { version: app.version, coverage },
      },
    );
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'COVERAGE') setInvalid(true);
      else setError(errorText(res.code, { NOT_A_SELLER: 'api_on_errNotSeller' }));
      return;
    }
    track('click', { id: 'admin_application_approved', path: window.location.pathname });
    onDone();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-ink">{t('appArea')}</p>
        <label htmlFor={id('pins')} className="mt-1 block text-xs font-bold text-ink">
          {t('api_on_pinsLabel')}
        </label>
        <textarea
          id={id('pins')}
          name="pins"
          rows={2}
          value={pins}
          onChange={(e) => {
            setPins(e.target.value);
          }}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${id('error')} ${id('hint')}` : id('hint')}
          className={`${portalField} py-2`}
        />
        <p id={id('hint')} className="mt-1 text-xs text-muted">
          {t('api_on_pinsHint')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={portalQuiet} onClick={() => void fillServiceArea()}>
            {t('geo_api_pick')}
          </button>
          <p role="status" className="text-xs text-muted">
            {pickNote ?? ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor={id('charge')} className="text-xs font-bold text-ink">
            {t('appCharge')}
          </label>
          <input
            id={id('charge')}
            name="charge"
            inputMode="decimal"
            defaultValue={String(DEFAULT_CHARGE / 100)}
            maxLength={8}
            className={`${portalField} mt-1 block w-28`}
          />
        </div>
        <div>
          <label htmlFor={id('days')} className="text-xs font-bold text-ink">
            {t('appDays')}
          </label>
          <input
            id={id('days')}
            name="days"
            inputMode="numeric"
            defaultValue={String(DEFAULT_DAYS)}
            maxLength={2}
            className={`${portalField} mt-1 block w-20`}
          />
        </div>
      </div>
      {invalid ? (
        <p id={id('error')} role="alert" className="text-xs font-bold text-error">
          {t('api_on_errCoverage')}
        </p>
      ) : null}
      <Alert text={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('appApproveOnboard')}
        </button>
        <button type="button" onClick={onCancel} className={portalQuiet}>
          {t('appCancel')}
        </button>
      </div>
    </form>
  );
}

function RejectForm({
  app,
  onCancel,
  onDone,
}: {
  app: ApplicationDetailDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [reason, setReason] = useState<ApplicationRejectReason | ''>('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectId = `reject-${app.code}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason) {
      setMissing(true);
      document.getElementById(selectId)?.focus();
      return;
    }
    const noteRaw = new FormData(e.currentTarget).get('note');
    const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';
    setBusy(true);
    const res = await adminApi(locale, `/admin/partner-applications/${app.code}/reject`, StatusAnswer, {
      method: 'POST',
      body: { version: app.version, reasonCode: reason, ...(note ? { note } : {}) },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    track('click', { id: 'admin_application_rejected', path: window.location.pathname });
    onDone();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={selectId} className="text-xs font-bold text-ink">
            {t('appRejectReason')}
          </label>
          <select
            id={selectId}
            value={reason}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `${selectId}-error` : undefined}
            onChange={(e) => {
              setReason(APPLICATION_REJECT_REASONS.find((r) => r === e.target.value) ?? '');
              setMissing(false);
            }}
            className={`${portalField} mt-1 block`}
          >
            <option value="">{t('appRejectChoose')}</option>
            {APPLICATION_REJECT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`appReject_${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor={`${selectId}-note`} className="text-xs font-bold text-ink">
            {t('api_on_note')}
          </label>
          <input
            id={`${selectId}-note`}
            name="note"
            maxLength={300}
            className={`${portalField} mt-1 block`}
          />
        </div>
      </div>
      {missing ? (
        <p id={`${selectId}-error`} className="text-xs font-bold text-error">
          {t('appRejectNeedsReason')}
        </p>
      ) : null}
      <Alert text={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('appRejectConfirm')}
        </button>
        <button type="button" onClick={onCancel} className={portalQuiet}>
          {t('appCancel')}
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────────── Invites ───────────────────────────── */

type InviteField = 'name' | 'email' | 'phone';
const INVITE_FIELDS: InviteField[] = ['name', 'email', 'phone'];

export function InvitesApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const list = usePaged<InviteRowDto>('/admin/partner-invites', InvitePage);
  const [errors, setErrors] = useState<Partial<Record<InviteField, true>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const value = (k: InviteField) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const parsed = InviteSchema.safeParse({
      name: value('name'),
      email: value('email'),
      phone: value('phone'),
    });
    if (!parsed.success) {
      const bad = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')));
      const next: Partial<Record<InviteField, true>> = {};
      for (const f of INVITE_FIELDS) if (bad.has(f)) next[f] = true;
      setErrors(next);
      const first = INVITE_FIELDS.find((f) => next[f]);
      if (first) document.getElementById(`invite-${first}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    const res = await adminApi(locale, '/admin/partner-invites', InviteCreated, {
      method: 'POST',
      body: parsed.data,
    });
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'INVITE_INVALID') setErrors({ name: true, email: true, phone: true });
      else
        setFormError(
          errorText(res.code, {
            INVITE_OPEN: 'api_on_errInviteOpen',
            CITY_NOT_ALLOWED: 'api_on_errInviteCity',
          }),
        );
      return;
    }
    setFormError(null);
    setCopied(false);
    setCreated(res.data.link);
    track('click', { id: 'admin_invite_created', path: window.location.pathname });
    form.reset();
    list.reload();
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(id: string) {
    const res = await adminApi(locale, `/admin/partner-invites/${id}/revoke`, StatusAnswer, {
      method: 'POST',
    });
    if (!res.ok) {
      setRowError(errorText(res.code));
      return;
    }
    setRowError(null);
    track('click', { id: 'admin_invite_revoked', path: window.location.pathname });
    list.reload();
  }

  const message: Record<InviteField, string> = {
    name: t('inviteErrName'),
    email: t('inviteErrEmail'),
    phone: t('inviteErrPhone'),
  };
  const label: Record<InviteField, string> = {
    name: t('inviteName'),
    email: t('inviteEmail'),
    phone: t('invitePhone'),
  };

  return (
    <section aria-labelledby="invites-title" className={portalCard}>
      <h3 id="invites-title" className="font-heading text-lg font-extrabold text-ink">
        {t('invitesTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('invitesLead')}</p>

      <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 grid gap-3 min-[600px]:grid-cols-3">
        {INVITE_FIELDS.map((f) => (
          <div key={f}>
            <label htmlFor={`invite-${f}`} className="text-sm font-bold text-ink">
              {label[f]}
            </label>
            <input
              id={`invite-${f}`}
              name={f}
              type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
              inputMode={f === 'phone' ? 'numeric' : undefined}
              autoComplete="off"
              maxLength={f === 'email' ? 120 : f === 'phone' ? 14 : 80}
              aria-invalid={errors[f] ? true : undefined}
              aria-describedby={errors[f] ? `invite-${f}-error` : undefined}
              className={`${portalField} mt-1 w-full`}
            />
            {errors[f] ? (
              <p id={`invite-${f}-error`} className="mt-1 text-xs font-bold text-error">
                {message[f]}
              </p>
            ) : null}
          </div>
        ))}
        <div className="space-y-2 min-[600px]:col-span-3">
          <Alert text={formError} />
          <button type="submit" disabled={busy} className={portalPrimary}>
            {t('inviteCreate')}
          </button>
        </div>
      </form>

      {created ? (
        <div role="status" className="mt-4 rounded-lg bg-success-bg p-3 text-sm text-ink">
          <p className="font-bold">{t('api_on_inviteSent')}</p>
          <p className="mt-1 font-mono text-xs break-all">{created}</p>
          <button type="button" onClick={() => void copy(created)} className={`${portalQuiet} mt-2`}>
            {copied ? t('inviteCopied') : t('inviteCopy')}
          </button>
        </div>
      ) : null}

      <Alert text={rowError} />
      <ListState
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        emptyText={t('invitesEmpty')}
        onRetry={list.reload}
      >
        <ul className="mt-4 divide-y divide-line-card">
          {list.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="text-sm">
                <p data-user-content className="font-bold text-ink">
                  {i.name}
                </p>
                <p className="text-muted">
                  {t(`inviteStatus_${i.status}`)} ·{' '}
                  {t('inviteUntil', { date: formatDate(i.expiresAt, locale) })}
                </p>
              </div>
              {i.status === 'sent' ? (
                <button type="button" onClick={() => void revoke(i.id)} className={portalQuiet}>
                  {t('inviteRevoke')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </ListState>
      <MoreButton next={list.next} loading={list.loading} onMore={list.more} />
    </section>
  );
}

/* ───────────────────────────── Price requests ───────────────────────────── */

export function PriceRequestsApi() {
  const t = useTranslations('portal');
  const list = usePaged<PriceRequestRowDto>('/admin/price-requests?status=pending', PriceRequestPage);
  return (
    <section aria-labelledby="price-requests-title" className={portalCard}>
      <h3 id="price-requests-title" className="font-heading text-lg font-extrabold text-ink">
        {t('priceRequestsTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('priceRequestsLead')}</p>
      <ListState
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        emptyText={t('priceRequestsEmpty')}
        onRetry={list.reload}
      >
        <ul className="mt-4 divide-y divide-line-card">
          {list.items.map((r) => (
            <PriceRequestRow key={r.id} request={r} onDone={list.reload} />
          ))}
        </ul>
      </ListState>
      <MoreButton next={list.next} loading={list.loading} onMore={list.more} />
    </section>
  );
}

function PriceRequestRow({ request: r, onDone }: { request: PriceRequestRowDto; onDone: () => void }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [reason, setReason] = useState<PriceRejectReason | ''>('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonId = `price-reason-${r.id}`;

  async function decide(decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !reason) {
      setMissing(true);
      document.getElementById(reasonId)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/price-requests/${r.id}/decide`, StatusAnswer, {
      method: 'POST',
      body: {
        version: r.version,
        decision,
        ...(decision === 'rejected' && reason ? { reasonCode: reason } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.code, { PRODUCT_NOT_LIVE: 'api_on_errNotLive' }));
      return;
    }
    track('click', { id: `admin_price_${decision}`, path: window.location.pathname });
    onDone();
  }

  return (
    <li className="flex flex-wrap items-end justify-between gap-3 py-3">
      <div className="text-sm">
        <p data-user-content className="font-bold text-ink">
          {r.product}
        </p>
        <p className="text-muted">
          <span data-user-content>
            {t('priceRequestLine', {
              shop: r.shopName,
              price: formatPrice(r.requestedPaise),
              mrp: formatPrice(r.mrpPaise),
            })}
          </span>
        </p>
        <Alert text={error} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={reasonId} className="text-xs font-bold text-ink">
            {t('priceRejectReason')}
          </label>
          <select
            id={reasonId}
            value={reason}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `${reasonId}-error` : undefined}
            onChange={(e) => {
              setReason(PRICE_REJECT_REASONS.find((c) => c === e.target.value) ?? '');
              setMissing(false);
            }}
            className={`${portalField} mt-1 block`}
          >
            <option value="">{t('priceRejectChoose')}</option>
            {PRICE_REJECT_REASONS.map((code) => (
              <option key={code} value={code}>
                {t(`priceReason_${code}`)}
              </option>
            ))}
          </select>
          {missing ? (
            <p id={`${reasonId}-error`} className="mt-1 text-xs font-bold text-error">
              {t('priceRejectNeedsReason')}
            </p>
          ) : null}
        </div>
        <button type="button" disabled={busy} onClick={() => void decide('rejected')} className={portalQuiet}>
          {t('priceReject')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('approved')}
          className={portalPrimary}
        >
          {t('priceApprove')}
        </button>
      </div>
    </li>
  );
}

/* ───────────────────────────── Agreement ───────────────────────────── */

export function AgreementApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const errorText = useErrorText();
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminApi(locale, '/admin/agreements/current', CurrentAgreement);
    setLoading(false);
    if (!res.ok) {
      setLoadError(res.code);
      return;
    }
    setLoadError(null);
    setVersion(res.data.agreement?.version ?? null);
  }, [locale]);
  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const textEn = text('textEn');
    const textHi = text('textHi');
    if (textEn.length < 20 || textHi.length < 20) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    const res = await adminApi(locale, '/admin/agreements', AgreementPublished, {
      method: 'POST',
      body: { textEn, textHi },
    });
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'AGREEMENT_TEXT' || res.code === 'VALIDATION') setInvalid(true);
      else setError(errorText(res.code));
      return;
    }
    setError(null);
    setPublished(res.data.version);
    setVersion(res.data.version);
    form.reset();
    track('click', { id: 'admin_agreement_published', path: window.location.pathname });
  }

  return (
    <section aria-labelledby="agreement-admin-title" className={portalCard}>
      <h3 id="agreement-admin-title" className="font-heading text-lg font-extrabold text-ink">
        {t('agreementTitle')}
      </h3>
      {loadError ? (
        <div className="mt-1 space-y-2">
          <Alert text={errorText(loadError)} />
          <button type="button" onClick={() => void load()} className={portalQuiet}>
            {t('api_on_retry')}
          </button>
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted" role={loading ? 'status' : undefined}>
          {loading ? t('api_on_loading') : version ? t('agreementCurrent', { version }) : t('agreementNone')}
        </p>
      )}
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-3">
        {(['textEn', 'textHi'] as const).map((k) => (
          <div key={k}>
            <label htmlFor={`agreement-${k}`} className="text-sm font-bold text-ink">
              {k === 'textEn' ? t('agreementTextEn') : t('agreementTextHi')}
            </label>
            <textarea
              id={`agreement-${k}`}
              name={k}
              rows={5}
              maxLength={50_000}
              lang={k === 'textEn' ? 'en' : 'hi'}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? 'agreement-error' : undefined}
              className={`${portalField} mt-1 block w-full py-2`}
            />
          </div>
        ))}
        {invalid ? (
          <p id="agreement-error" className="text-xs font-bold text-error">
            {t('agreementErrText')}
          </p>
        ) : null}
        <Alert text={error} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={portalPrimary}>
            {t('agreementPublish')}
          </button>
          <p role="status" className="text-sm font-bold text-success">
            {published ? t('api_on_published', { version: published }) : null}
          </p>
        </div>
      </form>
    </section>
  );
}
