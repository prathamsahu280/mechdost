'use client';

import { APPLICATION_REJECT_REASONS, type ApplicationRejectReason } from '@mechdost/shared/partners';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  APPLICATION_STAGES,
  applicationsWithSameGstin,
  approveApplication,
  defaultCoverage,
  rejectApplication,
  updateApplication,
  useApplications,
  type DemoApplication,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

const ONBOARDED = APPLICATION_STAGES.indexOf('onboarded');
const VERIFICATION = APPLICATION_STAGES.indexOf('verification');

/**
 * Partner applications (spec 07, design 2026-11-13): sellers show GST, address, location and products, with a
 * warning for a GSTIN already applied with; approval sets the delivery area (user: "admin, at approval",
 * pre-filled from the city's PIN codes); rejection needs a reason code. Demo store until the console calls
 * `/v1/admin/partner-applications` (data switch).
 */
export function Applications() {
  const t = useTranslations('portal');
  const apps = useApplications();
  return (
    <section aria-labelledby="applications-title">
      <h2 id="applications-title" className="font-heading text-xl font-extrabold text-ink">
        {t('nav_applications')}
      </h2>
      {apps.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('emptyQueue')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {apps.map((a) => (
            <ApplicationCard key={a.code} app={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationCard({ app: a }: { app: DemoApplication }) {
  const t = useTranslations('portal');
  const ap = useTranslations('apply');
  const locale = useLocale();
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const stage = APPLICATION_STAGES[a.stage] ?? 'received';
  const done = a.rejected || a.stage >= ONBOARDED;
  const isSeller = a.kind === 'seller';
  const duplicates = isSeller && !done ? applicationsWithSameGstin(a) : [];
  const readyToApprove = isSeller && a.stage >= VERIFICATION;

  return (
    <li className={portalCard}>
      <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
        {t(`kind_${a.kind}`)} · {a.rejected ? ap('stage_rejected') : ap(`stage_${stage}`)}
        {a.source === 'invite' ? ` · ${t('appInvited')}` : ''}
      </p>
      <p data-user-content className="font-heading text-lg font-extrabold text-ink">
        {a.business || a.name}
      </p>
      <p className="text-sm text-muted">
        {a.code} · <span data-user-content>{a.name}</span> · PIN {a.pincode} ·{' '}
        {formatDate(a.createdAt, locale)}
      </p>
      {isSeller ? (
        <dl className="mt-2 space-y-1 text-sm text-ink">
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
                  {t(`appLocationSource_${a.location.source}`)}
                </a>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-bold">{t('appProducts')}:</dt>{' '}
            <dd className="inline">{t('appProductCount', { count: a.productSlugs?.length ?? 0 })}</dd>
          </div>
        </dl>
      ) : (
        <p data-user-content className="mt-2 line-clamp-3 text-sm text-ink">
          {a.details}
        </p>
      )}
      {duplicates.length > 0 ? (
        <p role="note" className="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('appSameGstin', { codes: duplicates.map((d) => d.code).join(', ') })}
        </p>
      ) : null}
      {a.coverage ? (
        <p className="mt-2 text-sm font-bold text-ink">
          {t('appCoverage', {
            count: a.coverage.pincodes.length,
            price: formatPrice(a.coverage.shippingPaise),
            days: a.coverage.leadDays,
          })}
        </p>
      ) : null}
      {a.rejected && a.rejectReason ? (
        <p className="mt-2 text-sm font-bold text-ink">
          {t('appRejectedReason', { reason: t(`appReject_${a.rejectReason}`) })}
        </p>
      ) : null}

      {done ? null : mode === 'approve' ? (
        <CoverageForm
          code={a.code}
          onCancel={() => {
            setMode('idle');
          }}
        />
      ) : mode === 'reject' ? (
        <RejectForm
          code={a.code}
          onCancel={() => {
            setMode('idle');
          }}
        />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {readyToApprove ? (
            <button
              type="button"
              onClick={() => {
                setMode('approve');
              }}
              className={portalPrimary}
            >
              {t('appApproveWithArea')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                updateApplication(a.code, { stage: a.stage + 1 });
              }}
              className={portalPrimary}
            >
              {t('nextStep')}
            </button>
          )}
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
      )}
    </li>
  );
}

function CoverageForm({ code, onCancel }: { code: string; onCancel: () => void }) {
  const t = useTranslations('portal');
  const defaults = defaultCoverage();
  const [invalid, setInvalid] = useState(false);
  const id = (k: string) => `coverage-${code}-${k}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const pincodes = data.getAll('pincode').filter((v): v is string => typeof v === 'string');
    const charge = data.get('charge');
    const days = data.get('days');
    const rupees = parseRupees(typeof charge === 'string' ? charge : '', { allowZero: true });
    const leadDays = typeof days === 'string' && /^\d{1,2}$/.test(days.trim()) ? Number(days.trim()) : NaN;
    const ok = rupees.ok && approveApplication(code, { pincodes, shippingPaise: rupees.paise, leadDays });
    setInvalid(!ok);
    if (ok) track('click', { id: 'admin_application_approved', path: window.location.pathname });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4 space-y-3">
      <fieldset aria-describedby={invalid ? id('error') : undefined}>
        <legend className="text-sm font-bold text-ink">{t('appArea')}</legend>
        <p className="text-xs text-muted">{t('appAreaHint')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {defaults.pincodes.map((p) => (
            <label
              key={p}
              className="inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border px-3 text-sm font-bold text-ink"
            >
              <input
                type="checkbox"
                name="pincode"
                value={p}
                defaultChecked
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor={id('charge')} className="text-xs font-bold text-ink">
            {t('appCharge')}
          </label>
          <input
            id={id('charge')}
            name="charge"
            inputMode="decimal"
            defaultValue={String(defaults.shippingPaise / 100)}
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
            defaultValue={String(defaults.leadDays)}
            maxLength={2}
            className={`${portalField} mt-1 block w-20`}
          />
        </div>
      </div>
      {invalid ? (
        <p id={id('error')} role="alert" className="text-xs font-bold text-error">
          {t('appAreaError')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={portalPrimary}>
          {t('appApproveOnboard')}
        </button>
        <button type="button" onClick={onCancel} className={portalQuiet}>
          {t('appCancel')}
        </button>
      </div>
    </form>
  );
}

function RejectForm({ code, onCancel }: { code: string; onCancel: () => void }) {
  const t = useTranslations('portal');
  const [reason, setReason] = useState<ApplicationRejectReason | ''>('');
  const [missing, setMissing] = useState(false);
  const selectId = `reject-${code}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason) {
      setMissing(true);
      document.getElementById(selectId)?.focus();
      return;
    }
    if (rejectApplication(code, reason)) {
      track('click', { id: 'admin_application_rejected', path: window.location.pathname });
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-2">
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
            const v = e.target.value;
            setReason(
              (APPLICATION_REJECT_REASONS as readonly string[]).includes(v)
                ? (v as ApplicationRejectReason)
                : '',
            );
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
      <button type="submit" className={portalPrimary}>
        {t('appRejectConfirm')}
      </button>
      <button type="button" onClick={onCancel} className={portalQuiet}>
        {t('appCancel')}
      </button>
      {missing ? (
        <p id={`${selectId}-error`} className="w-full text-xs font-bold text-error">
          {t('appRejectNeedsReason')}
        </p>
      ) : null}
    </form>
  );
}
