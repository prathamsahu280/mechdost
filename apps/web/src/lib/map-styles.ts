import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

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

/** Satellite (hybrid) is the default view (user 2026-11-02); a saved "map" choice is remembered. */
export function savedMapMode(): MapMode {
  try {
    return window.localStorage.getItem(MAP_MODE_KEY) === 'map' ? 'map' : 'satellite';
  } catch {
    return 'satellite';
  }
}

export function saveMapMode(mode: MapMode) {
  try {
    window.localStorage.setItem(MAP_MODE_KEY, mode);
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
}
