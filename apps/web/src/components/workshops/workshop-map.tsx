'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type * as MapLibre from 'maplibre-gl';
import type { IControl, Map as MapLibreMap, Marker, Popup, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { track } from '@/lib/analytics';
import { directionsHref, type MapUi } from '@/lib/map-ui';
import {
  STYLE_URLS,
  localizeLabels,
  saveMapMode,
  savedMapMode,
  satelliteSource,
  toHybrid,
  type MapMode,
} from '@/lib/map-styles';

export interface MapPoint {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  href: string;
  detail: string;
  rating?: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

// Licensed imagery for production comes from configuration (lib/map-styles.ts, inbox Q27).
const IMAGERY = satelliteSource({
  tiles: process.env.NEXT_PUBLIC_SATELLITE_TILES,
  attribution: process.env.NEXT_PUBLIC_SATELLITE_ATTRIBUTION,
});
const RAIPUR: LatLng = { lat: 21.2514, lng: 81.6296 };
const FIT = { padding: 64, maxZoom: 14, duration: 700 };

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Touch screens keep two-finger panning so a one-finger swipe still scrolls the page (except full screen). */
function isTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Teardrop pin with a wrench, plus a name tooltip shown on hover and keyboard focus. */
function workshopPin(name: string, active: boolean): HTMLButtonElement {
  const button = el('button', `md-map-pin${active ? ' md-map-pin--active' : ''}`);
  button.type = 'button';
  button.setAttribute('aria-label', name);
  button.setAttribute('aria-pressed', String(active));
  const body = el('span', 'md-map-pin__body');
  body.setAttribute('aria-hidden', 'true');
  body.append(el('span', 'md-map-pin__glyph', '🔧'));
  const tip = el('span', 'md-map-pin__tip', name);
  tip.setAttribute('aria-hidden', 'true');
  button.append(body, tip);
  return button;
}

function userPin(label: string): HTMLSpanElement {
  const dot = el('span', 'md-map-user');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', label);
  return dot;
}

function popupCard(p: MapPoint, ui: MapUi): HTMLElement {
  const card = el('div', 'md-map-popup');
  const title = el('a', 'md-map-popup-title', p.name);
  title.href = p.href;
  card.append(title);
  if (p.rating !== undefined) {
    const rating = el('p', 'md-map-popup-rating');
    const star = el('span', 'md-map-popup-star', '★');
    star.setAttribute('aria-hidden', 'true');
    rating.append(star, ` ${p.rating.toFixed(1)}`);
    card.append(rating);
  }
  card.append(el('p', 'md-map-popup-detail', p.detail));
  const actions = el('div', 'md-map-popup-actions');
  const book = el('a', 'md-map-popup-book', ui.book);
  book.href = p.href;
  const directions = el('a', 'md-map-popup-directions', ui.directions);
  directions.href = directionsHref(p.lat, p.lng);
  directions.target = '_blank';
  directions.rel = 'noopener noreferrer';
  actions.append(book, directions);
  card.append(actions);
  return card;
}

/** Four-corner "fit" icon, built with DOM APIs so no icon library ships with the map. */
function fitIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const attrs: Record<string, string> = {
    'aria-hidden': 'true',
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  );
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', '12');
  dot.setAttribute('cy', '12');
  dot.setAttribute('r', '2.5');
  svg.append(path, dot);
  return svg;
}

/** Map / Satellite switch (hybrid view: imagery + roads + names), styled like MapLibre's controls. */
function modeControl(label: string, initial: MapMode, onChange: (mode: MapMode) => void): IControl {
  const group = el('div', 'maplibregl-ctrl maplibregl-ctrl-group');
  const button = el('button', 'md-map-mode');
  button.type = 'button';
  const icon = el('span', 'md-map-mode__icon', '🛰️');
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon, el('span', '', label));
  let mode = initial;
  button.setAttribute('aria-pressed', String(mode === 'satellite'));
  button.addEventListener('click', () => {
    mode = mode === 'satellite' ? 'map' : 'satellite';
    button.setAttribute('aria-pressed', String(mode === 'satellite'));
    onChange(mode);
  });
  group.append(button);
  return {
    onAdd: () => group,
    onRemove: () => {
      group.remove();
    },
  };
}

/** "Show all" button in MapLibre's control style. */
function showAllControl(label: string, onClick: () => void): IControl {
  const group = el('div', 'maplibregl-ctrl maplibregl-ctrl-group');
  const button = el('button', 'md-map-showall');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(fitIcon());
  button.addEventListener('click', onClick);
  group.append(button);
  return {
    onAdd: () => group,
    onRemove: () => {
      group.remove();
    },
  };
}

/**
 * Workshop map (decision 2026-10-31: MapLibre + free OSM-based tiles behind our own component). MapLibre is
 * loaded only when this component mounts (dynamic import), so other pages never pay for it.
 *
 * Fully interactive: drag, scroll/pinch zoom, keyboard (+/−/arrows), zoom buttons, full screen, "locate me"
 * (feeds the finder's distance sort through `onLocate`), "show all", scale bar. Pins are real buttons with names;
 * the list beside the map stays the accessible primary interface.
 */
export function WorkshopMap({
  points,
  origin,
  selected,
  onSelect,
  onLocate,
  label,
  youAreHere,
  ui,
  locale,
  className = '',
}: {
  points: MapPoint[];
  origin?: LatLng | null;
  selected?: string | null;
  onSelect?: (slug: string) => void;
  onLocate?: (position: LatLng) => void;
  label: string;
  youAreHere: string;
  ui: MapUi;
  /** Page language: map labels (places, roads) prefer it (`localizeLabels`). */
  locale: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const entries = useRef(new Map<string, { marker: Marker; pin: HTMLButtonElement; popup: Popup }>());
  const userMarker = useRef<Marker | null>(null);
  const selectedRef = useRef<string | null>(selected ?? null);
  const lastOrigin = useRef<LatLng | null>(null);
  const lastKey = useRef('');
  const lib = useRef<typeof MapLibre | null>(null);
  const select = useRef(onSelect);
  const locate = useRef(onLocate);
  const fitAll = useRef<() => void>(() => undefined);
  // Callers rebuild `ui` each render; read it through a ref so markers are not redrawn for that.
  const labels = useRef(ui);
  labels.current = ui;
  select.current = onSelect;
  locate.current = onLocate;
  const hasLocate = onLocate !== undefined;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    void import('maplibre-gl').then((maplibre) => {
      if (cancelled || !container.current) return;
      // Worker copied to /vendor by scripts/copy-map-worker.mjs (the bundler does not emit it).
      maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
      lib.current = maplibre;
      const touch = isTouch();
      // Every style (light, dark, hybrid) gets its labels in the page language.
      const mapStyle = {
        transformStyle: (_prev: unknown, next: StyleSpecification) => localizeLabels(next, locale),
      };
      const hybridStyle = {
        transformStyle: (_prev: unknown, next: StyleSpecification) =>
          localizeLabels(toHybrid(next, IMAGERY), locale),
      };
      const m = new maplibre.Map({
        container: container.current,
        style: STYLE_URLS[currentTheme()],
        ...mapStyle,
        center: [RAIPUR.lng, RAIPUR.lat],
        zoom: 11.5,
        minZoom: 4,
        maxZoom: 18,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: touch,
        attributionControl: { compact: true },
        locale: {
          'NavigationControl.ZoomIn': ui.zoomIn,
          'NavigationControl.ZoomOut': ui.zoomOut,
          'FullscreenControl.Enter': ui.fullscreen,
          'FullscreenControl.Exit': ui.exitFullscreen,
          'GeolocateControl.FindMyLocation': ui.locate,
          'GeolocateControl.LocationNotAvailable': ui.locationUnavailable,
          'CooperativeGesturesHandler.WindowsHelpText': ui.gestureWindows,
          'CooperativeGesturesHandler.MacHelpText': ui.gestureMac,
          'CooperativeGesturesHandler.MobileHelpText': ui.gestureMobile,
          'AttributionControl.ToggleAttribution': ui.attribution,
          'AttributionControl.MapFeedback': ui.mapFeedback,
          'Popup.Close': ui.closePopup,
          'Marker.Title': ui.marker,
          'Map.Title': ui.title,
          'ScaleControl.Kilometers': ui.kilometers,
          'ScaleControl.Meters': ui.meters,
        },
      });
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();

      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const fullscreen = new maplibre.FullscreenControl({});
      fullscreen.on('fullscreenstart', () => {
        m.cooperativeGestures.disable();
      });
      fullscreen.on('fullscreenend', () => {
        if (touch) m.cooperativeGestures.enable();
      });
      m.addControl(fullscreen, 'top-right');
      const geolocate = new maplibre.GeolocateControl({
        positionOptions: { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
        trackUserLocation: false,
        // The finder draws its own "you are here" marker from `origin`.
        showUserLocation: !hasLocate,
        showAccuracyCircle: false,
        fitBoundsOptions: { maxZoom: 14 },
      });
      geolocate.on('geolocate', (pos) => {
        track('map_action', { action: 'locate' });
        locate.current?.({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
      m.addControl(geolocate, 'top-right');
      m.addControl(
        showAllControl(ui.showAll, () => {
          track('map_action', { action: 'show_all' });
          fitAll.current();
        }),
        'top-right',
      );
      m.addControl(new maplibre.ScaleControl({ unit: 'metric', maxWidth: 96 }), 'bottom-left');
      map.current = m;

      // Map / Satellite (hybrid). Markers are DOM elements, so they survive every style swap.
      let mode: MapMode = savedMapMode();
      const applyStyle = () => {
        if (mode === 'satellite') {
          m.setStyle(STYLE_URLS.hybridBase, hybridStyle);
        } else {
          m.setStyle(STYLE_URLS[currentTheme()], mapStyle);
        }
      };
      if (mode === 'satellite') applyStyle();
      m.addControl(
        modeControl(ui.satellite, mode, (next) => {
          mode = next;
          track('map_action', { action: 'mode_change', mode: next });
          saveMapMode(next);
          applyStyle();
        }),
        'top-left',
      );

      // Follow the site theme toggle (the satellite view looks the same in both themes).
      observer = new MutationObserver(() => {
        if (mode === 'map') m.setStyle(STYLE_URLS[currentTheme()], mapStyle);
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      m.on('load', () => {
        m.resize();
        // Compact credits start expanded on small maps and cover pins; start collapsed (the ⓘ opens them).
        const credits = container.current?.querySelector('.maplibregl-ctrl-attrib');
        credits?.classList.remove('maplibregl-compact-show');
        credits?.removeAttribute('open');
      });
      // Popups use closeOnClick: false (a pin click re-renders and reopens one during the same click), so clicks
      // on empty map close them here instead.
      // Escape closes an open popup (dismissible content, WCAG 1.4.13).
      m.getContainer().addEventListener('keydown', (e) => {
        if (e.key === 'Escape') for (const entry of entries.current.values()) entry.popup.remove();
      });
      m.on('click', (e) => {
        const target = e.originalEvent.target;
        if (target instanceof Element && target.closest('.md-map-pin, .maplibregl-popup')) return;
        for (const entry of entries.current.values()) entry.popup.remove();
      });
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // Runs once: labels and locale are fixed for the page's lifetime (a language switch is a navigation).
  }, []);

  // Pins + the camera when the list or the user's position changes. Selection does NOT rebuild pins (bug
  // 2026-11-02: every "Show on map" destroyed and re-created all markers and the page jumped).
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const m = map.current;
      const maplibre = lib.current;
      if (!m || !maplibre) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      for (const entry of entries.current.values()) entry.marker.remove();
      entries.current.clear();
      userMarker.current?.remove();
      userMarker.current = null;
      const bounds = new maplibre.LngLatBounds();
      for (const p of points) {
        const pin = workshopPin(p.name, p.slug === selectedRef.current);
        pin.addEventListener('click', () => {
          // Same pin again (popup closed with ×): selection does not change, so reopen here.
          const again = entries.current.get(p.slug);
          if (p.slug === selectedRef.current && again && !again.popup.isOpen()) again.popup.addTo(m);
          select.current?.(p.slug);
        });
        const popup = new maplibre.Popup({
          offset: 30,
          closeButton: true,
          closeOnClick: false,
          // Opening a popup must not move keyboard focus or scroll the page (bug 2026-11-02).
          focusAfterOpen: false,
          anchor: 'bottom',
          maxWidth: '260px',
        })
          .setLngLat([p.lng, p.lat])
          .setDOMContent(popupCard(p, labels.current));
        // Popups are opened/closed only by the selection effect (a marker-owned popup toggled itself on the same
        // click and closed again).
        const marker = new maplibre.Marker({ element: pin, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .addTo(m);
        entries.current.set(p.slug, { marker, pin, popup });
        bounds.extend([p.lng, p.lat]);
      }
      if (origin) {
        userMarker.current = new maplibre.Marker({ element: userPin(youAreHere) })
          .setLngLat([origin.lng, origin.lat])
          .addTo(m);
        bounds.extend([origin.lng, origin.lat]);
      }
      fitAll.current = () => {
        for (const entry of entries.current.values()) entry.popup.remove();
        if (!bounds.isEmpty()) m.fitBounds(bounds, FIT);
      };

      // Camera follows intent (bug 2026-11-02: "use my location" kept flying to the selected workshop):
      // a new position (every locate press creates one) → centre on the user; a different list → fit all;
      // otherwise (same list, new distance labels) → leave the camera alone.
      const key = points.map((p) => p.slug).join('|');
      const focus = selectedRef.current ? entries.current.get(selectedRef.current) : undefined;
      if (origin && origin !== lastOrigin.current) {
        m.flyTo({ center: [origin.lng, origin.lat], zoom: Math.max(m.getZoom(), 14), duration: 800 });
      } else if (key !== lastKey.current) {
        if (focus && !focus.popup.isOpen()) focus.popup.addTo(m);
        if (!bounds.isEmpty()) m.fitBounds(bounds, FIT);
      }
      lastOrigin.current = origin ?? null;
      lastKey.current = key;
    };
    draw();
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [points, origin, youAreHere]);

  // Selection: restyle pins in place, open one popup, ease to the pin.
  useEffect(() => {
    selectedRef.current = selected ?? null;
    let frame = 0;
    const apply = () => {
      const m = map.current;
      if (!m || entries.current.size === 0) {
        frame = window.requestAnimationFrame(apply);
        return;
      }
      for (const [slug, entry] of entries.current) {
        const active = slug === selected;
        entry.pin.classList.toggle('md-map-pin--active', active);
        entry.pin.setAttribute('aria-pressed', String(active));
        if (!active) entry.popup.remove();
      }
      const focus = selected ? entries.current.get(selected) : undefined;
      if (!focus) return;
      if (!focus.popup.isOpen()) focus.popup.addTo(m);
      const at = focus.marker.getLngLat();
      // Sit the pin below centre so its popup (opening upwards) fits, even on a short phone map.
      m.easeTo({
        center: [at.lng, at.lat],
        offset: [0, Math.round(m.getContainer().clientHeight * 0.2)],
        zoom: Math.max(m.getZoom(), 13.5),
        duration: 700,
      });
    };
    apply();
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [selected]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className={`md-map relative overflow-hidden rounded-card border border-line-card bg-surface-alt shadow-card ${className}`}
    />
  );
}
