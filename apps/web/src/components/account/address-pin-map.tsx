'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker, StyleSpecification } from 'maplibre-gl';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { STYLE_URLS, localizeLabels } from '@/lib/map-styles';

export interface PinPoint {
  lat: number;
  lng: number;
}

const RAIPUR: PinPoint = { lat: 21.2514, lng: 81.6296 };
/** One arrow-key press moves the pin about 20 m. */
const NUDGE = 0.0002;
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return 'light'; // light by default (user 2026-11-23)
}

/**
 * The map pin step of the address form (home servicing, spec 06): tap the map or drag the pin to place it, or use
 * the device location; arrow keys nudge the focused pin; "Remove the pin" clears it. MapLibre loads only when this
 * component mounts (dynamic import, same adapter and styles as the workshop map), so other account pages never pay for
 * it. The pin is optional: an address without one still works for orders, it just cannot book a home visit.
 */
export function AddressPinMap({
  value,
  onChange,
}: {
  value: PinPoint | null;
  onChange: (next: PinPoint | null) => void;
}) {
  const t = useTranslations('homeService');
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const place = useRef<(p: PinPoint) => void>(() => undefined);
  const change = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  change.current = onChange;
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((maplibre) => {
      if (cancelled || !container.current) return;
      maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
      const m = new maplibre.Map({
        container: container.current,
        style: STYLE_URLS[currentTheme()],
        transformStyle: (_prev: unknown, next: StyleSpecification) => localizeLabels(next, locale),
        center: [(latest.current ?? RAIPUR).lng, (latest.current ?? RAIPUR).lat],
        zoom: latest.current ? 15 : 11.5,
        minZoom: 4,
        maxZoom: 18,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: window.matchMedia('(pointer: coarse)').matches,
        attributionControl: { compact: true },
      });
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.current = m;

      const pinEl = document.createElement('button');
      pinEl.type = 'button';
      pinEl.className = 'md-map-pin md-map-pin--active';
      pinEl.setAttribute('aria-label', t('pinMarkerLabel'));
      const body = document.createElement('span');
      body.className = 'md-map-pin__body';
      body.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span');
      glyph.className = 'md-map-pin__glyph';
      glyph.textContent = '🏠';
      body.append(glyph);
      pinEl.append(body);
      pinEl.addEventListener('keydown', (e) => {
        const at = latest.current;
        if (!at) return;
        const delta: Record<string, [number, number]> = {
          ArrowUp: [NUDGE, 0],
          ArrowDown: [-NUDGE, 0],
          ArrowLeft: [0, -NUDGE],
          ArrowRight: [0, NUDGE],
        };
        const d = delta[e.key];
        if (!d) return;
        e.preventDefault();
        change.current({ lat: at.lat + d[0], lng: at.lng + d[1] });
      });
      const mk = new maplibre.Marker({ element: pinEl, draggable: true, anchor: 'bottom' });
      mk.on('dragend', () => {
        const { lat, lng } = mk.getLngLat();
        change.current({ lat, lng });
      });
      marker.current = mk;
      place.current = (p) => {
        mk.setLngLat([p.lng, p.lat]).addTo(m);
      };
      if (latest.current) place.current(latest.current);
      m.on('click', (e) => {
        change.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    });
    return () => {
      cancelled = true;
      marker.current?.remove();
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // The map is created once; the pin follows `value` below.
  }, []);

  useEffect(() => {
    if (value) {
      place.current(value);
      map.current?.easeTo({ center: [value.lng, value.lat], duration: 300 });
    } else marker.current?.remove();
  }, [value]);

  function useLocation() {
    if (!('geolocation' in navigator)) {
      setDenied(true);
      return;
    }
    setLocating(true);
    setDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.current?.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16, duration: 500 });
      },
      () => {
        setLocating(false);
        setDenied(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <fieldset className="tab:col-span-2">
      <legend className="text-sm font-bold text-ink">{t('pinTitle')}</legend>
      <p className="mt-1 text-xs text-muted">{t('pinHelp')}</p>
      <div
        ref={container}
        role="application"
        aria-label={t('pinMapLabel')}
        className="mt-2 h-[260px] w-full overflow-hidden rounded-card border border-line-card bg-surface-alt"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-track="address_pin_use_location"
          onClick={useLocation}
          disabled={locating}
          className={quiet}
        >
          {locating ? t('pinLocating') : t('pinUseLocation')}
        </button>
        {value ? (
          <button
            type="button"
            data-track="address_pin_remove"
            onClick={() => {
              onChange(null);
            }}
            className={quiet}
          >
            {t('pinRemove')}
          </button>
        ) : null}
        <p role="status" className="text-sm font-bold text-ink">
          {value ? t('pinSet') : t('pinNone')}
        </p>
      </div>
      {denied ? <p className="mt-1 text-sm font-bold text-error">{t('pinDenied')}</p> : null}
    </fieldset>
  );
}
