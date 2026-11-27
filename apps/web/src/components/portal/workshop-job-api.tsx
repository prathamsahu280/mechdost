'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BillCreatedDto,
  EstimateSentDto,
  ServiceChangedDto,
  type ServiceRequestDetail,
} from '@mechdost/shared/service-api';
import { ESTIMATE_GST_RATES_BP, ESTIMATE_MAX_LINES, estimateLineError } from '@mechdost/shared/service-bill';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import {
  afterPhotoMissing,
  badLineFrom,
  beforePhotoMissing,
  lastKmFrom,
  parseOdometerKm,
  ratePct,
  serviceErrorKey,
  STEP_PATH,
  type WorkshopAction,
} from '@/lib/service-views';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';

const PAY_METHODS = ['cash', 'upi', 'card'] as const;
type PayMethod = (typeof PAY_METHODS)[number];

const stepUrl = (code: string, step: string) => `/workshop/requests/${encodeURIComponent(code)}/${step}`;

/** The vehicle is here: record the odometer (never below the last reading; the API checks and says which). */
export function OdometerFormApi({
  detail,
  onDone,
  photosTick = 0,
}: {
  detail: ServiceRequestDetail;
  onDone: () => Promise<void>;
  /** Bumped by the photo panel when a photo is added or removed, so the "received" gate re-checks. */
  photosTick?: number;
}) {
  const t = useTranslations('portal');
  const r = useTranslations('request');
  const pt = useTranslations('photos');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Received" needs a before photo when photos are required: say so up front instead of a press the API refuses.
  const [needsBefore, setNeedsBefore] = useState(false);
  useEffect(() => {
    const alive: { current: boolean } = { current: true };
    void (async () => {
      const { fetchWorkshopPhotos } = await import('@/lib/photos-api');
      const res = await fetchWorkshopPhotos(locale, detail.code);
      if (alive.current && res.ok) setNeedsBefore(beforePhotoMissing(res.data));
    })();
    return () => {
      alive.current = false;
    };
  }, [detail.code, locale, photosTick]);
  const id = `${detail.code}-odometer`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = new FormData(e.currentTarget).get('odometer');
    const km = parseOdometerKm(typeof raw === 'string' ? raw : '');
    if (km === null) {
      setError(t('errOdometer'));
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, stepUrl(detail.code, 'vehicle-received'), ServiceChangedDto, {
      method: 'POST',
      body: { odometerKm: km, version: detail.version },
    });
    setBusy(false);
    if (res.ok) {
      track('click', { id: 'workshop_vehicle_received', path: window.location.pathname });
      await onDone();
      return;
    }
    const last = res.code === 'ODOMETER_BELOW_LAST' ? lastKmFrom(res.details) : null;
    setError(
      last !== null
        ? t('errOdometerLow', { km: new Intl.NumberFormat('en-IN').format(last) })
        : r(serviceErrorKey(res.code) as 'api_err_generic'),
    );
    document.getElementById(id)?.focus();
    if (res.code === 'STALE_REQUEST' || res.code === 'WRONG_STEP') await onDone();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-4 space-y-2 border-t border-line pt-4"
    >
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
      <button
        type="submit"
        disabled={busy || needsBefore}
        aria-describedby={needsBefore ? `${id}-why` : undefined}
        className={`${portalPrimary} w-full`}
      >
        {t('markReceived')}
      </button>
      {needsBefore ? (
        <p id={`${id}-why`} className="text-xs font-bold text-warning">
          {pt('err_PHOTOS_REQUIRED_before')}
        </p>
      ) : null}
    </form>
  );
}

export interface DraftLine {
  description: string;
  serviceKey: string | null;
  qty: number;
  unitPaise: number;
  gstRateBp: number;
}

interface Row {
  key: number;
  description: string;
  serviceKey: string | null;
  qty: string;
  price: string;
  gst: string;
}
type Field = 'description' | 'qty' | 'price' | 'gst';
const FIELD_ID: Record<Field, string> = { description: 'desc', qty: 'qty', price: 'price', gst: 'gst' };

/** Whether the workshop bills GST: from its public page (null while unknown → the GST choice is shown). */
function useGstRegistered(slug: string | null): boolean | null {
  const locale = useLocale();
  const [registered, setRegistered] = useState<boolean | null>(null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    void import('@/lib/service-api').then(async ({ fetchWorkshop }) => {
      const res = await fetchWorkshop(locale, slug);
      if (live && res.ok) setRegistered(res.data.gstRegistered);
    });
    return () => {
      live = false;
    };
  }, [locale, slug]);
  return registered;
}

/**
 * Itemised estimate (a new revision each time; every decision starts again): description, qty 1–99, price, GST slab;
 * up to 20 lines, checked here with the shared `estimateLineError` and again by the API (`ESTIMATE_LINE`).
 */
export function EstimateBuilderApi({
  detail,
  initial,
  title,
  onDone,
  onCancel,
}: {
  detail: ServiceRequestDetail;
  initial: readonly DraftLine[];
  title: string;
  onDone: () => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useTranslations('portal');
  const r = useTranslations('request');
  const locale = useLocale();
  const known = useGstRegistered(detail.workshop?.slug ?? null);
  const registered = known !== false;
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((l, i) => ({
      key: i,
      description: l.description,
      serviceKey: l.serviceKey,
      qty: String(l.qty),
      price: String(l.unitPaise / 100),
      gst: String(l.gstRateBp),
    })),
  );
  const [nextKey, setNextKey] = useState(initial.length);
  const [errors, setErrors] = useState<Record<number, Field>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = (key: number, f: Field) => `${detail.code}-l${String(key)}-${FIELD_ID[f]}`;

  const toLine = (row: Row): DraftLine => {
    const price = row.price.replace(/,/g, '').trim();
    return {
      description: row.description.trim(),
      serviceKey: row.serviceKey,
      qty: /^\d{1,2}$/.test(row.qty.trim()) ? Number(row.qty.trim()) : 0,
      unitPaise: /^\d{1,7}(\.\d{1,2})?$/.test(price) ? Math.round(Number(price) * 100) : 0,
      // An unregistered workshop charges no GST (the bill would drop it anyway).
      gstRateBp: registered ? Number(row.gst) : 0,
    };
  };

  function update(key: number, change: Partial<Row>) {
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...change } : x)));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== String(key))));
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const lines = rows.map(toLine);
    const found: Record<number, Field> = {};
    rows.forEach((row, i) => {
      const line = lines[i];
      const err = line ? estimateLineError({ ...line, id: '', decision: 'pending' }) : 'description';
      if (err) found[row.key] = err;
    });
    setErrors(found);
    setApiError(null);
    const first = rows.find((row) => found[row.key]);
    if (first) {
      const f = found[first.key];
      if (f) document.getElementById(fieldId(first.key, f))?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, stepUrl(detail.code, 'estimates'), EstimateSentDto, {
      method: 'POST',
      body: {
        lines: lines.map((l) => ({ ...l, serviceKey: l.serviceKey ?? null })),
        version: detail.version,
      },
    });
    setBusy(false);
    if (res.ok) {
      track('click', { id: 'workshop_estimate_sent', path: window.location.pathname });
      await onDone();
      return;
    }
    const bad = res.code === 'ESTIMATE_LINE' ? badLineFrom(res.details) : null;
    const row = bad ? rows[bad.line - 1] : undefined;
    if (bad && row) {
      setErrors({ [row.key]: bad.field });
      document.getElementById(fieldId(row.key, bad.field))?.focus();
      return;
    }
    setApiError(res.code);
    if (res.code === 'STALE_REQUEST' || res.code === 'WRONG_STEP') await onDone();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-4 space-y-3 border-t border-line pt-4"
    >
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
                    update(row.key, { description: e.currentTarget.value, serviceKey: null });
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
              { key: nextKey, description: '', serviceKey: null, qty: '1', price: '', gst: '1800' },
            ]);
            setNextKey((k) => k + 1);
          }}
          className={`${portalQuiet} w-full`}
        >
          {t('addLine')}
        </button>
      ) : null}
      {apiError ? (
        <p role="alert" className="text-sm font-bold text-error">
          {r(serviceErrorKey(apiError) as 'api_err_generic')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={`${portalPrimary} flex-1`}>
          {t('sendEstimate')}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={portalQuiet}>
            {t('keepEstimate')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

const STEP_LABEL = {
  start: 'markWorking',
  ready: 'markReady',
  bill: 'markBilled',
  return: 'markReturned',
} as const;

/** One-click job steps (start, ready, bill, vehicle returned) and "paid at the workshop" with the method. */
export function JobStepsApi({
  detail,
  action,
  onDone,
  photosTick = 0,
}: {
  detail: ServiceRequestDetail;
  action: WorkshopAction;
  onDone: () => Promise<void>;
  /** Bumped by the photo panel when a photo is added or removed, so the "ready" gate re-checks. */
  photosTick?: number;
}) {
  const t = useTranslations('portal');
  const r = useTranslations('request');
  const pt = useTranslations('photos');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  // "Ready" needs an after photo when photos are required: say so up front instead of a press that does nothing.
  const [needsAfter, setNeedsAfter] = useState(false);
  useEffect(() => {
    if (action !== 'ready') return;
    const alive: { current: boolean } = { current: true };
    void (async () => {
      const { fetchWorkshopPhotos } = await import('@/lib/photos-api');
      const res = await fetchWorkshopPhotos(locale, detail.code);
      if (alive.current && res.ok) setNeedsAfter(afterPhotoMissing(res.data));
    })();
    return () => {
      alive.current = false;
    };
  }, [action, detail.code, locale, photosTick]);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [missing, setMissing] = useState(false);
  const methodId = `${detail.code}-method`;

  async function step(path: string, body: Record<string, unknown>, trackId: string) {
    setBusy(true);
    setError(null);
    const schema = path === 'bill' ? BillCreatedDto : ServiceChangedDto;
    const res = await adminApi(locale, stepUrl(detail.code, path), schema, {
      method: 'POST',
      body: { ...body, version: detail.version },
    });
    setBusy(false);
    if (res.ok) track('click', { id: trackId, path: window.location.pathname });
    else setError(res.code);
    await onDone();
  }

  if (action === 'paid')
    return (
      <div className="mt-3 space-y-2">
        {/* Bill total in Manrope 28 px; the payment way as three 48 px choices with words (design 2026-11-27 § 6.5b). */}
        <p className="font-heading text-[28px] leading-tight font-extrabold tabular-nums text-ink">
          {t('billTotal', { total: formatPrice(detail.bill?.totalPaise ?? 0) })}
        </p>
        <fieldset
          id={methodId}
          tabIndex={-1}
          aria-invalid={missing ? true : undefined}
          aria-describedby={missing ? `${methodId}-error` : undefined}
        >
          <legend className="text-xs font-bold text-muted">{t('ws_api_payMethod')}</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {PAY_METHODS.map((m) => (
              <label
                key={m}
                className="flex min-h-12 cursor-pointer items-center justify-center rounded-button border border-line-card bg-surface px-2 text-center text-sm font-bold text-ink has-[:checked]:border-accent-button has-[:checked]:bg-accent-soft has-[:checked]:text-accent-soft-text has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
              >
                <input
                  type="radio"
                  name={methodId}
                  value={m}
                  checked={method === m}
                  onChange={() => {
                    setMethod(m);
                    setMissing(false);
                  }}
                  className="sr-only"
                />
                {t(`ws_api_payMethod_${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {missing ? (
          <p id={`${methodId}-error`} className="text-xs font-bold text-error">
            {t('ws_api_payMethodRequired')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-bold text-error">
            {r(serviceErrorKey(error) as 'api_err_generic')}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!method) {
              setMissing(true);
              document.getElementById(methodId)?.focus();
              return;
            }
            void step('mark-paid', { method }, 'workshop_job_paid');
          }}
          className={`${portalPrimary} w-full`}
        >
          {t('markPaid')}
        </button>
      </div>
    );

  if (action !== 'start' && action !== 'ready' && action !== 'bill' && action !== 'return') return null;
  return (
    <div className="mt-4 space-y-2">
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {r(serviceErrorKey(error) as 'api_err_generic')}
        </p>
      ) : null}
      <button
        key={action}
        type="button"
        disabled={busy || (action === 'ready' && needsAfter)}
        aria-describedby={action === 'ready' && needsAfter ? `${detail.code}-ready-why` : undefined}
        onClick={() => void step(STEP_PATH[action], {}, `workshop_job_${action}`)}
        className={`${portalPrimary} w-full`}
      >
        {t(STEP_LABEL[action])}
      </button>
      {action === 'ready' && needsAfter ? (
        <p id={`${detail.code}-ready-why`} className="text-xs font-bold text-warning">
          {pt('err_PHOTOS_REQUIRED_after')}
        </p>
      ) : null}
    </div>
  );
}
