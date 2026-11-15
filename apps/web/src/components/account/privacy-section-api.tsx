'use client';

import type { ConsentView, ExportStatus, PrivacyPurpose, PrivacyView } from '@mechdost/shared/privacy-api';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { saveConsent as saveDeviceConsent } from '@/lib/consent';
import { formatDate } from '@/lib/format';
import { localePath } from '@/lib/locale-path';
import { ACCOUNT_DELETION_HOOK } from '@/lib/privacy-hooks';
import { downloadExport, fetchPrivacy, requestExport, saveConsent } from '@/lib/privacy-api';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; view: PrivacyView };
type Notice = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Account -> Privacy (DPDP; design 2026-11-15 item 6; real sign-in builds). Three plain cards, one action each:
 * consents per purpose (the date of the last answer, one button to allow or withdraw; a withdrawal is effective at
 * once: promotions stop, and this browser stops sending analytics events), "Download my data" (the worker builds the
 * file, the download works for 24 hours, only here, only signed in) and "Delete my account" (a support request; staff
 * confirm, nothing is deleted from this page).
 */
export function PrivacySectionApi() {
  const t = useTranslations('privacy');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const reload = useCallback(async () => {
    const res = await fetchPrivacy(locale);
    setLoad(res.ok ? { kind: 'ok', view: res.data } : { kind: 'error' });
  }, [locale]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // A file being built shows up within a minute: look again every 5 seconds while it is "requested".
  const waiting = load.kind === 'ok' && load.view.export?.status === 'requested';
  useEffect(() => {
    if (!waiting) return undefined;
    const id = window.setInterval(() => {
      void reload();
    }, 5000);
    return () => {
      window.clearInterval(id);
    };
  }, [waiting, reload]);

  async function change(purpose: PrivacyPurpose, granted: boolean) {
    setBusy(purpose);
    setNotice(null);
    const res = await saveConsent(locale, purpose, granted);
    setBusy(null);
    if (!res.ok) {
      setNotice({ tone: 'error', text: t('error') });
      return;
    }
    // This browser follows at once (the footer "Privacy choices" and the event sender read the same choice).
    if (purpose === 'analytics') saveDeviceConsent(granted);
    setNotice({ tone: 'ok', text: t('saved') });
    await reload();
  }

  async function askForExport() {
    setBusy('export');
    setNotice(null);
    const res = await requestExport(locale);
    setBusy(null);
    if (!res.ok) {
      const key =
        res.code === 'EXPORT_TOO_SOON'
          ? 'exportTooSoon'
          : res.code === 'EXPORT_ACTIVE'
            ? 'exportActive'
            : 'exportError';
      setNotice({ tone: 'error', text: t(key) });
      await reload();
      return;
    }
    await reload();
  }

  async function download(id: string) {
    setBusy('download');
    setNotice(null);
    const res = await downloadExport(locale, id);
    setBusy(null);
    if (!res.ok) {
      setNotice({ tone: 'error', text: t(res.code === 'EXPORT_EXPIRED' ? 'exportExpired' : 'exportError') });
      await reload();
    }
  }

  if (load.kind === 'loading') return <div className="skeleton h-72 rounded-card" aria-hidden="true" />;
  if (load.kind === 'error')
    return (
      <p role="alert" className="text-sm font-bold text-error">
        {t('loadError')}
      </p>
    );
  const { view } = load;

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted">{t('intro')}</p>
      <section aria-labelledby="privacy-consents" className={card}>
        <h2 id="privacy-consents" className="font-heading text-base font-extrabold text-ink">
          {t('consentsTitle')}
        </h2>
        <ul className="mt-4 divide-y divide-line">
          {view.consents.map((c) => (
            <ConsentRow
              key={c.purpose}
              consent={c}
              busy={busy === c.purpose}
              onChange={(granted) => void change(c.purpose, granted)}
            />
          ))}
        </ul>
      </section>

      <ExportCard
        status={view.export}
        canRequest={view.canRequestExport}
        busy={busy}
        onRequest={() => void askForExport()}
        onDownload={(id) => void download(id)}
        onRefresh={() => void reload()}
      />

      <section aria-labelledby="privacy-delete" className={card}>
        <h2 id="privacy-delete" className="font-heading text-base font-extrabold text-ink">
          {t('deleteTitle')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('deleteHelp')}</p>
        <Link
          href={`${localePath(ACCOUNT_DELETION_HOOK.path, locale)}?${new URLSearchParams(ACCOUNT_DELETION_HOOK.query).toString()}`}
          data-track="privacy_delete_request"
          className={`${quiet} mt-4`}
        >
          {t('deleteButton')}
        </Link>
      </section>

      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm ${notice?.tone === 'error' ? 'font-bold text-error' : 'text-muted'}`}
      >
        {notice?.text ?? ''}
      </p>
    </div>
  );
}

function ConsentRow({
  consent,
  busy,
  onChange,
}: {
  consent: ConsentView;
  busy: boolean;
  onChange: (granted: boolean) => void;
}) {
  const t = useTranslations('privacy');
  const locale = useLocale();
  const id = useId();
  const name = t(`purpose_${consent.purpose}`);
  const on = consent.granted === true;
  const when = consent.at ? formatDate(consent.at, locale) : null;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 tab:flex-row tab:items-start tab:justify-between">
      <div className="min-w-0">
        <p id={id} className="text-sm font-bold text-ink">
          {name}
        </p>
        <p className="mt-0.5 max-w-prose text-[13px] text-muted">{t(`purpose_${consent.purpose}_help`)}</p>
        <p className="mt-1 text-[13px] font-bold text-ink">
          {consent.granted === null || when === null
            ? t('never')
            : t(on ? 'since_allowed' : 'since_withdrawn', { date: when })}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        aria-describedby={id}
        aria-label={t(on ? 'withdrawNamed' : 'allowNamed', { name })}
        onClick={() => {
          onChange(!on);
        }}
        className={on ? quiet : primary}
      >
        {t(on ? 'withdraw' : 'allow')}
      </button>
    </li>
  );
}

function ExportCard({
  status,
  canRequest,
  busy,
  onRequest,
  onDownload,
  onRefresh,
}: {
  status: ExportStatus | null;
  canRequest: boolean;
  busy: string | null;
  onRequest: () => void;
  onDownload: (id: string) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations('privacy');
  const locale = useLocale();
  const ready = status?.status === 'ready' && status.expiresAt !== null;
  return (
    <section aria-labelledby="privacy-export" className={card}>
      <h2 id="privacy-export" className="font-heading text-base font-extrabold text-ink">
        {t('exportTitle')}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">{t('exportHelp')}</p>
      {status ? (
        <p className="mt-3 text-sm font-bold text-ink">
          {t(`exportStatus_${status.status}`, {
            date: status.expiresAt ? formatDate(status.expiresAt, locale) : '',
          })}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {ready ? (
          <button
            type="button"
            disabled={busy === 'download'}
            onClick={() => {
              onDownload(status.id);
            }}
            className={primary}
          >
            {t('exportDownload')}
          </button>
        ) : null}
        {status?.status === 'requested' ? (
          <button type="button" onClick={onRefresh} className={quiet}>
            {t('exportRefresh')}
          </button>
        ) : null}
        {canRequest ? (
          <button
            type="button"
            disabled={busy === 'export'}
            onClick={onRequest}
            className={ready ? quiet : primary}
          >
            {t('exportRequest')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
