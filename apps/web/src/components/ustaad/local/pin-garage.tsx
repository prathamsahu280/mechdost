'use client';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  EyeOff,
  LocateFixed,
  Store,
  Bike,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { ustaadClient, type MyLocation } from '@/lib/ustaad/client';
import { gpsIsWeak, nudge, pinSource, type LatLng, type NudgeDir } from '@/lib/ustaad/local-view';
import { Switch } from '../../ui/switch';
import { ImagePicker, type PreparedImage } from '../media/image-picker';
import { UploadProgress } from '../media/upload-progress';
import {
  btnPrimary,
  btnQuiet,
  card,
  fieldClass,
  LoadFailed,
  LoadingBlock,
  SampleNote,
  useErrorText,
  useUstaad,
} from '../common';
import { useUploadErrorText } from '../media/upload-error';

const PinMap = dynamic(() => import('./pin-map'), {
  ssr: false,
  loading: () => <div className="skeleton h-[300px] rounded-2xl tab:h-[360px]" aria-hidden="true" />,
});

/** `loc.gps_max_m` default (spec 23 § 15): worse readings are not a pin, the member places it and adds a landmark. */
const GPS_MAX_M = 100;
/** Where a hand-placed pin starts when there is no GPS fix (Raipur; the API checks the city region). */
const CITY_CENTRE: LatLng = { lat: 21.2514, lng: 81.6296 };

interface Choices {
  useForVerify: boolean;
  countInZone: boolean;
  shareExact: boolean;
  exactAudience: 'connections' | 'all_verified';
}
const CHOICE_ROWS = [
  { key: 'useForVerify', title: 'cUse', sub: 'cUseS' },
  { key: 'countInZone', title: 'cZone', sub: 'cZoneS' },
  { key: 'shareExact', title: 'cExact', sub: 'cExactS' },
] as const;
const ALL_OFF: Choices = {
  useForVerify: false,
  countInZone: false,
  shareExact: false,
  exactAudience: 'connections',
};

/**
 * Pin my garage (spec 23 § 4 flow 10, § 9.6): where you work (set at join), "Use my location" with the accuracy circle,
 * drag the pin, tap the map or use the arrow buttons; a weak reading or a pin moved off the fix needs a landmark; the
 * three choices start off; "This is my garage" saves (the API enforces the move limits and the region). Then the
 * optional signboard photo for "Verified location", and "Hide my location". Home/roadside members never show a point.
 */
export function PinGarage() {
  const t = useTranslations('ustaad.local');
  const locale = useLocale();
  const errorText = useErrorText('local');
  const ids = useId();
  const me = useUstaad((c) => c.me(), 'me');
  const saved = useUstaad((c) => c.myLocation(), 'loc');
  const [pin, setPin] = useState<LatLng | null>(null);
  const [fix, setFix] = useState<(LatLng & { accuracyM: number }) | null>(null);
  const [gps, setGps] = useState<'idle' | 'finding' | 'denied'>('idle');
  const [landmark, setLandmark] = useState('');
  const [choices, setChoices] = useState<Choices>(ALL_OFF);
  const [current, setCurrent] = useState<MyLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [landmarkError, setLandmarkError] = useState(false);
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    if (saved.loaded.state !== 'ok' || !saved.loaded.data) return;
    const l = saved.loaded.data;
    setCurrent(l);
    setPin({ lat: l.lat, lng: l.lng });
    setLandmark(l.landmark ?? '');
    setChoices({
      useForVerify: l.useForVerify,
      countInZone: l.countInZone,
      shareExact: l.shareExact,
      exactAudience: l.exactAudience,
    });
  }, [saved.loaded]);

  if (me.loaded.state === 'loading' || saved.loaded.state === 'loading') return <LoadingBlock />;
  if (me.loaded.state === 'error')
    return <LoadFailed message={errorText(me.loaded.code)} onRetry={me.reload} />;
  if (saved.loaded.state === 'error')
    return <LoadFailed message={errorText(saved.loaded.code)} onRetry={saved.reload} />;

  const workPlace = me.loaded.data.member?.workPlace ?? 'shop';
  const home = workPlace === 'home_roadside';
  const unmoved =
    current !== null && pin !== null && fix === null && pin.lat === current.lat && pin.lng === current.lng;
  const source = unmoved ? current.source : pin ? pinSource(fix, pin, GPS_MAX_M) : 'manual';
  const needLandmark = pin !== null && source === 'manual' && !(unmoved && current.landmark);

  function locate() {
    if (!('geolocation' in navigator)) {
      setGps('denied');
      return;
    }
    setGps('finding');
    setMoved(0);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setFix({ ...p, accuracyM: Math.round(pos.coords.accuracy) });
        setPin(p);
        setGps('idle');
      },
      () => {
        setGps('denied');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function save(hidden: boolean) {
    if (!pin || busy) return;
    setMsg(null);
    if (needLandmark && landmark.trim().length < 2) {
      setLandmarkError(true);
      document.getElementById(`${ids}-landmark`)?.focus();
      return;
    }
    setLandmarkError(false);
    setBusy(true);
    const r = await (
      await ustaadClient(locale)
    ).saveLocation({
      lat: pin.lat,
      lng: pin.lng,
      accuracyM: unmoved ? current.accuracyM : (fix?.accuracyM ?? 0),
      source,
      landmark: landmark.trim() === '' ? null : landmark.trim(),
      useForVerify: choices.useForVerify,
      countInZone: choices.countInZone,
      shareExact: home ? false : choices.shareExact,
      exactAudience: choices.exactAudience,
      hidden,
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: errorText(r.code) });
      return;
    }
    setCurrent(r.data);
    setMsg({ ok: true, text: hidden ? t('locHidden') : current?.hidden ? t('locShown') : t('saved') });
  }

  const setChoice = (k: keyof Omit<Choices, 'exactAudience'>) => (on: boolean) => {
    setChoices((c) => ({ ...c, [k]: on }));
  };

  const nudgeButtons: { dir: NudgeDir; icon: typeof ArrowUp; label: string }[] = [
    { dir: 'up', icon: ArrowUp, label: t('nUp') },
    { dir: 'left', icon: ArrowLeft, label: t('nLeft') },
    { dir: 'right', icon: ArrowRight, label: t('nRight') },
    { dir: 'down', icon: ArrowDown, label: t('nDown') },
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header>
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted">{t('intro')}</p>
      </header>

      <SampleNote show={me.sample} />

      <section aria-labelledby={`${ids}-place`} className={card}>
        <h2 id={`${ids}-place`} className="font-heading text-base font-extrabold text-ink">
          {t('placeH')}
        </h2>
        <p className="mt-2 flex items-center gap-2 text-[15px] font-bold text-ink">
          {home ? (
            <Bike aria-hidden="true" className="size-5 text-accent-soft-text" />
          ) : (
            <Store aria-hidden="true" className="size-5 text-accent-soft-text" />
          )}
          {t(home ? 'place_home_roadside' : 'place_shop')}
          <span className="text-sm font-normal text-muted">· {t('placeSet')}</span>
        </p>
        {home ? <p className="mt-2 text-sm text-ink">{t('placeNoteHome')}</p> : null}
      </section>

      <section aria-labelledby={`${ids}-map`} className="grid gap-3">
        <h2 id={`${ids}-map`} className="sr-only">
          {t('nudgeL')}
        </h2>
        <button
          type="button"
          className={`${btnQuiet} min-h-14 text-base`}
          onClick={() => {
            if (gps !== 'finding') locate();
          }}
          aria-disabled={gps === 'finding'}
          data-track="ustaad_pin_locate"
        >
          <LocateFixed aria-hidden="true" className="size-5 text-accent-soft-text" />
          {gps === 'finding' ? t('gpsFinding') : fix ? t('gpsAgain') : t('useLoc')}
        </button>
        <p role="status" className="text-[15px] leading-relaxed text-ink empty:sr-only">
          {moved > 0
            ? `${t('pinMoved')}${moved % 2 === 0 ? '\u00a0' : ''}`
            : gps === 'denied'
              ? t('gpsDenied')
              : fix
                ? gpsIsWeak(fix.accuracyM, GPS_MAX_M)
                  ? t('gpsWeak', { m: fix.accuracyM })
                  : t('gpsFound', { m: fix.accuracyM })
                : ''}
        </p>
        {/* Low data: the map (style, tiles, MapLibre) loads only once there is a pin to show. */}
        {pin ? (
          <PinMap
            value={pin}
            accuracy={fix}
            label={t('mapLabel')}
            markerLabel={t('pinMarker')}
            onChange={setPin}
          />
        ) : null}
        <fieldset>
          <legend className="text-sm font-bold text-ink">{t('nudgeL')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {nudgeButtons.map(({ dir, icon: Icon, label }) => (
              <button
                key={dir}
                type="button"
                className={`${btnQuiet} min-w-12 px-3`}
                onClick={() => {
                  // No pin yet (no GPS, desktop, keyboard): the first press places it at the city centre.
                  setPin(nudge(pin ?? CITY_CENTRE, dir));
                  setMoved((n) => n + 1);
                }}
                data-track={`ustaad_pin_nudge_${dir}`}
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {needLandmark || landmark !== '' ? (
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-landmark`} className="text-sm font-bold text-ink">
              {t('landmarkL')}
            </label>
            <input
              id={`${ids}-landmark`}
              value={landmark}
              maxLength={120}
              placeholder={t('landmarkPh')}
              aria-invalid={landmarkError}
              aria-describedby={landmarkError ? `${ids}-landmark-err` : undefined}
              onChange={(e) => {
                setLandmark(e.target.value);
              }}
              className={fieldClass}
            />
            {landmarkError ? (
              <p id={`${ids}-landmark-err`} className="text-sm font-bold text-error">
                {t('landmarkNeed')}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${ids}-choices`} className={`${card} grid gap-4`}>
        <div>
          <h2 id={`${ids}-choices`} className="font-heading text-base font-extrabold text-ink">
            {t('consentH')}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t('consentS')}</p>
        </div>
        {CHOICE_ROWS.filter((row) => !(home && row.key === 'shareExact')).map(({ key, title, sub }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor={`${ids}-${key}`} className="text-[15px] font-bold text-ink">
                {t(title)}
              </label>
              <p id={`${ids}-${key}-help`} className="text-sm text-muted">
                {t(sub)}
              </p>
            </div>
            <Switch
              id={`${ids}-${key}`}
              checked={choices[key]}
              onChange={setChoice(key)}
              onText={t('switchOn')}
              offText={t('switchOff')}
              describedBy={`${ids}-${key}-help`}
            />
          </div>
        ))}
        {choices.shareExact && !home ? (
          <fieldset>
            <legend className="text-sm font-bold text-ink">{t('audienceH')}</legend>
            <div className="mt-2 grid gap-2">
              {(['connections', 'all_verified'] as const).map((a) => (
                <label
                  key={a}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line-card px-3 text-[15px] text-ink has-checked:border-accent has-checked:bg-accent-soft"
                >
                  <input
                    type="radio"
                    name={`${ids}-aud`}
                    checked={choices.exactAudience === a}
                    onChange={() => {
                      setChoices((c) => ({ ...c, exactAudience: a }));
                    }}
                    className="size-5 accent-accent-button"
                  />
                  {t(`aud_${a}`)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <p className="rounded-xl bg-surface-alt p-3 text-sm leading-relaxed text-ink">{t('privacyNote')}</p>
      </section>

      <p
        role="status"
        className={`text-[15px] font-bold empty:sr-only ${msg?.ok ? 'text-success' : 'text-error'}`}
      >
        {msg ? (
          <span className="inline-flex items-start gap-2">
            {msg.ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" /> : null}
            {msg.text}
          </span>
        ) : (
          ''
        )}
      </p>

      <button
        type="button"
        className={`${btnPrimary} min-h-14 text-[17px]`}
        aria-disabled={!pin || busy}
        onClick={() => void save(false)}
        data-track="ustaad_pin_confirm"
      >
        <CheckCircle2 aria-hidden="true" className="size-6" />
        {busy ? t('saving') : t('confirm')}
      </button>

      {current ? <Signboard verified={current.verified} /> : null}

      {current ? (
        <section aria-labelledby={`${ids}-hide`} className={`${card} grid gap-2`}>
          <h2 id={`${ids}-hide`} className="font-heading text-base font-extrabold text-ink">
            {t('hideH')}
          </h2>
          <button
            type="button"
            className={`${btnQuiet} justify-self-start`}
            onClick={() => void save(!current.hidden)}
            disabled={busy}
            data-track={current.hidden ? 'ustaad_pin_show' : 'ustaad_pin_hide'}
          >
            <EyeOff aria-hidden="true" className="size-5" />
            {current.hidden ? t('locShow') : t('locHide')}
          </button>
        </section>
      ) : (
        <p className="text-sm text-muted">{t('signboardNeedPin')}</p>
      )}
    </div>
  );
}

function Signboard({ verified }: { verified: boolean }) {
  const t = useTranslations('ustaad.local');
  const locale = useLocale();
  const errorText = useErrorText('local');
  const uploadError = useUploadErrorText('local');
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (!img) return;
    setMsg(null);
    const client = await ustaadClient(locale);
    setPct(0);
    const up = await client.upload(
      img.blob,
      { kind: 'image', mime: img.mime, width: img.width, height: img.height },
      setPct,
    );
    if (!up.ok) {
      setPct(null);
      setMsg({ ok: false, text: uploadError(up.code) });
      return;
    }
    const r = await client.signboard(up.data.mediaId);
    setPct(null);
    setMsg(r.ok ? { ok: true, text: t('signboardSent') } : { ok: false, text: errorText(r.code) });
  }

  return (
    <section aria-labelledby="ustaad-vloc" className={`${card} grid gap-3`}>
      <h2 id="ustaad-vloc" className="font-heading text-base font-extrabold text-ink">
        {t('vlocH')}
      </h2>
      {verified ? (
        <p className="inline-flex items-center gap-2 text-[15px] font-bold text-success">
          <CheckCircle2 aria-hidden="true" className="size-5" />
          {t('vlocDone')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">{t('vlocS')}</p>
          <ImagePicker onChange={setImg} />
          {pct !== null ? <UploadProgress pct={pct} /> : null}
          {img ? (
            <button
              type="button"
              className={`${btnQuiet} justify-self-start`}
              onClick={() => void send()}
              disabled={pct !== null}
              data-track="ustaad_signboard_send"
            >
              {t('signboardSend')}
            </button>
          ) : null}
          <p
            role="status"
            className={`text-sm font-bold empty:sr-only ${msg?.ok ? 'text-success' : 'text-error'}`}
          >
            {msg?.text ?? ''}
          </p>
        </>
      )}
    </section>
  );
}
