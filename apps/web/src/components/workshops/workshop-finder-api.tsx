'use client';

import { BadgeCheck, Home, LocateFixed, MapPin, Star, Truck, Zap } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicWorkshop } from '@mechdost/shared/service-api';
import type { ServiceMode } from '@mechdost/shared/state';
import { VEHICLE_LABEL_KEY, VEHICLE_TYPES, isVehicleType, type VehicleType } from '@mechdost/shared/vehicles';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/demo/session';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { visitFeeGstPaise } from '@/lib/home-service-views';
import { mapUi } from '@/lib/map-ui';
import type { NearbyQuery } from '@/lib/service-api';
import { fromPaise, serviceErrorKey } from '@/lib/service-views';
import { BookingFormApi } from './booking-form-api';
import { HomeAddressPicker, ServiceModeSwitch, useHomeAddresses } from './home-mode-fields';
import type { MapPoint } from './workshop-map';

const WorkshopMap = lazy(() => import('./workshop-map').then((m) => ({ default: m.WorkshopMap })));
const MAP_SIZE = 'h-[340px] tab:h-[420px] nav:h-[calc(100vh-9rem)] nav:max-h-[700px]';

type VehicleFilter = 'any' | VehicleType;
type Origin = { lat: number; lng: number; source: 'gps' | 'pin'; pin?: string } | null;
type Results =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ok'; workshops: PublicWorkshop[] };

/** GPS → PIN code through our server (`/api/geo/pincode`); null when unknown or offline. */
async function lookupPincode(pos: { lat: number; lng: number }) {
  try {
    const res = await fetch(`/api/geo/pincode?lat=${pos.lat.toFixed(5)}&lng=${pos.lng.toFixed(5)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { pincode: string | null };
    return body.pincode ?? null;
  } catch {
    return null;
  }
}

/**
 * Location-first workshop finder on the API (real data mode; spec 06, Stream E): PIN code or device location →
 * `GET /v1/workshops` (bookable only, PostGIS, nearest first) filtered by vehicle type and EV in the API; list +
 * map; "Let MechDost choose" below the results books without picking a workshop (admin routes it).
 */
export function WorkshopFinderApi() {
  const t = useTranslations('finder');
  const w = useTranslations('workshop');
  const r = useTranslations('request');
  const m = useTranslations('map');
  const h = useTranslations('homeService');
  const locale = useLocale();
  const mapRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState('');
  const [vehicle, setVehicle] = useState<VehicleFilter>('any');
  const [evOnly, setEvOnly] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [origin, setOrigin] = useState<Origin>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<Results>({ kind: 'idle' });
  const [choosing, setChoosing] = useState(false);
  const [mode, setMode] = useState<ServiceMode>('workshop');
  const [addressId, setAddressId] = useState('');
  const signedIn = useSession()?.role === 'customer';
  const home = mode === 'home';
  const addresses = useHomeAddresses(home && signedIn && AUTH_MODE === 'firebase');
  const homeAddress =
    addresses.state === 'ready' ? (addresses.pinned.find((a) => a.id === addressId) ?? null) : null;
  const seq = useRef(0);

  // Device location wins over a typed PIN (it is more precise; the PIN it fills in does not search again).
  const searchPin = gps ? '' : pin;
  const query = useMemo((): NearbyQuery | null => {
    const filters = { ...(vehicle === 'any' ? {} : { vehicleType: vehicle }), ev: evOnly };
    // Home visits: the pinned address decides, with each workshop's own travel radius (no PIN or GPS search).
    if (home)
      return homeAddress?.lat !== undefined && homeAddress.lat !== null && homeAddress.lng !== null
        ? { lat: homeAddress.lat, lng: homeAddress.lng, mode: 'home', ...filters, ev: false }
        : null;
    if (gps) return { ...gps, ...filters };
    if (/^[1-9]\d{5}$/.test(searchPin)) return { pincode: searchPin, ...filters };
    return null;
  }, [gps, searchPin, vehicle, evOnly, home, homeAddress]);

  const search = useCallback(
    async (q: NearbyQuery) => {
      const mine = ++seq.current;
      setResults({ kind: 'loading' });
      const { fetchNearbyWorkshops } = await import('@/lib/service-api');
      const res = await fetchNearbyWorkshops(locale, q);
      if (mine !== seq.current) return;
      if (!res.ok) {
        setResults({ kind: 'error', code: res.code });
        return;
      }
      setOrigin(
        'pincode' in q
          ? { ...res.data.origin, source: 'pin', pin: q.pincode }
          : { lat: q.lat, lng: q.lng, source: 'gps' },
      );
      setResults({ kind: 'ok', workshops: res.data.workshops });
    },
    [locale],
  );

  useEffect(() => {
    if (!query) return;
    const id = window.setTimeout(() => void search(query), 250);
    return () => {
      window.clearTimeout(id);
    };
  }, [query, search]);

  function located(pos: { lat: number; lng: number }, source: 'finder' | 'map') {
    setSelected(null);
    setLocationError(false);
    setGps(pos);
    void lookupPincode(pos).then((found) => {
      track('location_detected', { source, pincodeFound: found !== null });
      if (found) setPin(found);
    });
  }

  function useLocation() {
    if (!('geolocation' in navigator)) {
      setLocationError(true);
      return;
    }
    setLocating(true);
    setLocationError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        located({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'finder');
        setLocating(false);
      },
      () => {
        setLocationError(true);
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  const base = locale === 'hi' ? '/hi' : '';
  const pinQuery = home
    ? `?mode=home&address=${encodeURIComponent(homeAddress?.id ?? '')}`
    : /^[1-9]\d{5}$/.test(pin)
      ? `?pin=${pin}`
      : '';
  const list = results.kind === 'ok' ? results.workshops : [];
  const points: MapPoint[] = useMemo(
    () =>
      list.map((ws) => ({
        slug: ws.slug,
        name: ws.name,
        lat: ws.lat,
        lng: ws.lng,
        href: `${base}/workshops/${ws.slug}${pinQuery}`,
        rating: ws.ratingAvg ?? undefined,
        detail: `${ws.area} · ${t('distance', { km: ws.distanceKm.toFixed(1) })}`,
      })),
    [list, base, pinQuery, t],
  );
  const pinUnknown =
    results.kind === 'error' && (results.code === 'PINCODE_UNKNOWN' || results.code === 'VALIDATION');

  return (
    <div>
      <section
        aria-labelledby="finder-title"
        className="rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
      >
        <h2 id="finder-title" className="font-heading text-lg font-extrabold text-ink">
          {t('title')}
        </h2>
        <div className="mt-4">
          <ServiceModeSwitch
            mode={mode}
            onChange={(next) => {
              setMode(next);
              setSelected(null);
              setResults({ kind: 'idle' });
              track('service_mode_selected', { mode: next });
            }}
          />
        </div>
        {home ? (
          <div className="mt-4 max-w-xl space-y-3">
            <p className="text-sm text-muted">{h('homeFinderIntro')}</p>
            <HomeAddressPicker
              addresses={addresses}
              signedIn={signedIn}
              value={homeAddress?.id ?? ''}
              onChange={(id) => {
                setAddressId(id);
                setSelected(null);
              }}
              fieldId="finder-home-address"
            />
          </div>
        ) : null}
        <div className={`mt-4 grid gap-3 tab:grid-cols-[1fr_1fr_auto] tab:items-end ${home ? 'hidden' : ''}`}>
          <div>
            <label htmlFor="finder-pin" className="text-xs font-bold text-muted">
              {t('pinLabel')}
            </label>
            <input
              id="finder-pin"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              value={pin}
              placeholder={t('pinPlaceholder')}
              onChange={(e) => {
                // Typing a PIN means "search here", not at the device location.
                setGps(null);
                setSelected(null);
                setPin(e.target.value.replace(/\D/g, ''));
              }}
              className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted"
            />
          </div>
          <div>
            <label htmlFor="finder-vehicle" className="text-xs font-bold text-muted">
              {t('vehicleLabel')}
            </label>
            <select
              id="finder-vehicle"
              value={vehicle}
              onChange={(e) => {
                setVehicle(isVehicleType(e.target.value) ? e.target.value : 'any');
              }}
              className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
            >
              <option value="any">{t('any')}</option>
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(VEHICLE_LABEL_KEY[type])}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={useLocation}
            data-track="finder_use_location"
            className="press inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-navy px-5 text-sm font-bold text-white hover:opacity-90"
          >
            <LocateFixed aria-hidden="true" className="size-4" />
            {locating ? t('locating') : t('useLocation')}
          </button>
        </div>
        <label
          className={`mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-ink ${home ? 'hidden' : ''}`}
        >
          <input
            type="checkbox"
            checked={evOnly}
            onChange={(e) => {
              setEvOnly(e.target.checked);
            }}
            className="size-6 accent-[var(--color-accent-button)]"
          />
          {t('evOnly')}
        </label>
        {locationError ? <p className="mt-2 text-sm font-bold text-error">{t('locationDenied')}</p> : null}
        {pinUnknown ? (
          <p role="status" className="mt-2 text-sm font-bold text-warning">
            {w('api_pinUnknown')}
          </p>
        ) : null}
      </section>

      <div className="mt-6" aria-live="polite">
        {results.kind === 'idle' ? (
          <p className="rounded-card border border-line-card bg-surface p-6 text-muted">
            {home ? h('homeFinderStart') : w('api_finderStart')}
          </p>
        ) : null}
        {results.kind === 'loading' ? (
          <p role="status" className="rounded-card border border-line-card bg-surface p-6 text-muted">
            {home ? h('homeFinderLoading') : w('api_finderLoading')}
          </p>
        ) : null}
        {results.kind === 'error' && !pinUnknown ? (
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-line-card bg-surface p-6">
            <p role="alert" className="text-sm font-bold text-error">
              {r(serviceErrorKey(results.code) as 'api_err_generic')}
            </p>
            {query ? (
              <button
                type="button"
                onClick={() => void search(query)}
                className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {w('api_retry')}
              </button>
            ) : null}
          </div>
        ) : null}
        {results.kind === 'ok' ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p role="status" className="text-sm font-bold text-ink">
              {t('results', { count: list.length })}
            </p>
            {origin ? (
              <p className="text-xs text-muted">
                {origin.source === 'pin'
                  ? t('sortedByPin', { pin: origin.pin ?? '' })
                  : /^[1-9]\d{5}$/.test(pin)
                    ? t('sortedByDistanceAt', { pin })
                    : t('sortedByDistance')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {results.kind === 'ok' && list.length === 0 ? (
        <p className="mt-4 rounded-card border border-line-card bg-surface p-6 text-muted">
          {home ? h('homeNone') : w('api_noneNearby')}
        </p>
      ) : null}

      {list.length > 0 ? (
        <div className="mt-4 grid gap-5 nav:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] nav:items-start">
          <div ref={mapRef} className="scroll-mt-28 nav:order-2 nav:sticky nav:top-28">
            <Suspense
              fallback={
                <div
                  className={`rounded-card border border-line-card bg-surface-alt shadow-card ${MAP_SIZE}`}
                />
              }
            >
              <WorkshopMap
                points={points}
                origin={origin}
                selected={selected}
                onSelect={(slug) => {
                  track('map_action', { action: 'pin_select', workshop: slug });
                  setSelected(slug);
                  document
                    .getElementById(`workshop-${slug}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                onLocate={(pos) => {
                  located(pos, 'map');
                }}
                label={t('mapLabel')}
                youAreHere={t('youAreHere')}
                ui={mapUi(m)}
                locale={locale}
                className={MAP_SIZE}
              />
            </Suspense>
          </div>
          <ul className="grid gap-4 nav:order-1">
            {list.map((ws) => (
              <li key={ws.slug} id={`workshop-${ws.slug}`} className="scroll-mt-32">
                <WorkshopCardApi
                  workshop={ws}
                  href={`${base}/workshops/${ws.slug}${pinQuery}`}
                  active={selected === ws.slug}
                  showFee={home}
                  onShowOnMap={() => {
                    track('map_action', { action: 'show_on_map', workshop: ws.slug });
                    setSelected(ws.slug);
                    const box = mapRef.current?.getBoundingClientRect();
                    if (box && (box.bottom < 80 || box.top > window.innerHeight)) {
                      mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {home ? (
        <p className="mt-8 rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {h('homeLetMechdost')}
        </p>
      ) : (
        <section
          aria-labelledby="choose-title"
          className="mt-8 rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
        >
          <h2 id="choose-title" className="font-heading text-lg font-extrabold text-ink">
            {w('api_chooseTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted">{w('api_chooseIntro')}</p>
          {choosing ? (
            <div className="mt-5 max-w-xl">
              <BookingFormApi
                key={pin}
                workshop={null}
                pincode={/^[1-9]\d{5}$/.test(pin) ? pin : ''}
                origin={gps}
              />
              <button
                type="button"
                data-panel-cancel="finder-choose"
                data-track="finder_let_mechdost_choose_cancel"
                onClick={() => {
                  setChoosing(false);
                }}
                className="press mt-3 inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {w('api_chooseCancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-track="finder_let_mechdost_choose"
              data-disclosure-trigger="finder-choose"
              onClick={() => {
                setChoosing(true);
              }}
              className="press mt-4 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
            >
              {w('api_chooseOpen')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function WorkshopCardApi({
  workshop: ws,
  href,
  active,
  showFee,
  onShowOnMap,
}: {
  workshop: PublicWorkshop;
  href: string;
  active: boolean;
  /** Home mode: the visit fee is the price that matters, shown on the card before booking. */
  showFee: boolean;
  onShowOnMap: () => void;
}) {
  const t = useTranslations('finder');
  const w = useTranslations('workshop');
  const h = useTranslations('homeService');
  const from = fromPaise(ws.services);
  return (
    <article
      className={`group flex h-full flex-col rounded-card border bg-surface p-5 shadow-card transition-[box-shadow,border-color] duration-[var(--duration-base)] hover:shadow-card-hover ${
        active ? 'border-accent-button' : 'border-line-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-lg leading-snug font-extrabold text-ink">
            <Link href={href} className="inline-block py-0.5 hover:underline">
              {ws.name}
            </Link>
          </h3>
          <p className="mt-1 flex items-start gap-1 text-sm text-muted">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {ws.area} · {ws.pincode}
              <span className="font-bold text-ink"> · {t('distance', { km: ws.distanceKm.toFixed(1) })}</span>
            </span>
          </p>
        </div>
        {ws.ratingAvg !== null && ws.ratingCount > 0 ? (
          <p className="flex shrink-0 items-center gap-1 rounded-lg bg-success-bg px-2 py-1 text-xs font-bold text-success">
            <Star aria-hidden="true" className="size-3.5 fill-current" />
            {ws.ratingAvg.toFixed(1)}
            <span className="sr-only">
              {t('rating', { rating: ws.ratingAvg.toFixed(1), count: ws.ratingCount })}
            </span>
          </p>
        ) : (
          <p className="shrink-0 rounded-lg bg-success-bg px-2 py-1 text-xs font-bold text-success">
            {w('api_newOnMechdost')}
          </p>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
        <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
          <BadgeCheck aria-hidden="true" className="size-3.5 text-success" />
          {t('checked')}
        </li>
        {ws.pickup ? (
          <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
            <Truck aria-hidden="true" className="size-3.5" />
            {t('pickup')}
          </li>
        ) : null}
        {ws.evBasic ? (
          <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
            <Zap aria-hidden="true" className="size-3.5" />
            {t('ev')}
          </li>
        ) : null}
        <li className="rounded-md bg-pill px-2 py-1 text-ink">{ws.vehicleTypes.join(' · ')}</li>
        {ws.home ? (
          <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
            <Home aria-hidden="true" className="size-3.5" />
            {h('homeBadge')} · {h('cardRadius', { km: ws.home.radiusKm })}
          </li>
        ) : null}
      </ul>
      <p className="mt-3 text-sm text-muted">
        {ws.services
          .slice(0, 4)
          .map((s) => s.title)
          .join(' · ')}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        {from !== null ? (
          <p className="text-sm font-bold text-ink">{t('from', { price: formatPrice(from) })}</p>
        ) : null}
        {showFee && ws.home ? (
          <p className="text-sm font-bold text-ink">
            {ws.home.visitFeePaise === 0
              ? h('cardFeeFree')
              : visitFeeGstPaise(ws.home.visitFeePaise, ws.gstRegistered) > 0
                ? h('cardFeeGst', {
                    fee: formatPrice(ws.home.visitFeePaise),
                    gst: formatPrice(visitFeeGstPaise(ws.home.visitFeePaise, ws.gstRegistered)),
                  })
                : h('cardFee', { fee: formatPrice(ws.home.visitFeePaise) })}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onShowOnMap}
          aria-pressed={active}
          className="press ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-button border border-input-border px-3 text-sm font-bold text-ink hover:bg-pill"
        >
          <MapPin aria-hidden="true" className="size-4" />
          {t('viewOnMap')}
        </button>
        <Link
          href={href}
          data-track={`finder_view_${ws.slug}`}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('view')}
        </Link>
      </div>
    </article>
  );
}
