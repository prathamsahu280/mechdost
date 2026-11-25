'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  RSA_CANCEL_REASONS,
  RSA_PROBLEM_TYPES,
  RSA_ROUTING_MODES,
  defaultRsaSettings,
  type RsaCancelReason,
  type RsaProblemType,
  type RsaSettings,
} from '@mechdost/shared/rsa';
import { VEHICLE_TYPES, type VehicleType } from '@mechdost/shared/vehicles';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { DEMO_SUGGESTIONS, demoQueue, demoStep, useDemoRoadside } from '@/demo/roadside';
import { AUTH_MODE } from '@/lib/auth/mode';
import { formatPrice } from '@/lib/format';
import {
  roadsideCall,
  roadsideErrorKey,
  type RoadsideQueueItem,
  type RoadsideSuggestion,
} from '@/lib/roadside';
import { CityPicker } from './admin-city-picker';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

const POLL_MS = 15_000;
/** The browser demo (no real sign-in) uses the sample store; real sign-in reads the API (like the sibling admin sections). */
const DEMO = AUTH_MODE !== 'firebase';
const minutesToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMinutes = (v: string) => {
  const [h = '0', m = '0'] = v.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Admin → Roadside (spec 22, spec 08): "Needs dispatch" with ranked workshops and one-click offers, cancel for a
 * request nobody accepted (the advance is refunded through the refund queue), and the per-city settings: area,
 * hours, vehicle types, advance per type, accept timer, routing mode, problem types, SOS phone. All audited by the API.
 */
export function AdminRoadside() {
  const t = useTranslations('roadside');
  const [tab, setTab] = useState<'queue' | 'settings'>('queue');
  const [city, setCity] = useState('');
  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('adminTitle')} className="flex gap-2">
        {(['queue', 'settings'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            className={tab === k ? portalPrimary : portalQuiet}
            onClick={() => {
              setTab(k);
            }}
          >
            {t(`admin_${k}` as 'admin_queue')}
          </button>
        ))}
      </div>
      {tab === 'queue' ? (
        <Queue />
      ) : (
        <>
          {DEMO ? null : <CityPicker id="rsa-city" value={city} onChange={setCity} />}
          <Settings city={city} />
        </>
      )}
    </div>
  );
}

function Queue() {
  const t = useTranslations('roadside');
  const locale = useLocale();
  const demo = useDemoRoadside();
  const [items, setItems] = useState<RoadsideQueueItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (DEMO) return;
    const res = await roadsideCall<RoadsideQueueItem[]>(locale, '/admin/roadside/queue?view=needs_dispatch');
    if (res.ok) setItems(res.data);
    else setError(res.code);
  }, [locale]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);
  const rows = DEMO
    ? demoQueue(demo).filter((r) => r.status === 'requested' || r.status === 'offered')
    : items;
  return (
    <section className={adminCard} aria-labelledby="rsa-queue">
      <h2 id="rsa-queue" className="font-heading text-lg font-extrabold text-ink">
        {t('admin_queue')}
      </h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-error">
          {t(roadsideErrorKey(error) as 'err_generic')}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">{t('admin_queueEmpty')}</p> : null}
      <p role="status" className="sr-only">
        {t('admin_queueCount', { count: rows.length })}
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.code} className="rounded-card border border-line-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{r.code}</p>
              <p className="text-sm text-muted">
                {t(`status_${r.status}` as 'status_requested')}
                {r.disputed ? ` · ${t('admin_disputed')}` : ''}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted">
              {r.vehicleType} · {r.pincode} ·{' '}
              {r.problemType ? t(`problem_${r.problemType}` as 'problem_unknown') : t('problem_skipped')} ·{' '}
              {t('waiting', { minutes: Math.floor(r.waitingSeconds / 60) })}
            </p>
            {r.status === 'offered' ? (
              <p className="mt-1 text-sm">{t('offeredTo', { name: r.workshopName ?? '' })}</p>
            ) : null}
            <button
              type="button"
              className={`${portalQuiet} mt-3`}
              aria-expanded={open === r.code}
              onClick={() => {
                setOpen(open === r.code ? null : r.code);
              }}
            >
              {t('admin_manage')}
            </button>
            {open === r.code ? <Dispatch item={r} onDone={() => void load()} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Dispatch({ item, onDone }: { item: RoadsideQueueItem; onDone: () => void }) {
  const t = useTranslations('roadside');
  const locale = useLocale();
  const [list, setList] = useState<RoadsideSuggestion[]>(DEMO ? [...DEMO_SUGGESTIONS] : []);
  const [reason, setReason] = useState<RsaCancelReason>('no_responder_accepted');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (DEMO || item.status !== 'requested') return;
    void roadsideCall<RoadsideSuggestion[]>(locale, `/admin/roadside/requests/${item.code}/suggestions`).then(
      (r) => {
        if (r.ok) setList(r.data);
      },
    );
  }, [item.code, item.status, locale]);
  const run = async (path: string, body: unknown, demoAction: Parameters<typeof demoStep>[0]) => {
    setBusy(true);
    setMsg(null);
    if (DEMO) demoStep(demoAction);
    else {
      const res = await roadsideCall(locale, `/admin/roadside/requests/${item.code}/${path}`, {
        method: 'POST',
        body,
      });
      if (!res.ok) setMsg(roadsideErrorKey(res.code));
    }
    setBusy(false);
    onDone();
  };
  return (
    <div className="mt-3 space-y-3">
      {item.status === 'requested' ? (
        <>
          <h3 className="text-sm font-bold">{t('admin_suggestions')}</h3>
          {list.length === 0 ? <p className="text-sm text-muted">{t('admin_noSuggestions')}</p> : null}
          <ul className="space-y-2">
            {list.map((w) => (
              <li key={w.workshopId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {locale === 'hi' && w.nameHi ? w.nameHi : w.name} · {(w.distanceM / 1000).toFixed(1)}{' '}
                  {t('km')} · {Math.round(w.acceptRate * 100)}%
                </span>
                <button
                  type="button"
                  className={portalPrimary}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      'offer',
                      { workshopId: w.workshopId, expectedVersion: item.version },
                      { kind: 'offer' },
                    )
                  }
                >
                  {t('admin_sendOffer')}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <button
          type="button"
          className={portalQuiet}
          disabled={busy}
          onClick={() => void run('withdraw', { expectedVersion: item.version }, { kind: 'decline' })}
        >
          {t('admin_withdraw')}
        </button>
      )}
      <div className="flex flex-wrap items-end gap-3 border-t border-line-card pt-3">
        <label className="text-sm font-bold">
          {t('admin_cancelReason')}
          <select
            className={portalField}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as RsaCancelReason);
            }}
          >
            {RSA_CANCEL_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`cancel_${r}` as 'cancel_other')}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={portalQuiet}
          disabled={busy}
          onClick={() => {
            void run(
              'cancel',
              { reasonCode: reason, expectedVersion: item.version },
              { kind: 'cancel', reason },
            );
          }}
        >
          {t('admin_cancel')}
        </button>
      </div>
      <p className="text-sm text-muted">{t('admin_cancelNote')}</p>
      {msg ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(msg as 'err_generic')}
        </p>
      ) : null}
    </div>
  );
}

function Settings({ city }: { city: string }) {
  const t = useTranslations('roadside');
  const locale = useLocale();
  const [s, setS] = useState<RsaSettings>(defaultRsaSettings());
  const [pins, setPins] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (DEMO || !city) return;
    setLoadError(null);
    void roadsideCall<RsaSettings>(locale, `/admin/roadside/settings?city=${city}`).then((r) => {
      if (r.ok) {
        setS(r.data);
        setPins(r.data.pincodes.join(', '));
      } else setLoadError(roadsideErrorKey(r.code));
    });
  }, [locale, city]);
  const toggleType = (vt: VehicleType) => {
    setS((cur) => {
      const on = cur.vehicleTypes.includes(vt);
      const vehicleTypes = on ? cur.vehicleTypes.filter((x) => x !== vt) : [...cur.vehicleTypes, vt];
      const kept = Object.entries(cur.advancePaise).filter(([k]) => k !== vt);
      const advancePaise: RsaSettings['advancePaise'] = Object.fromEntries(
        on ? kept : [...kept, [vt, 50_000]],
      );
      return { ...cur, vehicleTypes, advancePaise };
    });
  };
  const toggleProblem = (p: RsaProblemType) => {
    setS((cur) => ({
      ...cur,
      problemTypes: cur.problemTypes.includes(p)
        ? cur.problemTypes.filter((x) => x !== p)
        : [...cur.problemTypes, p],
    }));
  };
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (DEMO) {
      setMsg({ ok: true, key: 'admin_savedDemo' });
      return;
    }
    setBusy(true);
    const body = { ...s, pincodes: pins.split(/[\s,]+/).filter(Boolean) };
    const res = await roadsideCall<RsaSettings>(locale, `/admin/roadside/settings?city=${city}`, {
      method: 'PUT',
      body,
    });
    if (res.ok) {
      setS(res.data);
      setMsg({ ok: true, key: 'admin_saved' });
    } else setMsg({ ok: false, key: roadsideErrorKey(res.code) });
    setBusy(false);
  };
  if (!DEMO && !city) return <p className="text-sm text-muted">{t('admin_chooseCity')}</p>;
  if (loadError)
    return (
      <p role="alert" className="text-sm font-bold text-error">
        {t(loadError as 'err_generic')}
      </p>
    );
  return (
    <form onSubmit={(e) => void save(e)} className={`${adminCard} space-y-4`} aria-labelledby="rsa-settings">
      <h2 id="rsa-settings" className="font-heading text-lg font-extrabold text-ink">
        {t('admin_settings')}
      </h2>
      <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => {
            setS({ ...s, enabled: e.target.checked });
          }}
        />
        {t('set_enabled')}
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t('set_vehicleTypes')}</legend>
        {VEHICLE_TYPES.map((vt) => (
          <div key={vt} className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.vehicleTypes.includes(vt)}
                onChange={() => {
                  toggleType(vt);
                }}
              />
              {vt}
            </label>
            {s.vehicleTypes.includes(vt) ? (
              <label className="text-sm">
                {t('set_advance')}
                <input
                  className={`${portalField} !mt-0 ml-2 !w-28`}
                  inputMode="numeric"
                  value={String((s.advancePaise[vt] ?? 0) / 100)}
                  onChange={(e) => {
                    setS({
                      ...s,
                      advancePaise: {
                        ...s.advancePaise,
                        [vt]: Math.round(Number(e.target.value || 0) * 100),
                      },
                    });
                  }}
                />{' '}
                <span className="text-muted">{formatPrice(s.advancePaise[vt] ?? 0)}</span>
              </label>
            ) : null}
          </div>
        ))}
      </fieldset>
      <label className="block text-sm font-bold">
        {t('set_pincodes')}
        <textarea
          className={portalField}
          rows={2}
          value={pins}
          onChange={(e) => {
            setPins(e.target.value);
          }}
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t('set_hours')}</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={s.alwaysOpen}
            onChange={(e) => {
              setS({ ...s, alwaysOpen: e.target.checked });
            }}
          />
          {t('set_alwaysOpen')}
        </label>
        {s.alwaysOpen ? null : (
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              {t('set_opens')}
              <input
                type="time"
                className={portalField}
                value={minutesToTime(s.opensAtMinute)}
                onChange={(e) => {
                  setS({ ...s, opensAtMinute: timeToMinutes(e.target.value) });
                }}
              />
            </label>
            <label className="text-sm">
              {t('set_closes')}
              <input
                type="time"
                className={portalField}
                value={minutesToTime(s.closesAtMinute)}
                onChange={(e) => {
                  setS({ ...s, closesAtMinute: timeToMinutes(e.target.value) });
                }}
              />
            </label>
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm font-bold">
          {t('set_routing')}
          <select
            className={portalField}
            value={s.routingMode}
            onChange={(e) => {
              setS({ ...s, routingMode: e.target.value as RsaSettings['routingMode'] });
            }}
          >
            {RSA_ROUTING_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`routing_${m}` as 'routing_manual')}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-bold">
          {t('set_maxBill')}
          <input
            className={portalField}
            inputMode="numeric"
            value={String(s.maxBillPaise / 100)}
            onChange={(e) => {
              setS({ ...s, maxBillPaise: Math.round(Number(e.target.value || 0) * 100) });
            }}
          />
        </label>
        <label className="text-sm font-bold">
          {t('set_timer')}
          <input
            className={portalField}
            inputMode="numeric"
            value={String(s.acceptTimerSeconds)}
            onChange={(e) => {
              setS({ ...s, acceptTimerSeconds: Number(e.target.value || 0) });
            }}
          />
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
        <input
          type="checkbox"
          checked={s.billDisputeEnabled}
          onChange={(e) => {
            setS({ ...s, billDisputeEnabled: e.target.checked });
          }}
        />
        {t('set_billDispute')}
      </label>
      <p className="text-sm text-muted">{t('set_routingNote')}</p>
      <fieldset className="space-y-1">
        <legend className="text-sm font-bold">{t('set_problems')}</legend>
        {RSA_PROBLEM_TYPES.map((p) => (
          <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.problemTypes.includes(p)}
              onChange={() => {
                toggleProblem(p);
              }}
            />
            {t(`problem_${p}` as 'problem_unknown')}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm font-bold">
        {t('set_sos')}
        <input
          className={portalField}
          inputMode="tel"
          placeholder="+917978776551"
          value={s.sosPhone ?? ''}
          onChange={(e) => {
            setS({ ...s, sosPhone: e.target.value.trim() === '' ? null : e.target.value.trim() });
          }}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={portalPrimary} disabled={busy}>
          {t('set_save')}
        </button>
        {msg ? (
          <p
            role={msg.ok ? 'status' : 'alert'}
            className={`text-sm font-bold ${msg.ok ? 'text-success' : 'text-error'}`}
          >
            {t(msg.key as 'err_generic')}
          </p>
        ) : null}
      </div>
    </form>
  );
}
