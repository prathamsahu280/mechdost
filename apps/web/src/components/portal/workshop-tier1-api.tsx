'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  WorkshopChangeFiledDto,
  WorkshopProfilesDto,
  WorkshopProfileSavedDto,
  WorkshopSlotsDto,
  type WorkshopProfiles,
} from '@mechdost/shared/service-api';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { hourHasStarted, rupeesToPaise } from '@/lib/service-views';
import { hourChip } from '@/lib/workshop-portal-view';
import { Tier1Error } from '../workshops/tier1-error';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

type Profile = WorkshopProfiles['workshops'][number];
type TextField = 'name' | 'nameHi' | 'addressLine' | 'addressLineHi' | 'area' | 'areaHi' | 'phone';

/**
 * The hour of a proposal (spec 06): the workshop's open hours for the chosen date with how many places are free; a full
 * hour is shown and cannot be picked. Reads `GET /workshop/slots`; the choice is the form field `hour`.
 */
export function HourPickerApi({
  workshopId,
  date,
  id,
  invalid,
  describedBy,
}: {
  workshopId: string | null;
  date: string;
  id: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('workshopTier1');
  const pw = useTranslations('partnerWorkshop');
  const locale = useLocale();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; code: string }
    | { kind: 'ready'; slots: { hour: number; free: number }[] }
  >({ kind: 'loading' });

  useEffect(() => {
    if (!workshopId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let live = true;
    void adminApi(
      locale,
      `/workshop/slots?workshopId=${encodeURIComponent(workshopId)}&date=${date}`,
      WorkshopSlotsDto,
    ).then((res) => {
      if (!live) return;
      setState(res.ok ? { kind: 'ready', slots: res.data.slots } : { kind: 'error', code: res.code });
    });
    return () => {
      live = false;
      setState({ kind: 'loading' });
    };
  }, [locale, workshopId, date]);

  // Hours that already started today (IST) are left out: the server refuses them (SLOT_PAST, QA 2026-11-16 bug 5).
  const now = new Date();
  const slots = state.kind === 'ready' ? state.slots.filter((s) => !hourHasStarted(date, s.hour, now)) : [];

  return (
    // Hour chips (partner portals UI upgrade, design 2026-11-27 § 6.2): radio buttons named `hour` (the form reads
    // FormData as before), 48 px, each with its free places in words; a full hour is shown and cannot be picked.
    <fieldset
      id={id}
      tabIndex={-1}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      className="col-span-2 min-w-0"
    >
      <legend className="text-xs font-bold text-muted">{t('hourLabel')}</legend>
      {state.kind === 'loading' ? <p className="mt-1 text-xs text-muted">{t('hoursLoading')}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">
        {slots.map((s) => {
          const chip = hourChip(s);
          return (
            <label
              key={s.hour}
              className={`flex min-h-12 min-w-20 flex-col items-center justify-center rounded-button border px-3 text-center leading-tight ${
                chip.full
                  ? 'cursor-not-allowed border-line-card bg-pill text-muted'
                  : `cursor-pointer border-line-card bg-surface text-ink has-[:checked]:border-accent-button has-[:checked]:bg-accent-soft has-[:checked]:text-accent-soft-text has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${invalid ? 'border-error' : ''}`
              }`}
            >
              <input type="radio" name="hour" value={s.hour} disabled={chip.full} className="sr-only" />
              <span className="text-sm font-extrabold tabular-nums">{chip.time}</span>
              <span className="text-xs">
                {chip.full ? pw('hour_full') : pw('hour_free', { n: chip.free })}
              </span>
            </label>
          );
        })}
      </div>
      {state.kind === 'ready' && slots.length === 0 ? (
        <p className="mt-1 text-xs font-bold text-error">{t('noHours')}</p>
      ) : null}
      {state.kind === 'error' ? <Tier1Error code={state.code} /> : null}
    </fieldset>
  );
}

const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * "My workshop" (spec 07, workshops tier 1): the owner's own listing. Text in both languages, opening hours, how many
 * vehicles one hour takes, busy mode and the menu's price ranges are saved together and go live at once (audited by
 * the API). The pin and the GSTIN are separate requests that MechDost checks first. Loaded lazily by the portal.
 */
export function MyWorkshopApi() {
  const t = useTranslations('workshopTier1');
  const locale = useLocale();
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/workshop/profile', WorkshopProfilesDto);
    if (res.ok) {
      setRows(res.data.workshops);
      setError(null);
    } else setError(res.code);
  }, [locale]);
  useEffect(() => {
    void load();
    track('workshop_profile_viewed', {});
  }, [load]);

  if (error && !rows) return <Tier1Error code={error} />;
  if (!rows) return <p className="text-sm text-muted">{t('loading')}</p>;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="my-workshop" className="space-y-4">
      <div>
        <h2 id="my-workshop" className="font-heading text-xl font-extrabold text-ink">
          {t('myTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('myIntro')}</p>
      </div>
      {rows.map((w) => (
        <WorkshopEditor key={`${w.workshopId}-${String(w.version)}`} w={w} onSaved={load} />
      ))}
    </section>
  );
}

function WorkshopEditor({ w, onSaved }: { w: Profile; onSaved: () => Promise<void> }) {
  const t = useTranslations('workshopTier1');
  const pw = useTranslations('partnerWorkshop');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const id = (k: string) => `${w.workshopId}-${k}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const open = text('open');
    const close = text('close');
    const days = WEEK.filter((d) => data.get(`day${String(d)}`) === 'on');
    const capacity = Number(text('capacity'));
    const menu = [];
    for (const m of w.menu) {
      const low = rupeesToPaise(text(`low-${m.key}`));
      const high = rupeesToPaise(text(`high-${m.key}`));
      if (low === null || high === null || high < low) {
        setInvalid(`low-${m.key}`);
        document.getElementById(id(`low-${m.key}`))?.focus();
        return;
      }
      menu.push({
        key: m.key,
        title: m.title,
        titleHi: m.titleHi,
        included: m.included,
        includedHi: m.includedHi,
        lowPaise: low,
        highPaise: high,
        minMinutes: m.minMinutes,
        maxMinutes: m.maxMinutes,
        vehicleType: m.vehicleType,
        active: data.get(`on-${m.key}`) === 'on',
        homeAvailable: m.homeAvailable,
      });
    }
    const badName = text('name').length < 2 || (text('nameHi') !== '' && text('nameHi').length < 2);
    if (
      badName ||
      !/^\d{2}:\d{2}$/.test(open) ||
      !/^\d{2}:\d{2}$/.test(close) ||
      open >= close ||
      days.length === 0 ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 20
    ) {
      setInvalid(badName ? 'name' : 'open');
      document.getElementById(id(badName ? 'name' : 'open'))?.focus();
      return;
    }
    setInvalid(null);
    const orNull = (k: string) => (text(k) === '' ? null : text(k));
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await adminApi(
      locale,
      `/workshop/profile/${encodeURIComponent(w.workshopId)}`,
      WorkshopProfileSavedDto,
      {
        method: 'PUT',
        body: {
          version: w.version,
          name: text('name'),
          nameHi: orNull('nameHi'),
          addressLine: text('addressLine'),
          addressLineHi: orNull('addressLineHi'),
          area: text('area'),
          areaHi: orNull('areaHi'),
          phone: orNull('phone'),
          hours: { open, close, days },
          busy: data.get('busy') === 'on',
          slotCapacity: capacity,
          menu,
        },
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      if (res.code === 'STALE_WORKSHOP') await onSaved();
      return;
    }
    setSaved(true);
    track('click', { id: 'workshop_profile_saved', path: window.location.pathname });
    await onSaved();
  }

  const field = (k: TextField, label: string, value: string | null, max = 200) => (
    <div>
      <label htmlFor={id(k)} className="text-xs font-bold text-muted">
        {label}
      </label>
      <input
        id={id(k)}
        name={k}
        defaultValue={value ?? ''}
        maxLength={max}
        aria-invalid={invalid === k ? true : undefined}
        className={portalField}
      />
    </div>
  );

  return (
    <article className={portalCard} aria-busy={busy || undefined}>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-extrabold text-ink">{t('profileHeading')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('name', t('f_name'), w.name, 80)}
            {field('nameHi', t('f_nameHi'), w.nameHi, 80)}
            {field('addressLine', t('f_addressLine'), w.addressLine)}
            {field('addressLineHi', t('f_addressLineHi'), w.addressLineHi)}
            {field('area', t('f_area'), w.area, 60)}
            {field('areaHi', t('f_areaHi'), w.areaHi, 60)}
            {field('phone', t('f_phone'), w.phone, 13)}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-extrabold text-ink">{t('hoursHeading')}</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={id('open')} className="text-xs font-bold text-muted">
                {t('f_open')}
              </label>
              <input
                id={id('open')}
                name="open"
                type="time"
                defaultValue={w.hours.open}
                aria-invalid={invalid === 'open' ? true : undefined}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor={id('close')} className="text-xs font-bold text-muted">
                {t('f_close')}
              </label>
              <input
                id={id('close')}
                name="close"
                type="time"
                defaultValue={w.hours.close}
                className={portalField}
              />
            </div>
          </div>
          <div role="group" aria-label={t('daysLegend')} className="flex flex-wrap gap-2">
            {WEEK.map((d) => (
              <label
                key={d}
                className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-pill px-3 text-sm font-bold text-ink"
              >
                <input
                  type="checkbox"
                  name={`day${String(d)}`}
                  defaultChecked={w.hours.days.includes(d)}
                  className="size-6"
                />
                {t(`day_${d}` as 'day_0')}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-extrabold text-ink">{t('capacityHeading')}</legend>
          <label htmlFor={id('capacity')} className="text-xs font-bold text-muted">
            {t('f_capacity')}
          </label>
          <input
            id={id('capacity')}
            name="capacity"
            type="number"
            min={1}
            max={20}
            inputMode="numeric"
            defaultValue={w.slotCapacity}
            aria-describedby={id('capacity-hint')}
            className={`${portalField} max-w-28`}
          />
          <p id={id('capacity-hint')} className="text-xs text-muted">
            {t('capacityHint')}
          </p>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-extrabold text-ink">{t('busyHeading')}</legend>
          <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-ink">
            <input type="checkbox" name="busy" defaultChecked={w.busy} className="size-6" />
            {t('f_busy')}
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-extrabold text-ink">{t('menuHeading')}</legend>
          <p className="text-xs text-muted">{t('menuHint')}</p>
          <ul className="space-y-3">
            {w.menu.map((m) => (
              <li key={m.key} className="rounded-tile border border-line-card bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex min-h-11 min-w-0 items-center gap-2 text-sm font-bold text-ink">
                    <input
                      type="checkbox"
                      name={`on-${m.key}`}
                      defaultChecked={m.active}
                      className="size-6"
                    />
                    <span data-user-content>{locale === 'hi' && m.titleHi ? m.titleHi : m.title}</span>
                  </label>
                  <span className="text-sm font-bold tabular-nums text-ink">
                    {`${formatPrice(m.lowPaise)}–${formatPrice(m.highPaise)}`}
                  </span>
                </div>
                {m.titleHi ? null : (
                  // Hard rule 10: a menu line without its Hindi name is flagged in words, never a blocker on saving.
                  <span className="mt-1 inline-flex rounded-pill bg-warning-bg px-2.5 py-0.5 text-xs font-extrabold text-warning">
                    {pw('hindi_missing')}
                  </span>
                )}
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={id(`low-${m.key}`)} className="text-xs font-bold text-muted">
                      {t('f_low')}
                    </label>
                    <input
                      id={id(`low-${m.key}`)}
                      name={`low-${m.key}`}
                      inputMode="numeric"
                      defaultValue={m.lowPaise / 100}
                      aria-invalid={invalid === `low-${m.key}` ? true : undefined}
                      className={portalField}
                    />
                  </div>
                  <div>
                    <label htmlFor={id(`high-${m.key}`)} className="text-xs font-bold text-muted">
                      {t('f_high')}
                    </label>
                    <input
                      id={id(`high-${m.key}`)}
                      name={`high-${m.key}`}
                      inputMode="numeric"
                      defaultValue={m.highPaise / 100}
                      aria-invalid={invalid === `low-${m.key}` ? true : undefined}
                      className={portalField}
                    />
                  </div>
                </div>
                {!m.active ? <p className="mt-1 text-xs text-muted">{t('menuOff')}</p> : null}
              </li>
            ))}
          </ul>
        </fieldset>

        {invalid ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t('invalid')}
          </p>
        ) : null}
        {error ? <Tier1Error code={error} /> : null}
        {saved ? (
          <p role="status" className="text-sm font-bold text-ink">
            {t('saved')}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={portalPrimary}>
          {busy ? t('saving') : t('save')}
        </button>
      </form>

      <ChangeRequests w={w} onFiled={onSaved} />
    </article>
  );
}

/** The pin and the GSTIN: files a request; the live values stay until MechDost approves (spec 07). */
function ChangeRequests({ w, onFiled }: { w: Profile; onFiled: () => Promise<void> }) {
  const t = useTranslations('workshopTier1');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);
  const [bad, setBad] = useState<'location' | 'gstin' | null>(null);
  const waiting = (k: 'location' | 'gstin') => w.pending.some((p) => p.kind === k);

  async function file(body: Record<string, unknown>) {
    setError(null);
    const res = await adminApi(
      locale,
      `/workshop/profile/${encodeURIComponent(w.workshopId)}/changes`,
      WorkshopChangeFiledDto,
      { method: 'POST', body },
    );
    if (!res.ok) {
      setError(res.code);
      return;
    }
    setFiled(true);
    await onFiled();
  }

  function onPin(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const lat = Number(d.get('lat'));
    const lng = Number(d.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setBad('location');
      return;
    }
    setBad(null);
    void file({ kind: 'location', lat, lng });
  }
  function onGstin(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = new FormData(e.currentTarget).get('gstin');
    const v = (typeof raw === 'string' ? raw : '').trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) {
      setBad('gstin');
      return;
    }
    setBad(null);
    void file({ kind: 'gstin', gstin: v });
  }
  async function withdraw(changeId: string) {
    setError(null);
    const res = await adminApi(
      locale,
      `/workshop/profile/changes/${encodeURIComponent(changeId)}`,
      { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
      { method: 'DELETE' },
    );
    if (!res.ok) setError(res.code);
    await onFiled();
  }

  const id = (k: string) => `${w.workshopId}-${k}`;
  return (
    <section className="mt-6 space-y-4 border-t border-line pt-5" aria-labelledby={id('changes')}>
      <h3 id={id('changes')} className="text-sm font-extrabold text-ink">
        {t('changesHeading')}
      </h3>
      <p className="text-xs text-muted">{t('changesHint')}</p>
      {w.pending.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-tile bg-pill p-3">
          <p role="status" className="text-sm font-bold text-ink">
            {t(`pendingKind_${p.kind}`)}
          </p>
          <button type="button" onClick={() => void withdraw(p.id)} className={portalQuiet}>
            {t('withdraw')}
          </button>
        </div>
      ))}
      {!waiting('location') ? (
        <form noValidate onSubmit={onPin} className="space-y-2">
          <p className="text-sm text-ink">{t('pinNow', { lat: w.lat.toFixed(5), lng: w.lng.toFixed(5) })}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={id('lat')} className="text-xs font-bold text-muted">
                {t('f_lat')}
              </label>
              <input
                id={id('lat')}
                name="lat"
                inputMode="decimal"
                aria-invalid={bad === 'location' ? true : undefined}
                className={portalField}
              />
            </div>
            <div>
              <label htmlFor={id('lng')} className="text-xs font-bold text-muted">
                {t('f_lng')}
              </label>
              <input
                id={id('lng')}
                name="lng"
                inputMode="decimal"
                aria-invalid={bad === 'location' ? true : undefined}
                className={portalField}
              />
            </div>
          </div>
          <button type="submit" className={portalQuiet}>
            {t('askPin')}
          </button>
        </form>
      ) : null}
      {!waiting('gstin') ? (
        <form noValidate onSubmit={onGstin} className="space-y-2">
          <p className="text-sm text-ink">{w.gstin ? t('gstinNow', { gstin: w.gstin }) : t('gstinNone')}</p>
          <label htmlFor={id('gstin')} className="text-xs font-bold text-muted">
            {t('f_gstin')}
          </label>
          <input
            id={id('gstin')}
            name="gstin"
            maxLength={15}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={bad === 'gstin' ? true : undefined}
            className={portalField}
          />
          <button type="submit" className={portalQuiet}>
            {t('askGstin')}
          </button>
        </form>
      ) : null}
      {bad ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('invalid')}
        </p>
      ) : null}
      {error ? <Tier1Error code={error} /> : null}
      {filed && !error ? (
        <p role="status" className="text-sm font-bold text-ink">
          {t('filed')}
        </p>
      ) : null}
    </section>
  );
}
