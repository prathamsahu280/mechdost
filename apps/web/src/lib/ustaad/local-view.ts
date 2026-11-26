import { formatPrice } from '../format';

/**
 * Pure helpers for the local screens (spec 23 § 4 flows 10–11, § 9.6): pin my garage, the area map and jobs. Counts
 * are shown exactly as the server banded them; nothing here sums, subtracts or derives a count (SR-31).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** GPS readings worse than `loc.gps_max_m` are not a pin: the member places it by hand and adds a landmark. */
export function gpsIsWeak(accuracyM: number, maxM: number): boolean {
  return accuracyM > maxM;
}

/** `ustaad_location_confirmed.accuracyBand` (never the metres). */
export function accuracyBand(accuracyM: number): 'lt20' | '20to50' | '50to100' | 'gt100' {
  if (accuracyM < 20) return 'lt20';
  if (accuracyM < 50) return '20to50';
  if (accuracyM <= 100) return '50to100';
  return 'gt100';
}

const METRES_PER_DEG_LAT = 111_320;
export const NUDGE_M = 10;
export type NudgeDir = 'up' | 'down' | 'left' | 'right';

/** Moves the pin about `NUDGE_M` metres (the arrow buttons; a single-pointer alternative to dragging). */
export function nudge(p: LatLng, dir: NudgeDir, metres = NUDGE_M): LatLng {
  const dLat = metres / METRES_PER_DEG_LAT;
  const dLng = metres / (METRES_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
  switch (dir) {
    case 'up':
      return { lat: p.lat + dLat, lng: p.lng };
    case 'down':
      return { lat: p.lat - dLat, lng: p.lng };
    case 'left':
      return { lat: p.lat, lng: p.lng - dLng };
    case 'right':
      return { lat: p.lat, lng: p.lng + dLng };
  }
}

export type Banded = { kind: 'few' } | { kind: 'band'; value: number } | { kind: 'exact'; value: number };

/** What the area card says: "Few mechanics nearby", "5+ mechanics" or "25 mechanics". */
export function zoneText(b: Banded): { key: 'few' } | { key: 'band' | 'exact'; n: number } {
  return b.kind === 'few' ? { key: 'few' } : { key: b.kind, n: b.value };
}

/** Shade step for the stylised map (0 lightest … 3 darkest); colour is never the only signal (text beside it). */
export function zoneShade(b: Banded): 0 | 1 | 2 | 3 {
  if (b.kind === 'few') return 0;
  if (b.kind === 'band') return 1;
  return b.value >= 50 ? 3 : 2;
}

/** Zone centres → points in a `width` × `height` drawing with `pad` margin, north up; one zone sits in the middle. */
export function projectZones(
  centres: readonly LatLng[],
  width: number,
  height: number,
  pad: number,
): { x: number; y: number }[] {
  if (centres.length === 0) return [];
  const lats = centres.map((c) => c.lat);
  const lngs = centres.map((c) => c.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  return centres.map((c) => ({
    x: spanLng === 0 ? width / 2 : Math.round(pad + ((c.lng - minLng) / spanLng) * (width - 2 * pad)),
    y: spanLat === 0 ? height / 2 : Math.round(pad + ((maxLat - c.lat) / spanLat) * (height - 2 * pad)),
  }));
}

/** "₹12,000 – ₹18,000" (a month), or one amount when both ends are equal. */
export function payRangeText(minPaise: number, maxPaise: number): string {
  return minPaise === maxPaise
    ? formatPrice(minPaise)
    : `${formatPrice(minPaise)} – ${formatPrice(maxPaise)}`;
}

/** Whole rupees typed by an employer (commas allowed) → paise; null when empty, zero, fractional or not a number. */
export function rupeesToPaise(raw: string): number | null {
  const clean = raw.replace(/[,\s]/g, '');
  if (!/^\d{1,7}$/.test(clean)) return null;
  const rupees = Number(clean);
  return rupees > 0 ? rupees * 100 : null;
}
