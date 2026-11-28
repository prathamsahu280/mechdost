/**
 * Pure maths behind the partner kit (`components/partner/*`, design 2026-11-27 "Partner portals UI upgrade" § 4).
 * No React, no DOM: unit-tested in `test/partner-kit.test.ts`.
 */

export interface OfferTimerState {
  /** Whole seconds left (0 once ended). */
  seconds: number;
  /** "m:ss" under an hour, "h:mm:ss" above. */
  text: string;
  /** Share of the window still left (1 → 0) for the tread bar; null when the window length is unknown. */
  fraction: number | null;
  /** Under a minute left: the timer turns amber and says "Hurry" in words. */
  urgent: boolean;
  ended: boolean;
  /** The moment a screen reader should be told about (only these three, never every second). */
  milestone: 'five' | 'one' | 'ended' | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * The offer timer from the server's end time. `windowMs` (the offer's full length) makes the bar fraction; without
 * it the timer shows text only. The milestone is the band the timer is in, so the live region speaks once per band.
 */
export function offerTimerState(
  endsAt: string | number | null,
  now: number,
  windowMs?: number | null,
): OfferTimerState | null {
  if (endsAt === null) return null;
  const end = typeof endsAt === 'number' ? endsAt : new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const leftMs = Math.max(0, end - now);
  const seconds = Math.ceil(leftMs / 1000);
  const ended = seconds === 0;
  const fraction = windowMs && windowMs > 0 ? Math.min(1, Math.max(0, leftMs / windowMs)) : null;
  const milestone = ended ? 'ended' : seconds <= 60 ? 'one' : seconds <= 300 ? 'five' : null;
  return { seconds, text: clockText(seconds), fraction, urgent: !ended && seconds <= 60, ended, milestone };
}

/** Ids that are in `ids` but were not in `before`. The first load (`before` null) is never "new". */
export function freshIds(before: ReadonlySet<string> | null, ids: readonly string[]): string[] {
  if (!before) return [];
  return ids.filter((id) => !before.has(id));
}

/** The lane in the URL when it is one of `lanes`, else the fallback (a stored or typed link never breaks the page). */
export function laneFrom<L extends string>(
  value: string | null | undefined,
  lanes: readonly L[],
  fallback: L,
): L {
  return value && (lanes as readonly string[]).includes(value) ? (value as L) : fallback;
}

/** A count from a paged list: "20+" when there is a next page, else the number. */
export function countText(n: number, hasMore: boolean): string {
  return hasMore ? `${n}+` : String(n);
}

export interface BulletGeometry {
  /** Your bar's width, 0–100 (% of the track). */
  valuePct: number;
  /** The city middle marker's position, 0–100, or null when there is no city middle. */
  cityPct: number | null;
}

/** Bullet bar: your value and the city middle on one track from 0 to `max` (at least both values, never 0). */
export function bulletGeometry(value: number, city: number | null, max?: number): BulletGeometry {
  const top = Math.max(max ?? 0, value, city ?? 0, Number.EPSILON);
  const pct = (n: number) => Math.round(Math.min(100, Math.max(0, (n / top) * 100)) * 10) / 10;
  return { valuePct: pct(value), cityPct: city === null ? null : pct(city) };
}

/** Whole minutes since `at` (never negative). */
export function minutesAgo(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / 60_000));
}

/** Per-device sound choice (a convenience, decision F3: on unless the partner turned it off). */
export const SOUND_STORAGE_KEY = 'mechdost.partner.sound';
export function soundOnFromStorage(raw: string | null): boolean {
  return raw !== 'off';
}

/**
 * Whether focus should move to the new page's heading after a route change: only when the partner used a tab
 * (`userInitiated`) and the path really changed. The first load (`prev` null) and back/forward never steal focus.
 */
export function tabFocusPlan(prev: string | null, next: string, userInitiated: boolean): boolean {
  return userInitiated && prev !== null && prev !== next;
}

/** The locale-free href of a master-detail row: keeps the lane and opens the item (`?lane=…&order=CODE`). */
export function masterRowHref(base: string, lane: string, param: 'order' | 'job', code: string): string {
  return `${base}?lane=${encodeURIComponent(lane)}&${param}=${encodeURIComponent(code)}`;
}

/**
 * Where focus goes when the selected item changes at ≥ 1024 px: a new selection moves it to the detail heading,
 * closing it returns it to the row that was open; the first render (`prev` undefined) and no change never move it.
 */
export function masterDetailFocusPlan(
  prev: string | null | undefined,
  next: string | null,
): 'detail' | 'row' | 'none' {
  if (prev === undefined || prev === next) return 'none';
  return next === null ? 'row' : 'detail';
}

/** The decoded element id a link's hash points at, or null when it has none. */
export function hashTargetId(href: string): string | null {
  const at = href.indexOf('#');
  if (at < 0 || at === href.length - 1) return null;
  try {
    return decodeURIComponent(href.slice(at + 1));
  } catch {
    return href.slice(at + 1);
  }
}
