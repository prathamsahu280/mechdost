'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  BusinessApplicationDetail,
  BusinessApplicationPage,
  BusinessOk,
  type BusinessApplicationDetailDto,
  type BusinessApplicationRowDto,
} from '@mechdost/shared/business-api';
import {
  TRADE_REVOKE_REASONS,
  type BusinessApplicationKind,
  type TradeRevokeReason,
} from '@mechdost/shared/business-codes';
import { APPLICATION_REJECT_REASONS, type ApplicationRejectReason } from '@mechdost/shared/partner-codes';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { Alert, ListState, MoreButton, useErrorText, usePaged } from './admin-onboarding-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

/**
 * Trade account applications and fleet enquiries in the admin console (audience entry design 2026-11-22, item 3),
 * on `/v1/admin/business-applications`. Approving a trade application verifies the applicant's account; a verified
 * account can be revoked with a reason code and restored. Fleet enquiries are reviewed and closed only.
 * Loaded with `next/dynamic` only when AUTH_MODE is firebase.
 */
type Kind = '' | BusinessApplicationKind;
const KINDS: readonly Kind[] = ['', 'trade', 'fleet'];
const kindLabel = (k: Kind) => (k === '' ? 'admin_kind_all' : (`admin_kind_${k}` as const));

export function BusinessApplicationsApi() {
  const t = useTranslations('business');
  const [kind, setKind] = useState<Kind>('');
  const list = usePaged<BusinessApplicationRowDto>(
    `/admin/business-applications${kind ? `?kind=${kind}` : ''}`,
    BusinessApplicationPage,
  );
  return (
    <section aria-labelledby="business-applications-title" className="mt-10">
      <h2 id="business-applications-title" className="font-heading text-xl font-extrabold text-ink">
        {t('admin_title')}
      </h2>
      <div role="group" aria-label={t('admin_filterKind')} className="mt-3 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k || 'all'}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
            }}
            className={`${portalQuiet} aria-pressed:border-accent-button aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-text`}
          >
            {t(kindLabel(k))}
          </button>
        ))}
      </div>
      <ListState
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        emptyText={t('admin_empty')}
        onRetry={list.reload}
      >
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {list.items.map((a) => (
            <BusinessCard key={a.code} row={a} onChanged={list.reload} />
          ))}
        </ul>
      </ListState>
      <MoreButton next={list.next} loading={list.loading} onMore={list.more} />
    </section>
  );
}

type Mode = 'idle' | 'reject' | 'revoke';

function BusinessCard({ row: a, onChanged }: { row: BusinessApplicationRowDto; onChanged: () => void }) {
  const t = useTranslations('business');
  const locale = useLocale();
  const errorText = useErrorText();
  const [detail, setDetail] = useState<BusinessApplicationDetailDto | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const field = `biz-${a.code}`;

  const fail = (code: string) => {
    setError(code === 'NOT_A_TRADE_APPLICATION' ? t('admin_err_notTrade') : errorText(code));
  };

  async function loadDetail() {
    const res = await adminApi(locale, `/admin/business-applications/${a.code}`, BusinessApplicationDetail);
    if (!res.ok) {
      fail(res.code);
      return;
    }
    setError(null);
    setDetail(res.data);
  }

  function toggle() {
    setOpen(!open);
    if (!open) void loadDetail();
  }

  async function post(path: string, body: Record<string, unknown>, id: string) {
    setBusy(true);
    const res = await adminApi(locale, `/admin/business-applications/${a.code}/${path}`, BusinessOk, {
      method: 'POST',
      body,
    });
    setBusy(false);
    if (!res.ok) {
      fail(res.code);
      return false;
    }
    track('click', { id, path: window.location.pathname });
    setMode('idle');
    await loadDetail();
    onChanged();
    return true;
  }

  const decide = (decision: 'in_review' | 'approved' | 'closed') =>
    detail ? post('decide', { version: detail.version, decision }, `admin_business_${decision}`) : undefined;

  return (
    <li className={portalCard}>
      <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
        {t(`admin_label_${a.kind}`)} · {t(`admin_status_${a.status}`)}
      </p>
      <p data-user-content className="font-heading text-lg font-extrabold text-ink">
        {a.businessName}
      </p>
      <p className="text-sm text-muted">
        {a.code} · <span data-user-content>{a.contactName}</span> · PIN {a.pincode} ·{' '}
        {formatDate(a.createdAt, locale)}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${field}-detail`}
        data-disclosure-trigger={`review-${a.code}`}
        data-panel-cancel={open ? `review-${a.code}` : undefined}
        onClick={toggle}
        className={`${portalQuiet} mt-3`}
      >
        {open ? t('admin_hide') : t('admin_review', { code: a.code })}
      </button>
      {open ? (
        <div id={`${field}-detail`} data-panel-for={`review-${a.code}`} className="mt-3">
          <Alert text={error} />
          {!detail && !error ? (
            <p role="status" className="text-sm text-muted">
              {t('admin_loading')}
            </p>
          ) : null}
          {detail ? <Details app={detail} /> : null}
          {detail && mode === 'reject' ? (
            <ReasonForm
              kind="reject"
              busy={busy}
              onCancel={() => {
                setMode('idle');
              }}
              onSubmit={(reasonCode, note) =>
                post(
                  'decide',
                  { version: detail.version, decision: 'rejected', reasonCode, ...(note ? { note } : {}) },
                  'admin_business_rejected',
                )
              }
            />
          ) : null}
          {detail && mode === 'revoke' && detail.tradeAccount ? (
            <ReasonForm
              kind="revoke"
              busy={busy}
              onCancel={() => {
                setMode('idle');
              }}
              onSubmit={(reasonCode) =>
                post(
                  'trade-standing',
                  { version: detail.tradeAccount?.version ?? 0, to: 'revoked', reasonCode },
                  'admin_trade_revoked',
                )
              }
            />
          ) : null}
          {detail && mode === 'idle' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {detail.status === 'new' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('in_review')}
                  className={portalQuiet}
                >
                  {t('admin_startReview')}
                </button>
              ) : null}
              {detail.kind === 'trade' && (detail.status === 'new' || detail.status === 'in_review') ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decide('approved')}
                    className={portalPrimary}
                  >
                    {t('admin_approve')}
                  </button>
                  <button
                    type="button"
                    data-disclosure-trigger={`reject-${a.code}`}
                    onClick={() => {
                      setMode('reject');
                    }}
                    className={portalQuiet}
                  >
                    {t('admin_reject')}
                  </button>
                </>
              ) : null}
              {detail.kind === 'fleet' && (detail.status === 'new' || detail.status === 'in_review') ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('closed')}
                  className={portalPrimary}
                >
                  {t('admin_close')}
                </button>
              ) : null}
              {detail.tradeAccount?.status === 'verified' ? (
                <button
                  type="button"
                  data-disclosure-trigger={`revoke-${a.code}`}
                  onClick={() => {
                    setMode('revoke');
                  }}
                  className={portalQuiet}
                >
                  {t('admin_revoke')}
                </button>
              ) : null}
              {detail.tradeAccount?.status === 'revoked' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void post(
                      'trade-standing',
                      { version: detail.tradeAccount?.version ?? 0, to: 'verified' },
                      'admin_trade_restored',
                    )
                  }
                  className={portalPrimary}
                >
                  {t('admin_restore')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Details({ app }: { app: BusinessApplicationDetailDto }) {
  const t = useTranslations('business');
  const row = (label: string, value: string) => (
    <div>
      <dt className="text-xs font-bold text-muted">{label}</dt>
      <dd data-user-content className="text-sm text-ink">
        {value}
      </dd>
    </div>
  );
  const none = t('admin_none');
  return (
    <dl className="grid gap-2 min-[600px]:grid-cols-2">
      {app.kind === 'trade' ? (
        <>
          {row(t('admin_businessType'), app.businessType ? t(`type_${app.businessType as 'garage'}`) : none)}
          {row(t('admin_gstin'), app.gstin ?? none)}
          {row(t('admin_spend'), app.spendBand ? t(`spend_${app.spendBand as 'over_5l'}`) : none)}
          {row(t('admin_categories'), app.categories.join(', '))}
        </>
      ) : (
        <>
          {row(
            t('admin_fleet'),
            app.fleet
              ? `${t('w2')}: ${String(app.fleet.w2)}, ${t('w3')}: ${String(app.fleet.w3)}, ${t('w4')}: ${String(app.fleet.w4)}`
              : none,
          )}
          {row(t('admin_needs'), app.needs.map((n) => t(`need_${n as 'bulk_parts'}`)).join(', '))}
          {app.note ? row(t('admin_note'), app.note) : null}
        </>
      )}
      {row(
        t('admin_contact'),
        [app.contactName, app.contactPhone, app.contactEmail].filter(Boolean).join(' · '),
      )}
      {row(t('admin_signedIn'), app.signedIn ? '✓' : t('admin_signedOut'))}
      {app.tradeAccount
        ? row(
            t('admin_tradeAccount', { status: t(`admin_account_${app.tradeAccount.status}`) }),
            app.tradeAccount.reasonCode ? t(`admin_revoke_${app.tradeAccount.reasonCode as 'other'}`) : '',
          )
        : null}
    </dl>
  );
}

/** A reason code (required) and an optional note: rejecting an application, or revoking a trade account. */
function ReasonForm({
  kind,
  busy,
  onCancel,
  onSubmit,
}: {
  kind: 'reject' | 'revoke';
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reasonCode: string, note: string) => Promise<boolean | undefined>;
}) {
  const t = useTranslations('business');
  const portal = useTranslations('portal');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const id = `biz-reason-${kind}`;
  const codes: readonly (ApplicationRejectReason | TradeRevokeReason)[] =
    kind === 'reject' ? APPLICATION_REJECT_REASONS : TRADE_REVOKE_REASONS;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason) {
      setMissing(true);
      document.getElementById(id)?.focus();
      return;
    }
    const note = new FormData(e.currentTarget).get('note');
    void onSubmit(reason, typeof note === 'string' ? note.trim() : '');
  }

  return (
    <form noValidate onSubmit={submit} className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={id} className="text-xs font-bold text-ink">
            {kind === 'reject' ? t('admin_rejectReason') : t('admin_revokeReason')}
          </label>
          <select
            id={id}
            value={reason}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `${id}-error` : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setMissing(false);
            }}
            className={`${portalField} mt-1 block`}
          >
            <option value="">{t('admin_chooseReason')}</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {kind === 'reject'
                  ? portal(`appReject_${c as ApplicationRejectReason}`)
                  : t(`admin_revoke_${c as TradeRevokeReason}`)}
              </option>
            ))}
          </select>
        </div>
        {kind === 'reject' ? (
          <div className="min-w-56 flex-1">
            <label htmlFor={`${id}-note`} className="text-xs font-bold text-ink">
              {t('admin_noteLabel')}
            </label>
            <input id={`${id}-note`} name="note" maxLength={300} className={`${portalField} mt-1 block`} />
          </div>
        ) : null}
      </div>
      {missing ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-bold text-error">
          {t('admin_reasonMissing')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {kind === 'reject' ? t('admin_confirmReject') : t('admin_confirmRevoke')}
        </button>
        <button type="button" data-panel-cancel={kind} onClick={onCancel} className={portalQuiet}>
          {t('admin_cancel')}
        </button>
      </div>
    </form>
  );
}
