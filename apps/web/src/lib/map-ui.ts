/**
 * Map UI copy (locale namespace `map`). Kept free of MapLibre imports so server pages can build the labels and
 * pass them to the client map as plain props.
 */
export const MAP_UI_KEYS = [
  'zoomIn',
  'zoomOut',
  'fullscreen',
  'exitFullscreen',
  'locate',
  'locationUnavailable',
  'showAll',
  'gestureWindows',
  'gestureMac',
  'gestureMobile',
  'attribution',
  'title',
  'kilometers',
  'meters',
  'directions',
  'book',
] as const;

export type MapUiKey = (typeof MAP_UI_KEYS)[number];
export type MapUi = Record<MapUiKey, string>;

export function mapUi(t: (key: MapUiKey) => string): MapUi {
  return Object.fromEntries(MAP_UI_KEYS.map((key) => [key, t(key)])) as MapUi;
}

/** Google Maps turn-by-turn link; works in every browser and opens the app on phones. */
export function directionsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
