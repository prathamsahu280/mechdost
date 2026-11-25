import { DEFAULT_SEGMENT_TEXT, type VehicleSegment } from '@mechdost/shared/vehicle-segments';
import type { Locale } from '@/i18n/routing';
import { DATA_MODE } from '@/lib/data-mode';
import { fetchCatalogueSegments } from './api-source';

/** The segments the home "Shop by vehicle" section shows, in this order (design 2026-11-25). */
export const HOME_SEGMENT_CODES: readonly VehicleSegment[] = [
  'truck_bus',
  'tractor_farm',
  'construction_otr',
];

export interface HomeSegmentTile {
  code: VehicleSegment;
  name: string;
  description: string | null;
  /** Live products with it; null when the source does not know (demo). */
  count: number | null;
}

/**
 * The tiles: from the segment table in API mode (so a rename, a switch-off or a new count shows), from the built-in
 * texts in the demo. A segment staff switched off, or an unreachable API, leaves its tile out; no tiles = no section.
 */
export async function homeSegmentTiles(locale: Locale): Promise<HomeSegmentTile[]> {
  if (DATA_MODE !== 'api')
    return HOME_SEGMENT_CODES.map((code) => {
      const text = DEFAULT_SEGMENT_TEXT[code];
      return {
        code,
        name: locale === 'hi' ? text.nameHi : text.nameEn,
        description: locale === 'hi' ? text.descriptionHi : text.descriptionEn,
        count: null,
      };
    });
  try {
    const all = await fetchCatalogueSegments(locale);
    return HOME_SEGMENT_CODES.flatMap((code) => {
      const row = all.find((s) => s.code === code);
      return row ? [{ code, name: row.name, description: row.description, count: row.count }] : [];
    });
  } catch {
    return [];
  }
}
