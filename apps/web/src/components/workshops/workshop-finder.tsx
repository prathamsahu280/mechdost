'use client';

import { BadgeCheck, LocateFixed, MapPin, Star, Truck, Zap } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { VEHICLE_LABEL_KEY, VEHICLE_TYPES, isVehicleType, type VehicleType } from '@mechdost/shared/vehicles';
import {
  DEMO_WORKSHOPS,
  PIN_CENTROIDS,
  distanceKm,
  fromPricePaise,
  type DemoWorkshop,
} from '@/demo/workshops';
import { localizeWorkshop } from '@/demo/i18n/localize';
import { usePartnerHistory, usePartnerStatus, visibleToCustomers } from '@/demo/partner-status';
import { formatPrice } from '@/lib/format';
import { track } from '@/lib/analytics';
import { mapUi } from '@/lib/map-ui';
import type { MapPoint } from './workshop-map';

/**
 * The map's own code loads after the list (JS budget, 2026-11-13: `/workshops` was over 180 KB). MapLibre was
 * already loaded on demand; this moves the component too. The placeholder has the map's size, so nothing shifts.
 */
const WorkshopMap = lazy(() => import('./workshop-map').then((m) => ({ default: m.WorkshopMap })));
const MAP_SIZE = 'h-[340px] tab:h-[420px] nav:h-[calc(100vh-9rem)] nav:max-h-[700px]';

type VehicleFilter = 'any' | VehicleType;
type Origin = { lat: number; lng: number; source: 'gps' | 'pin'; pin?: string; area?: string } | null;

/** GPS → PIN code through our server (`/api/geo/pincode`); null when unknown or offline. */
async function lookupPincode(pos: { lat: number; lng: number }) {
  try {
    const res = await fetch(`/api/geo/pincode?lat=${pos.lat.toFixed(5)}&lng=${pos.lng.toFixed(5)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { pincode: string | null; area: string | null };
    return body.pincode ? body : null;
  } catch {
    return null;
  }
}

/**
 * Location-first workshop finder (spec 06): PIN or device location → nearby workshops sorted by distance,
 * filtered by vehicle type and EV capability. Demo data; the API uses PostGIS ST_DWithin + KNN ordering.
 */
export function WorkshopFinder() {
  const t = useTranslations('finder');
  const m = useTranslations('map');
  const locale = useLocale();
  const mapRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState('');
  const [vehicle, setVehicle] = useState<VehicleFilter>('any');
  const [evOnly, setEvOnly] = useState(false);
  const [origin, setOrigin] = useState<Origin>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  // Suspended workshops are hidden from customers; paused ones stay listed as "not taking bookings".
  const statusHistory = usePartnerHistory();
  const results = useMemo(() => {
    const matches = DEMO_WORKSHOPS.map((w) => localizeWorkshop(w, locale)).filter(
      (w) =>
        (vehicle === 'any' || w.vehicles.includes(vehicle)) &&
        (!evOnly || w.ev) &&
        visibleToCustomers('workshop', w.slug),
    );
    const withDistance = matches.map((w) => ({ w, km: origin ? distanceKm(origin, w) : null }));
    if (origin) withDistance.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
    else withDistance.sort((a, b) => b.w.rating - a.w.rating);
    return withDistance;
  }, [vehicle, evOnly, origin, statusHistory, locale]);

  function applyPin(value: string) {
    setPin(value);
    const centroid = PIN_CENTROIDS[value];
    if (/^\d{6}$/.test(value)) setOrigin(centroid ? { ...centroid, source: 'pin', pin: value } : null);
  }

  /**
   * A new position from either locate button (bug 2026-11-02): drop any selected workshop so the map centres on
   * the user, then fill the PIN field from the position (user: "use my location should also fetch my pincode").
   */
  function locatedAt(pos: { lat: number; lng: number }, source: 'finder' | 'map') {
    setSelected(null);
    setLocationError(false);
    const next = { ...pos, source: 'gps' as const };
    setOrigin(next);
    void lookupPincode(pos).then((found) => {
      track('location_detected', { source, pincodeFound: found !== null });
      if (!found?.pincode) return;
      const code = found.pincode;
      setPin(code);
      setOrigin((current) =>
        current === next ? { ...next, pin: code, area: found.area ?? undefined } : current,
      );
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
        locatedAt({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'finder');
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
  const points: MapPoint[] = useMemo(
    () =>
      results.map(({ w, km }) => ({
        slug: w.slug,
        name: w.name,
        lat: w.lat,
        lng: w.lng,
        href: `${base}/workshops/${w.slug}`,
        rating: w.rating,
        detail:
          km !== null ? `${w.area} · ${t('distance', { km: km.toFixed(1) })}` : `${w.area} · ${w.pincode}`,
      })),
    [results, base, t],
  );

  return (
    <div>
      <section
        aria-labelledby="finder-title"
        className="rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
      >
        <h2 id="finder-title" className="font-heading text-lg font-extrabold text-ink">
          {t('title')}
        </h2>
        <div className="mt-4 grid gap-3 tab:grid-cols-[1fr_1fr_auto] tab:items-end">
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
                applyPin(e.target.value.replace(/\D/g, ''));
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
        <label className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-ink">
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
      </section>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <p role="status" className="text-sm font-bold text-ink">
          {t('results', { count: results.length })}
        </p>
        {origin ? (
          <p className="text-xs text-muted">
            {origin.source === 'pin'
              ? t('sortedByPin', { pin: origin.pin ?? '' })
              : origin.pin
                ? t('sortedByDistanceAt', { pin: origin.pin })
                : t('sortedByDistance')}
          </p>
        ) : null}
      </div>

      {results.length === 0 ? (
        <p className="mt-4 rounded-card border border-line-card bg-surface p-6 text-muted">{t('noMatch')}</p>
      ) : (
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
                  locatedAt(pos, 'map');
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
            {results.map(({ w, km }) => (
              <li key={w.slug} id={`workshop-${w.slug}`} className="scroll-mt-32">
                <WorkshopCard
                  workshop={w}
                  km={km}
                  href={`${base}/workshops/${w.slug}`}
                  active={selected === w.slug}
                  onShowOnMap={() => {
                    track('map_action', { action: 'show_on_map', workshop: w.slug });
                    setSelected(w.slug);
                    // Phones and tablets stack the map above the list: bring it into view.
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
      )}
    </div>
  );
}

function WorkshopCard({
  workshop: w,
  km,
  href,
  active,
  onShowOnMap,
}: {
  workshop: DemoWorkshop;
  km: number | null;
  href: string;
  active: boolean;
  onShowOnMap: () => void;
}) {
  const t = useTranslations('finder');
  const paused = usePartnerStatus('workshop', w.slug).status === 'paused';
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
              {w.name}
            </Link>
          </h3>
          <p className="mt-1 flex items-start gap-1 text-sm text-muted">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {/* One text run, so the distance wraps with the area instead of forming a second column. */}
            <span>
              {w.area} · {w.pincode}
              {km !== null ? (
                <span className="font-bold text-ink"> · {t('distance', { km: km.toFixed(1) })}</span>
              ) : null}
            </span>
          </p>
          {paused ? (
            <p className="mt-2 inline-flex rounded-pill bg-warning-bg px-3 py-1 text-xs font-bold text-warning">
              {t('notTakingBookings')}
            </p>
          ) : null}
        </div>
        <p className="flex shrink-0 items-center gap-1 rounded-lg bg-success-bg px-2 py-1 text-xs font-bold text-success">
          <Star aria-hidden="true" className="size-3.5 fill-current" />
          {w.rating.toFixed(1)}
          <span className="sr-only">{t('rating', { rating: w.rating.toFixed(1), count: w.reviews })}</span>
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
        <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
          <BadgeCheck aria-hidden="true" className="size-3.5 text-success" />
          {t('checked')}
        </li>
        {w.pickup ? (
          <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
            <Truck aria-hidden="true" className="size-3.5" />
            {t('pickup')}
          </li>
        ) : null}
        {w.ev ? (
          <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
            <Zap aria-hidden="true" className="size-3.5" />
            {t('ev')}
          </li>
        ) : null}
        <li className="rounded-md bg-pill px-2 py-1 text-ink">{w.vehicles.join(' · ')}</li>
      </ul>
      <p className="mt-3 line-clamp-2 text-sm text-muted">
        {w.services
          .slice(0, 4)
          .map((s) => s.name)
          .join(' · ')}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="text-sm font-bold text-ink">{t('from', { price: formatPrice(fromPricePaise(w)) })}</p>
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
          data-track={`finder_view_${w.slug}`}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('view')}
        </Link>
      </div>
    </article>
  );
}
