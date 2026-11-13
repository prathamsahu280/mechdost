'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker, StyleSpecification } from 'maplibre-gl';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { STYLE_URLS, localizeLabels } from '@/lib/map-styles';

export interface PickPoint {
  lat: number;
  lng: number;
}

const RAIPUR: PickPoint = { lat: 21.2514, lng: 81.6296 };

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * The map inside the seller location dialog (plan 2026-11-13 Task 6). MapLibre is imported only when this mounts
 * (the dialog is opened). Tapping the map moves the pin (the single-pointer alternative to dragging, WCAG 2.5.7);
 * dragging the pin works too. `center` recentres the map and the pin when search or "use my location" set it.
 */
export function LocationMap({
  center,
  locale,
  label,
  onPick,
  onFail,
}: {
  center: PickPoint | null;
  locale: string;
  label: string;
  onPick: (point: PickPoint) => void;
  onFail: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const pick = useRef(onPick);
  // Values the map is created with (once per opening of the dialog); later centres move it (effect below).
  const mapT = useTranslations('map');
  // Control labels in the page's language (hard rule 10; the workshop map does the same).
  const controls = {
    'NavigationControl.ZoomIn': mapT('zoomIn'),
    'NavigationControl.ZoomOut': mapT('zoomOut'),
    'AttributionControl.ToggleAttribution': mapT('attribution'),
  };
  const init = useRef({ center, locale, label, onFail, controls });
  useEffect(() => {
    pick.current = onPick;
  });

  useEffect(() => {
    let cancelled = false;
    import('maplibre-gl')
      .then((maplibre) => {
        if (cancelled || !container.current) return;
        const { center, locale, label, onFail, controls } = init.current;
        maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
        const start = center ?? RAIPUR;
        const m = new maplibre.Map({
          container: container.current,
          style: STYLE_URLS[currentTheme()],
          transformStyle: (_prev: unknown, next: StyleSpecification) => localizeLabels(next, locale),
          center: [start.lng, start.lat],
          zoom: center ? 16 : 12,
          minZoom: 4,
          maxZoom: 19,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
          locale: controls,
        });
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        const pin = new maplibre.Marker({ draggable: true, color: '#ea5728' })
          .setLngLat([start.lng, start.lat])
          .addTo(m);
        pin.getElement().setAttribute('aria-label', label);
        pin.on('dragend', () => {
          const p = pin.getLngLat();
          pick.current({ lat: p.lat, lng: p.lng });
        });
        m.on('click', (e) => {
          pin.setLngLat(e.lngLat);
          pick.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
        m.on('error', () => {
          if (!m.loaded()) onFail();
        });
        map.current = m;
        marker.current = pin;
      })
      .catch(() => {
        init.current.onFail();
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!center || !map.current || !marker.current) return;
    marker.current.setLngLat([center.lng, center.lat]);
    map.current.flyTo({ center: [center.lng, center.lat], zoom: 16, duration: 600 });
  }, [center]);

  return (
    <div
      ref={container}
      className="h-72 w-full overflow-hidden rounded-card border border-line-card tab:h-96"
    />
  );
}
