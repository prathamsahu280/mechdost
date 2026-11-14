'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  computeServiceBill,
  ESTIMATE_GST_RATES_BP,
  ESTIMATE_MAX_LINES,
  estimateLineError,
} from '@mechdost/shared/service-bill';
import { VEHICLE_ICON } from '@mechdost/shared/vehicles';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { serviceNameFor } from '@/demo/i18n/localize';
import {
  lastOdometerKm,
  receiveVehicle,
  sendEstimate,
  workshopStep,
  MAX_ODOMETER_KM,
  type NewEstimateLine,
  type WorkshopStep,
} from '@/demo/service-jobs';
import { requestStage, type DemoServiceRequest } from '@/demo/store';
import { workshopGstRegistered } from '@/demo/workshops';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { LineName, ratePct } from '../workshops/service-estimate';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

export function RequestSummary({ request: r }: { request: DemoServiceRequest }) {
  const t = useTranslations('portal');
  const s = useTranslations('request');
  const locale = useLocale();
  return (
    <>
      <p className="mb-2 inline-flex rounded-pill bg-pill px-3 py-1 text-xs font-extrabold text-ink">
        {s(`stage_${requestStage(r)}`)}
      </p>
      <p className="font-heading text-lg font-extrabold text-ink">{r.code}</p>
      <p className="text-sm text-muted">
        {/* The vehicle is what the customer typed: marked as user text (QA 2026-11-14, P4). */}
        <span data-user-content>{r.customer.name}</span> · {VEHICLE_ICON[r.vehicleType]}{' '}
        <span data-user-content>{r.vehicle}</span> · {formatDate(r.date, locale)}, {t(`slot_${r.slot}`)}
      </p>
      <p className="mt-2 text-sm text-ink">
        {t('customerAsked', {
          services: r.services.map((x) => serviceNameFor(x.key, x.name, locale)).join(', '),
        })}
      </p>
      {r.concern ? (
        <p data-user-content className="mt-1 text-sm text-muted">
          “{r.concern}”
        </p>
      ) : null}
    </>
  );
}

const STEP_LABEL: Record<
  WorkshopStep,
  'markWorking' | 'markReady' | 'markBilled' | 'markPaid' | 'markReturned'
> = {
  start: 'markWorking',
  ready: 'markReady',
  bill: 'markBilled',
  paid: 'markPaid',
  return: 'markReturned',
};

/**
 * One job at the workshop (spec 06 / 07): vehicle received with the odometer → itemised estimate → (customer
 * decides) → start approved work → ready → bill → paid at the workshop; a revision is possible until the bill.
 */
export function JobCard({ request: r, workshopSlug }: { request: DemoServiceRequest; workshopSlug: string }) {
  const t = useTranslations('portal');
  const [revising, setRevising] = useState(false);
  const stage = requestStage(r);
  const est = r.estimate;
  const registered = workshopGstRegistered(workshopSlug);
  // The estimate's full value, whatever the customer decided (the bill counts approved lines only).
  const total = est
    ? computeServiceBill(
        est.lines.map((l) => ({ ...l, decision: 'approved' as const })),
        { gstRegistered: registered },
      ).totalPaise
    : 0;
  // Revisions as the canonical machine allows: not while the customer is still deciding (spec 06).
  const canRevise = est !== undefined && ['approved', 'in_progress', 'no_work_approved'].includes(stage);

  // Keyed by step: one button per step, so a double tap never lands on the next step's button.
  const step = (s: WorkshopStep) => (
    <button
      key={s}
      type="button"
      onClick={() => {
        if (workshopStep(r.code, workshopSlug, s))
          track('click', { id: `workshop_job_${s}`, path: window.location.pathname });
      }}
      className={`${portalPrimary} mt-4 w-full`}
    >
      {t(STEP_LABEL[s])}
    </button>
  );

  // A revision starts from the approved lines (concept), or every line when nothing was decided or approved.
  const reviseFrom = (): NewEstimateLine[] => {
    if (!est) return [];
    const approved = est.lines.filter((l) => l.decision === 'approved');
    return (approved.length > 0 ? approved : est.lines).map(
      ({ description, serviceKey, qty, unitPaise, gstRateBp }) => ({
        description,
        serviceKey,
        qty,
        unitPaise,
        gstRateBp,
      }),
    );
  };

  let body: ReactNode;
  if (revising && est) {
    body = (
      <EstimateBuilder
        request={r}
        workshopSlug={workshopSlug}
        initial={reviseFrom()}
        title={t('estimateRevision', { version: est.version + 1 })}
        onDone={() => {
          setRevising(false);
        }}
      />
    );
  } else {
    switch (stage) {
      case 'confirmed':
        body = <OdometerForm request={r} workshopSlug={workshopSlug} />;
        break;
      case 'received':
        body = (
          <EstimateBuilder
            request={r}
            workshopSlug={workshopSlug}
            initial={r.services.map((x) => ({
              description: x.name,
              serviceKey: x.key,
              qty: 1,
              unitPaise: Math.round((x.minPaise + x.maxPaise) / 200) * 100,
              gstRateBp: 1800,
            }))}
            title={t('estimateBuilder')}
          />
        );
        break;
      case 'estimate_sent':
        body = <p className="mt-3 text-sm font-bold text-warning">{t('waitingApproval')}</p>;
        break;
      case 'approved':
        body = step('start');
        break;
      case 'in_progress':
        body = step('ready');
        break;
      case 'ready':
        body = step('bill');
        break;
      case 'billed':
        body = (
          <>
            <p className="mt-3 font-heading font-extrabold text-ink">
              {t('billTotal', { total: formatPrice(r.bill?.totalPaise ?? 0) })}
            </p>
            {step('paid')}
          </>
        );
        break;
      case 'no_work_approved':
        body = step('return');
        break;
      default:
        body = null;
    }
  }

  return (
    <article className={portalCard}>
      <RequestSummary request={r} />
      {est && !revising && stage !== 'received' ? (
        <div className="mt-3 rounded-lg bg-surface-alt p-3 text-sm">
          <p className="font-bold text-ink">
            {t('estimateSummary', { version: est.version, total: formatPrice(total) })}
          </p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {est.lines.map((l) => (
              <li key={l.id} className={l.decision === 'declined' ? 'line-through' : undefined}>
                <LineName line={l} /> · {l.qty} × {formatPrice(l.unitPaise)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {body}
      {canRevise && !revising ? (
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

function OdometerForm({ request: r, workshopSlug }: { request: DemoServiceRequest; workshopSlug: string }) {
  const t = useTranslations('portal');
  const [error, setError] = useState<string | null>(null);
  const id = `${r.code}-odometer`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = new FormData(e.currentTarget).get('odometer');
    const text = typeof raw === 'string' ? raw.replace(/[,\s]/g, '') : '';
    const km = /^\d{1,7}$/.test(text) ? Number(text) : NaN;
    const last = lastOdometerKm(r);
    if (!Number.isInteger(km) || km > MAX_ODOMETER_KM) {
      setError(t('errOdometer'));
    } else if (km < last) {
      setError(t('errOdometerLow', { km: new Intl.NumberFormat('en-IN').format(last) }));
    } else if (receiveVehicle(r.code, workshopSlug, km)) {
      track('click', { id: 'workshop_vehicle_received', path: window.location.pathname });
      return;
    } else {
      setError(t('errJobChanged'));
    }
    document.getElementById(id)?.focus();
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4 space-y-2 border-t border-line pt-4">
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {t('odometerLabel')}
      </label>
      <input
        id={id}
        name="odometer"
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onInput={() => {
          setError(null);
        }}
        className={portalField}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className={`${portalPrimary} w-full`}>
        {t('markReceived')}
      </button>
    </form>
  );
}

interface Row {
  key: number;
  description: string;
  serviceKey?: string;
  qty: string;
  price: string;
  gst: string;
}
type Field = 'description' | 'qty' | 'price' | 'gst';
const FIELD_ID: Record<Field, string> = { description: 'desc', qty: 'qty', price: 'price', gst: 'gst' };

function EstimateBuilder({
  request: r,
  workshopSlug,
  initial,
  title,
  onDone,
}: {
  request: DemoServiceRequest;
  workshopSlug: string;
  initial: readonly NewEstimateLine[];
  title: string;
  onDone?: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const registered = workshopGstRegistered(workshopSlug);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((l, i) => ({
      key: i,
      description: l.serviceKey ? serviceNameFor(l.serviceKey, l.description, locale) : l.description,
      serviceKey: l.serviceKey,
      qty: String(l.qty),
      price: String(l.unitPaise / 100),
      gst: String(registered ? l.gstRateBp : 0),
    })),
  );
  const [nextKey, setNextKey] = useState(initial.length);
  const [errors, setErrors] = useState<Record<number, Field>>({});
  const [changed, setChanged] = useState(false);
  const fieldId = (key: number, f: Field) => `${r.code}-l${String(key)}-${FIELD_ID[f]}`;

  const toLine = (row: Row): NewEstimateLine => {
    const price = row.price.replace(/,/g, '').trim();
    return {
      description: row.description,
      // Edited text is the workshop's own words; untouched menu lines stay localisable.
      serviceKey: row.serviceKey,
      qty: /^\d{1,2}$/.test(row.qty.trim()) ? Number(row.qty.trim()) : 0,
      unitPaise: /^\d{1,7}(\.\d{1,2})?$/.test(price) ? Math.round(Number(price) * 100) : 0,
      gstRateBp: Number(row.gst),
    };
  };

  function update(key: number, change: Partial<Row>) {
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...change } : x)));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== String(key))));
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const lines = rows.map(toLine);
    const found: Record<number, Field> = {};
    rows.forEach((row, i) => {
      const line = lines[i];
      const err = line ? estimateLineError({ ...line, id: '', decision: 'pending' }) : 'description';
      if (err) found[row.key] = err;
    });
    setErrors(found);
    const first = rows.find((row) => found[row.key]);
    if (first) {
      const f = found[first.key];
      if (f) document.getElementById(fieldId(first.key, f))?.focus();
      return;
    }
    if (sendEstimate(r.code, workshopSlug, lines)) {
      setChanged(false);
      track('click', { id: 'workshop_estimate_sent', path: window.location.pathname });
      onDone?.();
    } else {
      setChanged(true);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-extrabold text-ink">{title}</h3>
      {registered ? null : <p className="text-xs text-muted">{t('gstUnregistered')}</p>}
      <ol className="space-y-3">
        {rows.map((row, i) => {
          const n = i + 1;
          const err = errors[row.key];
          const label = (f: Field, short: string) => (
            <label htmlFor={fieldId(row.key, f)} className="text-xs font-bold text-muted">
              <span className="sr-only">{t(`lineLabel_${f}`, { n })}</span>
              <span aria-hidden="true">{short}</span>
            </label>
          );
          const aria = (f: Field) => ({
            id: fieldId(row.key, f),
            'aria-invalid': err === f ? true : undefined,
            'aria-describedby': err === f ? `${fieldId(row.key, f)}-error` : undefined,
          });
          return (
            <li key={row.key} className="rounded-lg border border-line-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-extrabold text-ink">{t('lineN', { n })}</p>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t('removeLine', { n })}
                    onClick={() => {
                      setRows((rs) => rs.filter((x) => x.key !== row.key));
                    }}
                    className="inline-flex size-11 items-center justify-center rounded-button text-muted hover:bg-pill hover:text-ink"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
              <div>
                {label('description', t('field_description'))}
                <input
                  {...aria('description')}
                  value={row.description}
                  maxLength={120}
                  onChange={(e) => {
                    update(row.key, { description: e.currentTarget.value, serviceKey: undefined });
                  }}
                  className={portalField}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  {label('qty', t('field_qty'))}
                  <input
                    {...aria('qty')}
                    inputMode="numeric"
                    value={row.qty}
                    onChange={(e) => {
                      update(row.key, { qty: e.currentTarget.value });
                    }}
                    className={portalField}
                  />
                </div>
                <div>
                  {label('price', t('field_price'))}
                  <input
                    {...aria('price')}
                    inputMode="decimal"
                    value={row.price}
                    onChange={(e) => {
                      update(row.key, { price: e.currentTarget.value });
                    }}
                    className={portalField}
                  />
                </div>
                {registered ? (
                  <div>
                    {label('gst', t('field_gst'))}
                    <select
                      {...aria('gst')}
                      value={row.gst}
                      onChange={(e) => {
                        update(row.key, { gst: e.currentTarget.value });
                      }}
                      className={portalField}
                    >
                      {ESTIMATE_GST_RATES_BP.map((bp) => (
                        <option key={bp} value={String(bp)}>
                          {t('gstOption', { rate: ratePct(bp) })}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              {err ? (
                <p id={`${fieldId(row.key, err)}-error`} className="mt-1 text-xs font-bold text-error">
                  {t(`errLine_${err}`)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {rows.length < ESTIMATE_MAX_LINES ? (
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [
              ...rs,
              { key: nextKey, description: '', qty: '1', price: '', gst: registered ? '1800' : '0' },
            ]);
            setNextKey((k) => k + 1);
          }}
          className={`${portalQuiet} w-full`}
        >
          {t('addLine')}
        </button>
      ) : null}
      {changed ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('errJobChanged')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${portalPrimary} flex-1`}>
          {t('sendEstimate')}
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className={portalQuiet}>
            {t('keepEstimate')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
