import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * Map styles (decision 2026-10-31: MapLibre + free OpenFreeMap vector tiles; 2026-11-01: hybrid view).
 *
 * Hybrid = satellite imagery underneath + OpenFreeMap roads, boundaries and place names on top. Imagery is not
 * free for commercial use from any major provider, so its tile URL and credit are configuration:
 * `NEXT_PUBLIC_SATELLITE_TILES` (`{z}/{x}/{y}` or `{z}/{y}/{x}` template) and `NEXT_PUBLIC_SATELLITE_ATTRIBUTION`.
 * Without them the LOCAL DEMO uses Esri World Imagery with its required credit; production must set a licensed
 * provider (inbox Q27) before launch.
 */
export const STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  /** Colourful roads (white/yellow) and haloed labels read well on imagery. */
  hybridBase: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

export type MapMode = 'map' | 'satellite';
export const MAP_MODE_KEY = 'mechdost-map-mode';

const DEMO_IMAGERY = {
  tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery © Esri, Vantor, Earthstar Geographics and the GIS User Community',
};

export function satelliteSource(env: { tiles?: string; attribution?: string } = {}) {
  const tiles = env.tiles?.trim() ? env.tiles.trim() : DEMO_IMAGERY.tiles;
  const attribution = env.attribution?.trim() ? env.attribution.trim() : DEMO_IMAGERY.attribution;
  return { tiles, attribution };
}

/** Layers that would cover the imagery (land, water, buildings) are hidden; roads, borders and labels stay. */
const COVERS = new Set(['background', 'fill', 'fill-extrusion', 'hillshade']);

export function toHybrid(
  style: StyleSpecification,
  imagery: { tiles: string; attribution: string } = satelliteSource(),
): StyleSpecification {
  const layers: LayerSpecification[] = style.layers.map((layer) =>
    COVERS.has(layer.type) ? { ...layer, layout: { ...(layer.layout ?? {}), visibility: 'none' } } : layer,
  );
  return {
    ...style,
    sources: {
      ...style.sources,
      'md-satellite': {
        type: 'raster',
        tiles: [imagery.tiles],
        tileSize: 256,
        maxzoom: 19,
        attribution: imagery.attribution,
      },
    },
    layers: [{ id: 'md-satellite', type: 'raster', source: 'md-satellite' }, ...layers],
  };
}

/**
 * Map labels in the page language (hard rule 10, user 2026-11-02: "NH30" and place names were English on `/hi`).
 * OpenFreeMap's OpenMapTiles-schema tiles carry `name`, `name:en`, `name_en` and `name:hi` on place, road, water
 * and POI labels. Hindi prefers `name:hi` and falls back to the local `name` (OSM in India is mostly Latin, so a
 * road without a Hindi name keeps its local name rather than disappearing). Road refs ("NH30") are codes and stay.
 *
 * Devanagari renders without extra glyphs: MapLibre GL JS ≥ 6.15 draws scripts that join letters with marks
 * (Devanagari, Thai, Khmer…) a grapheme cluster at a time with the browser's own fonts, even when the style has
 * a `glyphs` URL (decision 2026-11-02, verified on /hi/workshops).
 */
export function labelField(locale: string): ExpressionSpecification {
  return locale === 'hi'
    ? ['coalesce', ['get', 'name:hi'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];
}

/** True when a `text-field` reads any name property (`name`, `name:xx`, `name_xx`, legacy `{name…}` tokens). */
function readsName(value: unknown): boolean {
  if (typeof value === 'string') return /\{name(?:[:_][^}]*)?\}/.test(value);
  if (!Array.isArray(value)) return false;
  const [op, arg] = value as unknown[];
  if (op === 'get' && typeof arg === 'string') return /^name(?:[:_]|$)/.test(arg);
  return value.some(readsName);
}

/** Rewrites every name label to `labelField(locale)`; other symbol text (road refs, numbers) is untouched. */
export function localizeLabels(style: StyleSpecification, locale: string): StyleSpecification {
  const field = labelField(locale);
  return {
    ...style,
    layers: style.layers.map((layer): LayerSpecification => {
      if (layer.type !== 'symbol') return layer;
      const text = layer.layout?.['text-field'];
      if (text === undefined || !readsName(text)) return layer;
      return { ...layer, layout: { ...layer.layout, 'text-field': field } };
    }),
  };
}

/**
 * The viewer's own choice on this device wins; otherwise the admin's default (site settings, satellite unless
 * changed — user 2026-11-02).
 */
export function savedMapMode(fallback: MapMode = 'satellite'): MapMode {
  try {
    const saved = window.localStorage.getItem(MAP_MODE_KEY);
    return saved === 'map' || saved === 'satellite' ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function saveMapMode(mode: MapMode) {
  try {
    window.localStorage.setItem(MAP_MODE_KEY, mode);
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
}
