'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type * as MapLibre from 'maplibre-gl';
import type { IControl, Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { directionsHref, type MapUi } from '@/lib/map-ui';

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

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
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

/** Lucide "wrench" (same glyph as the site's workshop icon), drawn with DOM APIs because pins are not React. */
const WRENCH_PATH =
  'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z';

function wrenchIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'md-map-pin__glyph');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', WRENCH_PATH);
  svg.append(path);
  return svg;
}

/** Teardrop pin with a wrench, plus a name tooltip shown on hover and keyboard focus. */
function workshopPin(name: string, active: boolean): HTMLButtonElement {
  const button = el('button', `md-map-pin${active ? ' md-map-pin--active' : ''}`);
  button.type = 'button';
  button.setAttribute('aria-label', name);
  button.setAttribute('aria-pressed', String(active));
  const body = el('span', 'md-map-pin__body');
  body.setAttribute('aria-hidden', 'true');
  body.append(wrenchIcon());
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
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const popups = useRef<Popup[]>([]);
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
      const m = new maplibre.Map({
        container: container.current,
        style: STYLES[currentTheme()],
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
        locate.current?.({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
      m.addControl(geolocate, 'top-right');
      m.addControl(
        showAllControl(ui.showAll, () => {
          fitAll.current();
        }),
        'top-right',
      );
      m.addControl(new maplibre.ScaleControl({ unit: 'metric', maxWidth: 96 }), 'bottom-left');
      map.current = m;

      // Follow the site theme toggle. Markers are DOM elements, so they survive the style swap.
      observer = new MutationObserver(() => {
        m.setStyle(STYLES[currentTheme()]);
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
        if (e.key === 'Escape') for (const popup of popups.current) popup.remove();
      });
      m.on('click', (e) => {
        const target = e.originalEvent.target;
        if (target instanceof Element && target.closest('.md-map-pin, .maplibregl-popup')) return;
        for (const popup of popups.current) popup.remove();
      });
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // Runs once: labels are fixed for the page's lifetime (a language switch is a navigation).
  }, []);

  // Markers + camera whenever the list, origin or selection changes.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const m = map.current;
      const maplibre = lib.current;
      if (!m || !maplibre) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      for (const mk of markers.current) mk.remove();
      markers.current = [];
      const bounds = new maplibre.LngLatBounds();
      popups.current = [];
      for (const p of points) {
        const active = p.slug === selected;
        const pin = workshopPin(p.name, active);
        pin.addEventListener('click', () => {
          select.current?.(p.slug);
        });
        const popup = new maplibre.Popup({
          offset: 30,
          closeButton: true,
          closeOnClick: false,
          anchor: 'bottom',
          maxWidth: '260px',
        }).setDOMContent(popupCard(p, labels.current));
        const marker = new maplibre.Marker({ element: pin, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .setPopup(popup)
          .addTo(m);
        popups.current.push(popup);
        if (active) marker.togglePopup();
        markers.current.push(marker);
        bounds.extend([p.lng, p.lat]);
      }
      if (origin) {
        const you = new maplibre.Marker({ element: userPin(youAreHere) })
          .setLngLat([origin.lng, origin.lat])
          .addTo(m);
        markers.current.push(you);
        bounds.extend([origin.lng, origin.lat]);
      }
      fitAll.current = () => {
        for (const popup of popups.current) popup.remove();
        if (!bounds.isEmpty()) m.fitBounds(bounds, FIT);
      };
      const focus = points.find((p) => p.slug === selected);
      if (focus) {
        // Sit the pin below centre so its popup (opening upwards) fits, even on a short phone map.
        m.easeTo({
          center: [focus.lng, focus.lat],
          offset: [0, Math.round(m.getContainer().clientHeight * 0.2)],
          zoom: Math.max(m.getZoom(), 13.5),
          duration: 700,
        });
      } else if (!bounds.isEmpty()) {
        m.fitBounds(bounds, FIT);
      }
    };
    draw();
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [points, origin, selected, youAreHere]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className={`md-map relative overflow-hidden rounded-card border border-line-card bg-surface-alt shadow-card ${className}`}
    />
  );
}
