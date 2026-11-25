import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SEGMENT_SORT,
  DEFAULT_SEGMENT_TEXT,
  VEHICLE_SEGMENTS,
  type VehicleSegment,
} from '@mechdost/shared/vehicle-segments';

/**
 * DEMO vehicle segments (design 2026-11-25, spec 08): the names, order and on/off switch the admin edits, kept in this
 * browser's localStorage so the demo admin works without the API. Only the shop's filter chips read it (the cards and
 * the home tiles are server-rendered, and in the live site both read the database). The built-in texts and order come
 * from `@mechdost/shared/vehicle-segments`, which the migration seeds the real table from.
 */
export const DEMO_SEGMENTS_KEY = 'mechdost-demo-segments';
const CHANGED = 'mechdost-demo-segments-changed';

export interface DemoSegmentRow {
  code: VehicleSegment;
  nameEn: string;
  nameHi: string;
  descriptionEn: string;
  descriptionHi: string;
  sort: number;
  active: boolean;
}

export const DEFAULT_DEMO_SEGMENTS: readonly DemoSegmentRow[] = VEHICLE_SEGMENTS.map((code) => ({
  code,
  ...DEFAULT_SEGMENT_TEXT[code],
  sort: DEFAULT_SEGMENT_SORT[code],
  active: true,
}));

function parse(raw: string | null): readonly DemoSegmentRow[] {
  if (!raw) return DEFAULT_DEMO_SEGMENTS;
  try {
    const saved = JSON.parse(raw) as Partial<Record<VehicleSegment, Partial<DemoSegmentRow>>>;
    return DEFAULT_DEMO_SEGMENTS.map((row) => {
      const mine = saved[row.code];
      if (!mine) return row;
      return {
        ...row,
        nameEn:
          typeof mine.nameEn === 'string' && mine.nameEn.trim()
            ? mine.nameEn.trim().slice(0, 60)
            : row.nameEn,
        nameHi:
          typeof mine.nameHi === 'string' && mine.nameHi.trim()
            ? mine.nameHi.trim().slice(0, 60)
            : row.nameHi,
        descriptionEn:
          typeof mine.descriptionEn === 'string' ? mine.descriptionEn.slice(0, 120) : row.descriptionEn,
        descriptionHi:
          typeof mine.descriptionHi === 'string' ? mine.descriptionHi.slice(0, 120) : row.descriptionHi,
        sort: typeof mine.sort === 'number' && Number.isFinite(mine.sort) ? mine.sort : row.sort,
        active: typeof mine.active === 'boolean' ? mine.active : row.active,
      };
    });
  } catch {
    return DEFAULT_DEMO_SEGMENTS; // a hand-edited value never breaks the shop
  }
}

let cache: { raw: string | null; rows: readonly DemoSegmentRow[] } = {
  raw: null,
  rows: DEFAULT_DEMO_SEGMENTS,
};

function snapshot(): readonly DemoSegmentRow[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(DEMO_SEGMENTS_KEY);
  } catch {
    raw = null; // storage blocked: the defaults
  }
  if (raw !== cache.raw) cache = { raw, rows: parse(raw) };
  return cache.rows;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** Every segment (active or not) in the admin's order. */
export function useDemoSegments(): readonly DemoSegmentRow[] {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_DEMO_SEGMENTS);
}

/** In the admin's order, switched-off ones left out. */
export function activeDemoSegments(rows: readonly DemoSegmentRow[]): DemoSegmentRow[] {
  return rows.filter((r) => r.active).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
}

/** Saves the whole set (the editor sends every row). Returns false when the browser refuses to store it. */
export function saveDemoSegments(rows: readonly DemoSegmentRow[]): boolean {
  try {
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    window.localStorage.setItem(DEMO_SEGMENTS_KEY, JSON.stringify(byCode));
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch {
    return false;
  }
}
