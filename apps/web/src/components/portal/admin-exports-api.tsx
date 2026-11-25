'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  EXPORT_DATASETS,
  MAX_EXPORT_DAYS,
  type ExportDataset,
  type ExportOptions,
} from '@mechdost/shared/exports';
import { track } from '@/lib/analytics';
import { commonErrorKey } from '@/lib/api-error-key';
import { downloadExportFile, fetchExportOptions, requestExport, saveBlob } from '@/lib/admin-exports-api';
import {
  defaultExportRange,
  exportErrorKey,
  localRangeError,
  type ExportErrorKey,
} from '@/lib/admin-exports-view';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

interface Done {
  rows: number;
  file: string;
  masked: boolean;
}
const isDataset = (v: string): v is ExportDataset => EXPORT_DATASETS.some((d) => d === v);
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * Admin → Exports (real sign-in builds; design 2026-11-15 item 4, specs 08/13): pick a dataset, a city and up to 180
 * days (Indian time) and download one CSV. One action: "Download CSV" asks the API to prepare the file (it checks
 * the rights, audits the request and returns a 10-minute link), then fetches it with the same sign-in and hands it to
 * the browser. Only the datasets and cities the viewer may export are offered; customer phone numbers and emails are
 * masked unless the role allows them (the API decides, the note below says so).
 */
export function AdminExportsApi() {
  const t = useTranslations('adminExports');
  const tc = useTranslations('portal');
  const locale = useLocale();
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<ExportDataset | null>(null);
  const [range] = useState(() => defaultExportRange(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ own: ExportErrorKey | null; code: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    void fetchExportOptions(locale).then((res) => {
      if (!res.ok) {
        setLoadError(res.code);
        return;
      }
      setOptions(res.data);
      setDataset(res.data.datasets[0] ?? null);
    });
  }, [locale]);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dataset || busy) return;
    const f = new FormData(e.currentTarget);
    const from = text(f.get('from'));
    const to = text(f.get('to'));
    const cityCode = text(f.get('city'));
    setDone(null);
    const local = localRangeError(from, to);
    if (local) {
      setError({ own: local, code: 'VALIDATION' });
      track('admin_export_action', { dataset, action: 'refused' });
      return;
    }
    setError(null);
    setBusy(true);
    track('admin_export_action', { dataset, action: 'requested' });
    const ticket = await requestExport(locale, {
      dataset,
      from,
      to,
      ...(cityCode && dataset !== 'customers' ? { cityCode } : {}),
    });
    if (!ticket.ok) {
      setBusy(false);
      setError({ own: exportErrorKey(ticket.code), code: ticket.code });
      track('admin_export_action', { dataset, action: 'refused' });
      return;
    }
    const file = await downloadExportFile(locale, ticket.data.downloadPath);
    setBusy(false);
    if (!file.ok) {
      setError({ own: exportErrorKey(file.code), code: file.code });
      track('admin_export_action', { dataset, action: 'refused' });
      return;
    }
    saveBlob(file.data, ticket.data.fileName);
    track('admin_export_action', { dataset, action: 'downloaded' });
    setDone({ rows: ticket.data.rowCount, file: ticket.data.fileName, masked: ticket.data.masked });
  }

  if (loadError)
    return (
      <section aria-labelledby="exports-title" className="space-y-4">
        <Heading id="exports-title" title={t('title')} lead={t('lead', { days: MAX_EXPORT_DAYS })} />
        <div role="alert" className={`${adminCard} flex flex-wrap items-center gap-3`}>
          <p className="text-sm font-bold text-error">{tc(commonErrorKey(loadError))}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              window.location.reload();
            }}
          >
            {tc('api_common_retry')}
          </button>
        </div>
      </section>
    );

  return (
    <section aria-labelledby="exports-title" className="space-y-4">
      <Heading id="exports-title" title={t('title')} lead={t('lead', { days: MAX_EXPORT_DAYS })} />

      {!options ? (
        <p role="status" className="text-sm text-muted">
          {tc('api_common_loading')}
        </p>
      ) : options.datasets.length === 0 ? (
        <div className={adminCard}>
          <p className="text-sm text-muted">{t('none')}</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          aria-busy={busy}
          className={`${adminCard} grid gap-4 min-[700px]:grid-cols-2`}
        >
          <div>
            <label htmlFor="export-dataset" className="text-sm font-bold text-ink">
              {t('dataset')}
            </label>
            <select
              id="export-dataset"
              name="dataset"
              autoComplete="off"
              className={portalField}
              value={dataset ?? ''}
              onChange={(e) => {
                if (isDataset(e.target.value)) setDataset(e.target.value);
                setDone(null);
                setError(null);
              }}
            >
              {options.datasets.map((d) => (
                <option key={d} value={d}>
                  {t(`dataset_${d}`)}
                </option>
              ))}
            </select>
            {dataset ? <p className="mt-1 text-xs text-muted">{t(`datasetHelp_${dataset}`)}</p> : null}
          </div>

          {dataset === 'customers' ? (
            <div className="self-end text-xs text-muted">
              <p>{t(options.contactsMasked ? 'contactsMasked' : 'contactsOpen')}</p>
            </div>
          ) : (
            <div>
              <label htmlFor="export-city" className="text-sm font-bold text-ink">
                {t('city')}
              </label>
              <select id="export-city" name="city" autoComplete="off" className={portalField} defaultValue="">
                <option value="">{t(options.cities.length > 1 ? 'allCities' : 'myCities')}</option>
                {options.cities.map((c) => (
                  <option key={c.code} value={c.code}>
                    {locale === 'hi' && c.nameHi ? c.nameHi : c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="export-from" className="text-sm font-bold text-ink">
              {t('from')}
            </label>
            <input
              id="export-from"
              name="from"
              autoComplete="off"
              type="date"
              required
              defaultValue={range.from}
              className={portalField}
              aria-describedby="export-range-help"
            />
          </div>
          <div>
            <label htmlFor="export-to" className="text-sm font-bold text-ink">
              {t('to')}
            </label>
            <input
              id="export-to"
              name="to"
              autoComplete="off"
              type="date"
              required
              defaultValue={range.to}
              className={portalField}
              aria-describedby="export-range-help"
            />
          </div>
          <p id="export-range-help" className="text-xs text-muted min-[700px]:col-span-2">
            {t('rangeHelp', { days: MAX_EXPORT_DAYS })}
          </p>

          {error ? (
            <p role="alert" className="text-sm font-bold text-error min-[700px]:col-span-2">
              {error.own ? t(error.own, { days: MAX_EXPORT_DAYS }) : tc(commonErrorKey(error.code))}
            </p>
          ) : null}
          {/* Always in the page so a screen reader announces the result when it appears. */}
          <p role="status" className="text-sm font-bold text-ink empty:hidden min-[700px]:col-span-2">
            {done
              ? `${t(done.rows === 0 ? 'doneEmpty' : 'done', { rows: done.rows, file: done.file })}${done.masked ? ` ${t('doneMasked')}` : ''}`
              : null}
          </p>

          <div className="min-[700px]:col-span-2">
            <button type="submit" disabled={busy || !dataset} className={portalPrimary}>
              {busy ? t('preparing') : t('download')}
            </button>
          </div>
        </form>
      )}
      <p className="max-w-2xl text-xs text-muted">{t('fileNote')}</p>
    </section>
  );
}

function Heading({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div>
      <h2 id={id} className="font-heading text-xl font-extrabold text-ink">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{lead}</p>
    </div>
  );
}
