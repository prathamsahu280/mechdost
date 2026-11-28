import { istDateString } from '@mechdost/shared/time';

/**
 * Pure maths of the workshop Calendar tab (design 2026-11-27 § 6.4): a 7-day strip and one day's accepted visits by
 * hour, from the workshop's own `active` list (the rows carry `visitDate` and `visitHour` of the accepted proposal).
 * Every day is an IST calendar date (`YYYY-MM-DD`), never the device's time zone.
 */

const DAY_MS = 86_400_000;
export const CALENDAR_DAYS = 7;

/** Statuses whose visit is still ahead or under way: from the accepted proposal until the work is billed. */
const LIVE_VISIT = new Set([
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
  'ready',
  'billed',
]);

export interface VisitRow {
  code: string;
  status: string;
  visitDate?: string | null | undefined;
  visitHour?: number | null | undefined;
}

/** The IST dates of the strip: today and the six days after it. */
export function calendarDays(now: Date): string[] {
  const start = Date.parse(`${istDateString(now)}T00:00:00Z`);
  return Array.from({ length: CALENDAR_DAYS }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

const isVisit = (r: VisitRow): r is VisitRow & { visitDate: string } =>
  Boolean(r.visitDate) && LIVE_VISIT.has(r.status);

/** Visits per day for the days of the strip (days without a visit are absent). */
export function dayCounts(rows: readonly VisitRow[], days: readonly string[]): Record<string, number> {
  const inStrip = new Set(days);
  const out: Record<string, number> = {};
  for (const r of rows)
    if (isVisit(r) && inStrip.has(r.visitDate)) out[r.visitDate] = (out[r.visitDate] ?? 0) + 1;
  return out;
}

export interface AgendaGroup<T extends VisitRow> {
  /** Start hour (IST); null for an accepted visit with no hour (older proposals). */
  hour: number | null;
  jobs: T[];
}

/** One day's visits grouped by hour, earliest first; visits with no hour come last. */
export function agendaFor<T extends VisitRow>(rows: readonly T[], day: string): AgendaGroup<T>[] {
  const groups = new Map<number | null, T[]>();
  for (const r of rows) {
    if (!isVisit(r) || r.visitDate !== day) continue;
    const hour = r.visitHour ?? null;
    groups.set(hour, [...(groups.get(hour) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([hour, jobs]) => ({ hour, jobs }));
}

/** `?day=` when it is one of the strip's days, else today (the first day). */
export function pickDay(param: string | null, days: readonly string[]): string {
  return days.find((d) => d === param) ?? days[0] ?? '';
}

/** "09:00" on the 24-hour clock: numerals only, so it reads the same in Hindi. */
export const hourText = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** One open hour of a workshop day: the places it offers and how many are still free (`GET /workshop/slots`). */
export interface HourSlot {
  hour: number;
  capacity: number;
  free: number;
}

/** Several workshops' hours added up hour by hour (the agenda already merges all of the owner's workshops). */
export function combineSlots(lists: readonly (readonly HourSlot[])[]): HourSlot[] {
  const byHour = new Map<number, HourSlot>();
  for (const s of lists.flat()) {
    const at = byHour.get(s.hour);
    byHour.set(
      s.hour,
      at
        ? { hour: s.hour, capacity: at.capacity + s.capacity, free: at.free + s.free }
        : { hour: s.hour, capacity: s.capacity, free: s.free },
    );
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

export interface CapacityGroup<T extends VisitRow> extends AgendaGroup<T> {
  /** Free places of that hour; absent when the workshop is closed then or for the "time not set" group. */
  places?: HourSlot;
}

/** The agenda with each hour's free places, plus open hours that have no visit yet; "time not set" stays last. */
export function agendaWithCapacity<T extends VisitRow>(
  agenda: readonly AgendaGroup<T>[],
  slots: readonly HourSlot[],
): CapacityGroup<T>[] {
  const hours = new Set<number>(slots.map((s) => s.hour));
  for (const g of agenda) if (g.hour !== null) hours.add(g.hour);
  const rows: CapacityGroup<T>[] = [...hours]
    .sort((a, b) => a - b)
    .map((hour) => {
      const places = slots.find((s) => s.hour === hour);
      return {
        hour,
        jobs: agenda.find((g) => g.hour === hour)?.jobs ?? [],
        ...(places ? { places } : {}),
      };
    });
  const unset = agenda.find((g) => g.hour === null);
  return unset ? [...rows, { hour: null, jobs: unset.jobs }] : rows;
}
