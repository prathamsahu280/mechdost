'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  ArrivalResultDto,
  HomeSettingsListDto,
  HomeSettingsSavedDto,
  MoveProposedDto,
  ServiceChangedDto,
  type HomeSettingsList,
  type ServiceRequestDetail,
} from '@mechdost/shared/service-api';
import {
  MOVE_REASONS,
  MOVE_TRANSPORTS,
  VISIT_FEE_WAIVE_REASONS,
  type MoveReason,
  type MoveTransport,
  type VisitFeeWaiveReason,
} from '@mechdost/shared/state';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import {
  homeErrorKey,
  mayOfferMove,
  mayWaiveFee,
  parseHomeSettingsInput,
  pendingMove,
  visitFeeDue,
} from '@/lib/home-service-views';
import { lastKmFrom, parseOdometerKm, serviceErrorKey } from '@/lib/service-views';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { ServiceApiError } from './service-api-error';

const stepUrl = (code: string, step: string) => `/workshop/requests/${encodeURIComponent(code)}/${step}`;

/**
 * Home visit, workshop side (spec 06/07, design 2026-11-15): arrival with the customer's code and the odometer, the
 * offer to move the job to the workshop, waiving the visit fee, and the workshop's own home servicing settings.
 */

/** The mechanic arrived: the customer's 4-digit arrival code and the odometer (never below the last reading). */
export function ArrivalFormApi({
  detail,
  onDone,
}: {
  detail: ServiceRequestDetail;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const h = useTranslations('homeService');
  const r = useTranslations('request');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `${detail.code}-arrival`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const odo = form.get('odometer');
    const code = form.get('arrivalCode');
    const km = parseOdometerKm(typeof odo === 'string' ? odo : '');
    const digits = typeof code === 'string' ? code.trim() : '';
    if (!/^\d{4}$/.test(digits)) {
      setError(h('arrivalFormat'));
      document.getElementById(`${id}-code`)?.focus();
      return;
    }
    if (km === null) {
      setError(t('errOdometer'));
      document.getElementById(`${id}-odometer`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, stepUrl(detail.code, 'vehicle-received'), ArrivalResultDto, {
      method: 'POST',
      body: { odometerKm: km, arrivalCode: digits, version: detail.version },
    });
    setBusy(false);
    if (!res.ok) {
      const last = res.code === 'ODOMETER_BELOW_LAST' ? lastKmFrom(res.details) : null;
      setError(
        last !== null
          ? t('errOdometerLow', { km: new Intl.NumberFormat('en-IN').format(last) })
          : homeErrorKey(res.code)
            ? h(homeErrorKey(res.code) as 'err_NO_MOVE')
            : r(serviceErrorKey(res.code) as 'api_err_generic'),
      );
      if (res.code === 'STALE_REQUEST' || res.code === 'WRONG_STEP') await onDone();
      return;
    }
    if (res.data.ok) {
      track('click', { id: 'workshop_home_arrived', path: window.location.pathname });
      await onDone();
      return;
    }
    // A wrong or locked code is an answer, not an error: say how many tries are left.
    setError(
      res.data.reason === 'locked'
        ? h('arrivalLockedWorkshop')
        : h('arrivalWrong', { count: res.data.attemptsLeft ?? 0 }),
    );
    document.getElementById(`${id}-code`)?.focus();
  }

  const locked = error === h('arrivalLockedWorkshop');
  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={busy || undefined}
      className="mt-4 space-y-2 border-t border-line pt-4"
    >
      <label htmlFor={`${id}-code`} className="text-xs font-bold text-muted">
        {h('arrivalCodeLabel')}
      </label>
      <input
        id={`${id}-code`}
        name="arrivalCode"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        aria-describedby={`${id}-hint`}
        aria-invalid={error ? true : undefined}
        className={portalField}
        disabled={locked}
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {h('arrivalHint')}
      </p>
      <label htmlFor={`${id}-odometer`} className="text-xs font-bold text-muted">
        {t('odometerLabel')}
      </label>
      <input
        id={`${id}-odometer`}
        name="odometer"
        inputMode="numeric"
        autoComplete="off"
        className={portalField}
        disabled={locked}
      />
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || locked} className={`${portalPrimary} w-full`}>
        {h('markArrived')}
      </button>
    </form>
  );
}

/** Home job extras on a job card: the customer's address, the fee due, the offer to move, waiving the fee. */
export function HomeJobExtrasApi({
  detail,
  onDone,
}: {
  detail: ServiceRequestDetail;
  onDone: () => Promise<void>;
}) {
  const h = useTranslations('homeService');
  const home = detail.home;
  if (!home) return null;
  const move = pendingMove(home);
  return (
    <div className="mt-3 space-y-3 text-sm">
      {home.address ? (
        <p className="text-muted">
          <span className="font-bold text-ink">{h('customerAddress')}: </span>
          <span data-user-content>
            {[home.address.line1, home.address.line2, home.address.landmark].filter(Boolean).join(', ')}
          </span>
        </p>
      ) : null}
      {visitFeeDue(detail) ? (
        <p className="text-muted">{h('feeDueNote', { fee: formatPrice(home.visitFeePaise) })}</p>
      ) : null}
      {move ? <p className="font-bold text-warning">{h('moveOfferWaiting')}</p> : null}
      {home.move?.status === 'accepted' ? (
        <p className="font-bold text-success">{h('moveOfferAccepted')}</p>
      ) : null}
      {home.move?.status === 'declined' ? (
        <p className="font-bold text-warning">{h('moveOfferDeclined')}</p>
      ) : null}
      {mayOfferMove(detail) ? <MoveOfferForm detail={detail} onDone={onDone} /> : null}
      {mayWaiveFee(detail) ? <WaiveForm detail={detail} onDone={onDone} /> : null}
    </div>
  );
}

function MoveOfferForm({ detail, onDone }: { detail: ServiceRequestDetail; onDone: () => Promise<void> }) {
  const h = useTranslations('homeService');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<MoveReason | ''>('');
  const [transport, setTransport] = useState<MoveTransport | ''>('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `${detail.code}-move`;

  async function send() {
    if (!reason || !transport) {
      setMissing(true);
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await adminApi(locale, stepUrl(detail.code, 'move'), MoveProposedDto, {
      method: 'POST',
      body: { reasonCode: reason, transport, version: detail.version },
    });
    setBusy(false);
    if (!res.ok) setError(res.code);
    else track('click', { id: 'workshop_home_move_offered', path: window.location.pathname });
    await onDone();
  }

  if (!open)
    return (
      <button
        data-disclosure-trigger={`move-${detail.code}`}
        type="button"
        data-track="workshop_home_move_open"
        onClick={() => {
          setOpen(true);
        }}
        className={`${portalQuiet} w-full`}
      >
        {h('moveOfferTitle')}
      </button>
    );
  return (
    <div aria-busy={busy || undefined} className="space-y-2 rounded-lg border border-line-card p-3">
      <p className="font-bold text-ink">{h('moveOfferTitle')}</p>
      <label htmlFor={`${id}-reason`} className="text-xs font-bold text-muted">
        {h('moveOfferReason')}
      </label>
      <select
        id={`${id}-reason`}
        value={reason}
        aria-invalid={missing && !reason ? true : undefined}
        onChange={(e) => {
          setReason(MOVE_REASONS.find((x) => x === e.target.value) ?? '');
          setMissing(false);
        }}
        className={portalField}
      >
        <option value="">{h('moveOfferChoose')}</option>
        {MOVE_REASONS.map((x) => (
          <option key={x} value={x}>
            {h(`moveReason_${x}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-transport`} className="text-xs font-bold text-muted">
        {h('moveOfferTransport')}
      </label>
      <select
        id={`${id}-transport`}
        value={transport}
        aria-invalid={missing && !transport ? true : undefined}
        onChange={(e) => {
          setTransport(MOVE_TRANSPORTS.find((x) => x === e.target.value) ?? '');
          setMissing(false);
        }}
        className={portalField}
      >
        <option value="">{h('moveOfferChoose')}</option>
        {MOVE_TRANSPORTS.map((x) => (
          <option key={x} value={x}>
            {h(`moveTransport_${x}`)}
          </option>
        ))}
      </select>
      {missing ? <p className="text-xs font-bold text-error">{h('moveOfferRequired')}</p> : null}
      {error ? <ServiceApiError code={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send()}
          className={`${portalPrimary} flex-1`}
        >
          {h('moveOfferSend')}
        </button>
        <button
          data-panel-cancel={`move-${detail.code}`}
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {h('moveDecline')}
        </button>
      </div>
    </div>
  );
}

function WaiveForm({ detail, onDone }: { detail: ServiceRequestDetail; onDone: () => Promise<void> }) {
  const h = useTranslations('homeService');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<VisitFeeWaiveReason | ''>('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `${detail.code}-waive`;

  async function waive() {
    if (!reason) {
      setMissing(true);
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await adminApi(locale, stepUrl(detail.code, 'waive-visit-fee'), ServiceChangedDto, {
      method: 'POST',
      body: { reasonCode: reason, version: detail.version },
    });
    setBusy(false);
    if (!res.ok) setError(res.code);
    else track('click', { id: 'workshop_home_fee_waived', path: window.location.pathname });
    await onDone();
  }

  if (!open)
    return (
      <button
        data-disclosure-trigger={`waive-${detail.code}`}
        type="button"
        data-track="workshop_home_waive_open"
        onClick={() => {
          setOpen(true);
        }}
        className={`${portalQuiet} w-full`}
      >
        {h('waiveTitle')}
      </button>
    );
  return (
    <div aria-busy={busy || undefined} className="space-y-2 rounded-lg border border-line-card p-3">
      <label htmlFor={id} className="font-bold text-ink">
        {h('waiveTitle')}
      </label>
      <select
        id={id}
        value={reason}
        aria-invalid={missing ? true : undefined}
        onChange={(e) => {
          setReason(VISIT_FEE_WAIVE_REASONS.find((x) => x === e.target.value) ?? '');
          setMissing(false);
        }}
        className={portalField}
      >
        <option value="">{h('waiveChoose')}</option>
        {VISIT_FEE_WAIVE_REASONS.map((x) => (
          <option key={x} value={x}>
            {h(`feeWaivedReason_${x}`)}
          </option>
        ))}
      </select>
      {missing ? <p className="text-xs font-bold text-error">{h('waiveRequired')}</p> : null}
      {error ? <ServiceApiError code={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void waive()}
          className={`${portalPrimary} flex-1`}
        >
          {h('waiveAction')}
        </button>
        <button
          data-panel-cancel={`waive-${detail.code}`}
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {h('moveDecline')}
        </button>
      </div>
    </div>
  );
}

type SettingsLoad =
  { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; list: HomeSettingsList['workshops'] };

/** The workshop's own home servicing settings (owners only: the API answers 403 to staff, who then see nothing). */
export function HomeSettingsApi() {
  const h = useTranslations('homeService');
  const locale = useLocale();
  const [load, setLoad] = useState<SettingsLoad>({ kind: 'loading' });
  const reload = useCallback(async () => {
    const res = await adminApi(locale, '/workshop/home-settings', HomeSettingsListDto);
    setLoad(res.ok ? { kind: 'ok', list: res.data.workshops } : { kind: 'error', code: res.code });
  }, [locale]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // A workshop staff member (no menu permission) simply has no settings card: calm, not an error.
  if (load.kind === 'loading' || (load.kind === 'error' && load.code === 'FORBIDDEN')) return null;
  if (load.kind === 'error')
    return (
      <section className={portalCard}>
        <ServiceApiError code={load.code} />
      </section>
    );
  if (load.list.length === 0) return null;
  return (
    <section aria-labelledby="home-settings-title" className="space-y-3">
      <div>
        <h2 id="home-settings-title" className="font-heading text-xl font-extrabold text-ink">
          {h('settingsTitle')}
        </h2>
        <p className="text-sm text-muted">{h('settingsIntro')}</p>
      </div>
      <ul className="grid gap-3 nav:grid-cols-2">
        {load.list.map((w) => (
          <li key={`${w.workshopId}-${String(w.version)}`}>
            <HomeSettingsCard workshop={w} onSaved={reload} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HomeSettingsCard({
  workshop: w,
  onSaved,
}: {
  workshop: HomeSettingsList['workshops'][number];
  onSaved: () => Promise<void>;
}) {
  const h = useTranslations('homeService');
  const locale = useLocale();
  const [on, setOn] = useState(w.homeService);
  const [keys, setKeys] = useState<string[]>(w.services.filter((s) => s.homeAvailable).map((s) => s.key));
  const [field, setField] = useState<'radius' | 'fee' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved'>('idle');
  const id = (k: string) => `home-${w.workshopId}-${k}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v : '';
    };
    const parsed = parseHomeSettingsInput(
      { radiusKm: text('radius'), feeRupees: text('fee') },
      w.maxFeePaise,
    );
    if (!parsed.ok) {
      setField(parsed.field);
      document.getElementById(id(parsed.field))?.focus();
      return;
    }
    setField(null);
    setError(null);
    setStatus('busy');
    const res = await adminApi(locale, `/workshop/home-settings/${w.workshopId}`, HomeSettingsSavedDto, {
      method: 'PUT',
      body: {
        homeService: on,
        homeRadiusKm: parsed.radiusKm,
        homeVisitFeePaise: parsed.feePaise,
        homeServiceKeys: keys,
        version: w.version,
      },
    });
    if (!res.ok) {
      setStatus('idle');
      setError(res.code);
      if (res.code === 'STALE_WORKSHOP') await onSaved();
      return;
    }
    setStatus('saved');
    track('click', { id: 'workshop_home_settings_saved', path: window.location.pathname });
    await onSaved();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      aria-busy={status === 'busy' || undefined}
      className={`${portalCard} space-y-3`}
    >
      <h3 className="font-heading text-lg font-extrabold text-ink">{w.name}</h3>
      <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setStatus('idle');
          }}
          className="size-6 shrink-0 accent-[var(--color-accent-button)]"
        />
        {h('settingsOn')}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('radius')} className="text-xs font-bold text-muted">
            {h('radiusLabel')}
          </label>
          <input
            id={id('radius')}
            name="radius"
            inputMode="numeric"
            maxLength={2}
            defaultValue={String(w.homeRadiusKm)}
            aria-invalid={field === 'radius' ? true : undefined}
            aria-describedby={field === 'radius' ? id('radius-error') : undefined}
            className={portalField}
          />
          {field === 'radius' ? (
            <p id={id('radius-error')} className="mt-1 text-xs font-bold text-error">
              {h('errRadius')}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={id('fee')} className="text-xs font-bold text-muted">
            {h('feeLabel')}
          </label>
          <input
            id={id('fee')}
            name="fee"
            inputMode="decimal"
            maxLength={7}
            defaultValue={String(w.homeVisitFeePaise / 100)}
            aria-invalid={field === 'fee' ? true : undefined}
            aria-describedby={id('fee-hint')}
            className={portalField}
          />
          <p
            id={id('fee-hint')}
            className={`mt-1 text-xs ${field === 'fee' ? 'font-bold text-error' : 'text-muted'}`}
          >
            {field === 'fee' ? `${h('errFee')} ` : ''}
            {h('feeMax', { max: formatPrice(w.maxFeePaise) })}
          </p>
        </div>
      </div>
      <fieldset>
        <legend className="text-xs font-bold text-muted">{h('servicesLabel')}</legend>
        {w.services.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{h('noServices')}</p>
        ) : (
          <ul className="mt-1 grid gap-1">
            {w.services.map((s) => (
              <li key={s.key}>
                <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={keys.includes(s.key)}
                    onChange={(e) => {
                      setKeys((k) => (e.target.checked ? [...k, s.key] : k.filter((x) => x !== s.key)));
                      setStatus('idle');
                    }}
                    className="size-6 shrink-0 accent-[var(--color-accent-button)]"
                  />
                  {locale === 'hi' && s.titleHi ? s.titleHi : s.title}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {error ? <ServiceApiError code={error} /> : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={status === 'busy'} className={portalPrimary}>
          {status === 'busy' ? h('saving') : h('save')}
        </button>
        {status === 'saved' ? (
          <p role="status" className="text-sm font-bold text-success">
            {h('saved')}
          </p>
        ) : null}
      </div>
    </form>
  );
}
