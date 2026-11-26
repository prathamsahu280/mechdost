'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from 'maplibre-gl';

type Ring = [number, number][];
interface PolygonFeature {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: Ring[] };
}
import { useLocale } from 'next-intl';
import { useEffect, useRef } from 'react';
import { STYLE_URLS, localizeLabels } from '@/lib/map-styles';
import type { LatLng } from '@/lib/ustaad/local-view';

const RAIPUR: LatLng = { lat: 21.2514, lng: 81.6296 };

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme;
  return explicit === 'dark' ? 'dark' : 'light';
}

/** A circle of `radiusM` metres as a 48-point polygon (the GPS accuracy circle). */
function circle(c: LatLng, radiusM: number): PolygonFeature {
  const pts: Ring = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

/**
 * The garage pin map (spec 23 § 4 flow 10): MapLibre with the site's styles and labels in the page's language, a
 * draggable pin, tap-to-place, and the GPS accuracy circle. Loaded only on the pin screen (dynamic import), so no other
 * page pays for MapLibre. Arrow buttons beside the map (the screen's) are the single-pointer alternative to dragging.
 */
export default function PinMap({
  value,
  accuracy,
  label,
  markerLabel,
  onChange,
}: {
  value: LatLng | null;
  /** The GPS fix whose accuracy circle is drawn (null = none). */
  accuracy: (LatLng & { accuracyM: number }) | null;
  label: string;
  markerLabel: string;
  onChange: (p: LatLng) => void;
}) {
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const latest = useRef({ value, accuracy });
  latest.current = { value, accuracy };

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((maplibre) => {
      if (cancelled || !container.current) return;
      maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
      const start = latest.current.value ?? RAIPUR;
      const m = new maplibre.Map({
        container: container.current,
        style: STYLE_URLS[currentTheme()],
        transformStyle: (_prev: unknown, next: StyleSpecification) => localizeLabels(next, locale),
        center: [start.lng, start.lat],
        zoom: latest.current.value ? 16.5 : 11.5,
        minZoom: 4,
        maxZoom: 19,
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

      const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#ea5728';
      m.on('load', () => {
        m.addSource('acc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'acc-fill',
          type: 'fill',
          source: 'acc',
          paint: { 'fill-color': accent, 'fill-opacity': 0.15 },
        });
        m.addLayer({
          id: 'acc-line',
          type: 'line',
          source: 'acc',
          paint: { 'line-color': accent, 'line-width': 2, 'line-opacity': 0.6 },
        });
        drawAccuracy();
      });

      const pinEl = document.createElement('div');
      pinEl.className = 'md-map-pin md-map-pin--active';
      pinEl.setAttribute('role', 'img');
      pinEl.setAttribute('aria-label', markerLabel);
      const body = document.createElement('span');
      body.className = 'md-map-pin__body';
      body.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span');
      glyph.className = 'md-map-pin__glyph';
      glyph.textContent = '🔧';
      body.append(glyph);
      pinEl.append(body);
      const mk = new maplibre.Marker({ element: pinEl, draggable: true, anchor: 'bottom' });
      mk.on('dragend', () => {
        const { lat, lng } = mk.getLngLat();
        change.current({ lat, lng });
      });
      marker.current = mk;
      if (latest.current.value) mk.setLngLat([latest.current.value.lng, latest.current.value.lat]).addTo(m);
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
    // Created once; the pin and the circle follow the props below.
  }, []);

  function drawAccuracy() {
    const src = map.current?.getSource<GeoJSONSource>('acc');
    const a = latest.current.accuracy;
    void src?.setData(a ? circle(a, a.accuracyM) : { type: 'FeatureCollection', features: [] });
  }

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (value) {
      marker.current?.setLngLat([value.lng, value.lat]).addTo(m);
      m.easeTo({ center: [value.lng, value.lat], zoom: Math.max(m.getZoom(), 16), duration: 300 });
    }
  }, [value]);

  useEffect(() => {
    drawAccuracy();
  }, [accuracy]);

  return (
    <div
      ref={container}
      role="group"
      aria-label={label}
      className="h-[300px] w-full overflow-hidden rounded-2xl border border-line-card bg-surface-alt tab:h-[360px]"
    />
  );
}
