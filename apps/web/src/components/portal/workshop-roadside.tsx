'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  RSA_BILL_LINE_KINDS,
  RSA_DECLINE_REASONS,
  RSA_PROBLEM_TYPES,
  type RsaBillLineKind,
  type RsaDeclineReason,
  type RsaProblemType,
} from '@mechdost/shared/rsa';
import { VEHICLE_TYPES, type VehicleType } from '@mechdost/shared/vehicles';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { demoJobs, demoOffers, demoStep, useDemoRoadside } from '@/demo/roadside';
import { AUTH_MODE } from '@/lib/auth/mode';
import { formatPrice } from '@/lib/format';
import {
  roadsideCall,
  roadsideErrorKey,
  type RoadsideJob,
  type RoadsideOffer,
  type RoadsideOptIn,
  type RoadsideWorkshopOverview,
} from '@/lib/roadside';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

const POLL_MS = 10_000;
/** The browser demo (no real sign-in) uses the sample store; real sign-in reads the API (like the portal around it). */
const DEMO = AUTH_MODE !== 'firebase';

/**
 * Roadside in the workshop portal (spec 22, spec 07): opt in (radius, vehicle types, problem types, towing), answer
 * offers before the timer runs out, and run the job: on my way, the customer's arrival code, start, the bill lines,
 * and "paid in cash". The customer's phone is never shown (calls go through MechDost support at launch).
 */
export function WorkshopRoadside() {
  const t = useTranslations('roadside');
  const locale = useLocale();
  const demo = useDemoRoadside();
  const [data, setData] = useState<RoadsideWorkshopOverview>({ offers: [], jobs: [], optIns: [] });
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (DEMO) return;
    const res = await roadsideCall<RoadsideWorkshopOverview>(locale, '/workshop/roadside');
    if (res.ok) setData(res.data);
    else setMsg(roadsideErrorKey(res.code));
  }, [locale]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);
  const offers = DEMO ? demoOffers(demo) : data.offers;
  const jobs = DEMO ? demoJobs(demo) : data.jobs;
  const act = async (
    code: string,
    path: string,
    body: unknown,
    demoAction: Parameters<typeof demoStep>[0],
  ) => {
    setMsg(null);
    if (DEMO) {
      if (!demoStep(demoAction)) setMsg(path === 'arrive' ? 'err_ARRIVAL_CODE_WRONG' : 'err_WRONG_STEP');
      return;
    }
    const res = await roadsideCall(locale, `/workshop/roadside/requests/${code}/${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
    if (!res.ok) setMsg(roadsideErrorKey(res.code));
    await load();
  };
  return (
    <section className={`${portalCard} space-y-5`} aria-labelledby="rsa-ws">
      <h2 id="rsa-ws" className="font-heading text-lg font-extrabold text-ink">
        {t('ws_title')}
      </h2>
      {msg ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(msg as 'err_generic')}
        </p>
      ) : null}
      <div>
        <h3 className="font-bold">{t('ws_offers')}</h3>
        {offers.length === 0 ? <p className="mt-1 text-sm text-muted">{t('ws_noOffers')}</p> : null}
        <ul className="mt-2 space-y-3" aria-live="polite">
          {offers.map((o) => (
            <Offer key={o.code} o={o} act={act} />
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-bold">{t('ws_jobs')}</h3>
        {jobs.length === 0 ? <p className="mt-1 text-sm text-muted">{t('ws_noJobs')}</p> : null}
        <ul className="mt-2 space-y-3">
          {jobs.map((j) => (
            <Job key={j.code} j={j} act={act} />
          ))}
        </ul>
      </div>
      {!DEMO ? (
        data.optIns.map((o) => <OptIn key={o.workshopId} o={o} onSaved={() => void load()} />)
      ) : (
        <p className="text-sm text-muted">{t('ws_optInDemo')}</p>
      )}
    </section>
  );
}

type Act = (
  code: string,
  path: string,
  body: unknown,
  demoAction: Parameters<typeof demoStep>[0],
) => Promise<void>;

function Offer({ o, act }: { o: RoadsideOffer; act: Act }) {
  const t = useTranslations('roadside');
  const [reason, setReason] = useState<RsaDeclineReason>('busy');
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.round((new Date(o.expiresAt).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setLeft(Math.max(0, Math.round((new Date(o.expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [o.expiresAt]);
  return (
    <li className="rounded-card border border-line-card p-4">
      <p className="font-bold">{o.code}</p>
      <p className="text-sm text-muted">
        {o.vehicleType} · {o.pincode} ·{' '}
        {o.problemType ? t(`problem_${o.problemType}` as 'problem_unknown') : t('problem_skipped')}
        {o.distanceM !== null ? ` · ${(o.distanceM / 1000).toFixed(1)} ${t('km')}` : ''}
      </p>
      <p className="mt-1 text-sm" role="timer">
        {t('ws_timeLeft', { seconds: left })}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className={portalPrimary}
          disabled={left === 0}
          onClick={() => void act(o.code, 'accept', undefined, { kind: 'accept' })}
        >
          {t('ws_accept')}
        </button>
        <select
          aria-label={t('ws_declineReason')}
          className={`${portalField} !mt-0 !w-auto`}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as RsaDeclineReason);
          }}
        >
          {RSA_DECLINE_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`decline_${r}` as 'decline_busy')}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={portalQuiet}
          onClick={() => void act(o.code, 'decline', { reasonCode: reason }, { kind: 'decline' })}
        >
          {t('ws_decline')}
        </button>
      </div>
    </li>
  );
}

interface DraftLine {
  kind: RsaBillLineKind;
  description: string;
  quantity: string;
  rupees: string;
}

function Job({ j, act }: { j: RoadsideJob; act: Act }) {
  const t = useTranslations('roadside');
  const [code, setCode] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { kind: 'labour', description: '', quantity: '1', rupees: '' },
  ]);
  const parsed = lines.map((l) => ({
    kind: l.kind,
    description: l.description.trim(),
    quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
    unitPricePaise: Math.round((Number(l.rupees) || 0) * 100),
  }));
  const valid =
    parsed.length > 0 &&
    parsed.every((l) => l.description !== '') &&
    parsed.reduce((n, l) => n + l.quantity * l.unitPricePaise, 0) > 0;
  const total = parsed.reduce((n, l) => n + l.quantity * l.unitPricePaise, 0);
  const post = (
    path: string,
    demoAction: Parameters<typeof demoStep>[0],
    body: Record<string, unknown> = {},
  ) => act(j.code, path, { expectedVersion: j.version, ...body }, demoAction);
  const submitBill = (e: SyntheticEvent) => {
    e.preventDefault();
    if (valid) void post('bill', { kind: 'bill', lines: parsed }, { lines: parsed });
  };
  return (
    <li className="rounded-card border border-line-card p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-bold">{j.code}</p>
        <p className="text-sm text-muted">{t(`status_${j.status}` as 'status_requested')}</p>
      </div>
      <p className="text-sm text-muted">
        {j.vehicleType} · {j.pincode} ·{' '}
        {j.problemType ? t(`problem_${j.problemType}` as 'problem_unknown') : t('problem_skipped')}
      </p>
      <a
        className="mt-1 inline-block text-sm font-bold underline"
        href={`https://www.openstreetmap.org/?mlat=${String(j.lat)}&mlon=${String(j.lng)}#map=17/${String(j.lat)}/${String(j.lng)}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('ws_openMap')}
      </a>
      <div className="mt-3 space-y-3">
        {j.status === 'accepted' ? (
          <button
            type="button"
            className={portalQuiet}
            onClick={() => void post('en-route', { kind: 'en_route' })}
          >
            {t('ws_enRoute')}
          </button>
        ) : null}
        {j.status === 'accepted' || j.status === 'en_route' ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void post('arrive', { kind: 'arrive', code }, { arrivalCode: code });
            }}
          >
            <label className="text-sm font-bold">
              {t('ws_arrivalCode')}
              <input
                className={`${portalField} !w-28`}
                inputMode="numeric"
                maxLength={4}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                }}
              />
            </label>
            <button type="submit" className={portalPrimary} disabled={code.length !== 4}>
              {t('ws_arrived')}
            </button>
          </form>
        ) : null}
        {j.status === 'arrived' ? (
          <button
            type="button"
            className={portalPrimary}
            onClick={() => void post('start', { kind: 'start' })}
          >
            {t('ws_start')}
          </button>
        ) : null}
        {j.status === 'in_progress' ? (
          <form onSubmit={submitBill} className="space-y-2">
            <h4 className="text-sm font-bold">{t('ws_billTitle')}</h4>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_4rem_6rem] gap-2">
                <select
                  aria-label={t('ws_lineKind')}
                  className={`${portalField} col-span-3`}
                  value={l.kind}
                  onChange={(e) => {
                    setLines(
                      lines.map((x, k) => (k === i ? { ...x, kind: e.target.value as RsaBillLineKind } : x)),
                    );
                  }}
                >
                  {RSA_BILL_LINE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kind_${k}` as 'kind_labour')}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('ws_lineDescription')}
                  className={portalField}
                  value={l.description}
                  placeholder={t('ws_lineDescription')}
                  onChange={(e) => {
                    setLines(lines.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)));
                  }}
                />
                <input
                  aria-label={t('ws_lineQty')}
                  className={portalField}
                  inputMode="numeric"
                  value={l.quantity}
                  onChange={(e) => {
                    setLines(lines.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)));
                  }}
                />
                <input
                  aria-label={t('ws_linePrice')}
                  className={portalField}
                  inputMode="decimal"
                  value={l.rupees}
                  onChange={(e) => {
                    setLines(lines.map((x, k) => (k === i ? { ...x, rupees: e.target.value } : x)));
                  }}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={portalQuiet}
                disabled={lines.length >= 20}
                onClick={() => {
                  setLines([
                    ...lines,
                    { kind: RSA_BILL_LINE_KINDS[1], description: '', quantity: '1', rupees: '' },
                  ]);
                }}
              >
                {t('ws_addLine')}
              </button>
              <p className="text-sm">
                {t('ws_billTotal', {
                  total: formatPrice(total),
                  balance: formatPrice(Math.max(total - j.advancePaise, 0)),
                })}
              </p>
              <button type="submit" className={portalPrimary} disabled={!valid}>
                {t('ws_sendBill')}
              </button>
            </div>
          </form>
        ) : null}
        {j.status === 'billed' && (j.balancePaise ?? 0) > 0 ? (
          <button type="button" className={portalQuiet} onClick={() => void post('cash', { kind: 'cash' })}>
            {t('ws_cash', { amount: formatPrice(j.balancePaise ?? 0) })}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function OptIn({ o, onSaved }: { o: RoadsideOptIn; onSaved: () => void }) {
  const t = useTranslations('roadside');
  const locale = useLocale();
  const [s, setS] = useState(o);
  const [msg, setMsg] = useState<{ ok: boolean; key: string } | null>(null);
  const toggle = <K extends 'vehicleTypes' | 'problemTypes'>(
    key: K,
    value: K extends 'vehicleTypes' ? VehicleType : RsaProblemType,
  ) => {
    setS((cur) => {
      const list = cur[key] as readonly string[];
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
      return { ...cur, [key]: next };
    });
  };
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    const res = await roadsideCall<{ version: number }>(locale, `/workshop/roadside/opt-in/${s.workshopId}`, {
      method: 'PUT',
      body: {
        enabled: s.enabled,
        radiusKm: s.radiusKm,
        vehicleTypes: s.vehicleTypes,
        problemTypes: s.problemTypes,
        towing: s.towing,
        version: s.version,
      },
    });
    if (res.ok) {
      setS({ ...s, version: res.data.version });
      setMsg({ ok: true, key: 'ws_saved' });
      onSaved();
    } else setMsg({ ok: false, key: roadsideErrorKey(res.code) });
  };
  return (
    <form
      onSubmit={(e) => void save(e)}
      className="space-y-3 border-t border-line-card pt-4"
      aria-label={t('ws_optIn')}
    >
      <h3 className="font-bold">
        {t('ws_optIn')} · {locale === 'hi' && o.nameHi ? o.nameHi : o.name}
      </h3>
      <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => {
            setS({ ...s, enabled: e.target.checked });
          }}
        />
        {t('ws_takeRoadside')}
      </label>
      <label className="block text-sm font-bold">
        {t('ws_radius')}
        <input
          className={`${portalField} !w-28`}
          inputMode="numeric"
          value={String(s.radiusKm)}
          onChange={(e) => {
            setS({ ...s, radiusKm: Number(e.target.value || 0) });
          }}
        />
      </label>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="text-sm font-bold">{t('vehicleTitle')}</legend>
        {VEHICLE_TYPES.map((vt) => (
          <label key={vt} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.vehicleTypes.includes(vt)}
              onChange={() => {
                toggle('vehicleTypes', vt);
              }}
            />
            {vt}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="text-sm font-bold">{t('ws_problems')}</legend>
        {RSA_PROBLEM_TYPES.filter((p) => p !== 'needs_towing').map((p) => (
          <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.problemTypes.includes(p)}
              onChange={() => {
                toggle('problemTypes', p);
              }}
            />
            {t(`problem_${p}` as 'problem_unknown')}
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={s.towing}
          onChange={(e) => {
            setS({ ...s, towing: e.target.checked });
          }}
        />
        {t('ws_towing')}
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={portalPrimary}>
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
