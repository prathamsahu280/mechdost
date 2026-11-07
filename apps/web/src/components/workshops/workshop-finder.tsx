'use client';

import {
  BadgeCheck,
  Bike,
  Car,
  CarFront,
  ChevronDown,
  LocateFixed,
  MapPin,
  Star,
  Truck,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEMO_WORKSHOPS,
  PIN_CENTROIDS,
  distanceKm,
  fromPricePaise,
  type DemoWorkshop,
} from '@/demo/workshops';
import { localizeWorkshop } from '@/demo/i18n/localize';
import { usePartnerHistory, usePartnerStatus, visibleToCustomers } from '@/demo/partner-status';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { mapUi } from '@/lib/map-ui';
import { workshopPhoto } from '@/lib/media';
import { Select } from '../ui/select';
import { WorkshopMap, type MapPoint } from './workshop-map';

type VehicleFilter = 'any' | '2W' | '4W';
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

  // Deep link from the home hero (`/workshops?pin=492001&vehicle=4W`). Read after hydration: the page is static.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('pin')?.trim() ?? '';
    if (/^\d{6}$/.test(fromUrl)) applyPin(fromUrl);
    const v = params.get('vehicle');
    if (v === '2W' || v === '4W') setVehicle(v);
  }, []); // once, on mount

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
            <label
              id="finder-vehicle-label"
              htmlFor="finder-vehicle"
              className="text-xs font-bold text-muted"
            >
              {t('vehicleLabel')}
            </label>
            <Select
              id="finder-vehicle"
              name="vehicle"
              className="mt-1"
              value={vehicle}
              trackPrefix="finder_vehicle"
              options={[
                { value: 'any', label: t('any'), icon: CarFront },
                { value: '2W', label: t('twoWheeler'), icon: Bike },
                { value: '4W', label: t('fourWheeler'), icon: Car },
              ]}
              onChange={setVehicle}
            />
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
            className="size-[26px] shrink-0 accent-[var(--color-accent-button)]"
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
        <div className="mt-4 grid grid-cols-1 gap-5 nav:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] nav:items-start">
          <div ref={mapRef} className="scroll-mt-28 nav:order-2 nav:sticky nav:top-24">
            <WorkshopMap
              points={points}
              origin={origin}
              selected={selected}
              onSelect={(slug) => {
                track('map_action', { action: 'pin_select', workshop: slug });
                setSelected(slug);
                // Let the row expand first, then bring it into view.
                requestAnimationFrame(() => {
                  document
                    .getElementById(`workshop-${slug}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
              }}
              onLocate={(pos) => {
                locatedAt(pos, 'map');
              }}
              label={t('mapLabel')}
              youAreHere={t('youAreHere')}
              ui={mapUi(m)}
              locale={locale}
              className="h-[340px] tab:h-[420px] nav:h-[calc(100vh-7.5rem)] nav:max-h-[760px]"
            />
          </div>
          <ul className="grid grid-cols-1 gap-2.5 nav:order-1">
            {results.map(({ w, km }) => (
              <li key={w.slug} id={`workshop-${w.slug}`} className="scroll-mt-28">
                <WorkshopRow
                  workshop={w}
                  km={km}
                  href={`${base}/workshops/${w.slug}`}
                  open={selected === w.slug}
                  onToggle={() => {
                    setSelected((current) => (current === w.slug ? null : w.slug));
                  }}
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

/**
 * Compact list row (user 2026-11-02: list view with the map on the right; a workshop expands when chosen in the
 * list or on the map). The row header is an accordion button (aria-expanded/controls); one row is open at a time
 * and the open row is the selected map pin. The panel animates its height with grid rows; the closed panel is
 * inert so its links are not tabbable. Reduced motion makes the change instant (global rule).
 */
function WorkshopRow({
  workshop: w,
  km,
  href,
  open,
  onToggle,
  onShowOnMap,
}: {
  workshop: DemoWorkshop;
  km: number | null;
  href: string;
  open: boolean;
  onToggle: () => void;
  onShowOnMap: () => void;
}) {
  const t = useTranslations('finder');
  const panelId = `workshop-panel-${w.slug}`;
  const paused = usePartnerStatus('workshop', w.slug).status === 'paused';
  return (
    <article
      className={`overflow-hidden rounded-tile border bg-surface transition-[box-shadow,border-color] duration-[var(--duration-base)] ${
        open
          ? 'border-accent-button shadow-card-hover'
          : 'border-line-card shadow-card hover:shadow-card-hover'
      }`}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          data-track={`finder_row_${w.slug}`}
          className="flex w-full items-center gap-3 p-2.5 pr-3 text-left"
        >
          <span className="relative size-16 shrink-0 overflow-hidden rounded-[10px] bg-pill">
            <Image src={workshopPhoto(w.slug)} alt="" fill sizes="64px" className="object-cover" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-heading text-[15px] leading-snug font-extrabold text-ink">
              {w.name}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                {w.area}
                {km !== null ? (
                  <span className="font-bold text-ink"> · {t('distance', { km: km.toFixed(1) })}</span>
                ) : (
                  <> · {w.pincode}</>
                )}
              </span>
            </span>
            <span className="mt-1 block text-xs font-bold text-ink">
              {t('from', { price: formatPrice(fromPricePaise(w)) })}
            </span>
            {paused ? (
              <span className="mt-1.5 inline-flex rounded-pill bg-warning-bg px-2.5 py-0.5 text-[11px] font-bold text-warning">
                {t('notTakingBookings')}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2">
            <span className="flex items-center gap-1 rounded-lg bg-success-bg px-2 py-1 text-xs font-bold text-success">
              <Star aria-hidden="true" className="size-3.5 fill-current" />
              {w.rating.toFixed(1)}
              <span className="sr-only">
                {t('rating', { rating: w.rating.toFixed(1), count: w.reviews })}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`size-5 text-muted transition-transform duration-[var(--duration-base)] ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-label={w.name}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-out-soft)] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-line px-3 pt-3 pb-3.5">
            <div className="relative aspect-[16/8] overflow-hidden rounded-[10px] bg-pill">
              {open ? (
                <Image
                  src={workshopPhoto(w.slug)}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 34vw, 92vw"
                  className="object-cover"
                />
              ) : null}
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
            <p className="mt-3 text-sm text-muted">
              {w.services
                .slice(0, 5)
                .map((sv) => sv.name)
                .join(' · ')}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onShowOnMap}
                className="press inline-flex min-h-11 items-center gap-1.5 rounded-button border border-input-border px-3 text-sm font-bold text-ink hover:bg-pill"
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
          </div>
        </div>
      </div>
    </article>
  );
}
