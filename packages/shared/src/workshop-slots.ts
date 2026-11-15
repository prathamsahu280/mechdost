/**
 * Hourly workshop slots (spec 06, workshops tier 1; design 2026-11-15). Zod-free, so the database package may import it.
 * A slot is the IST start hour of a whole hour inside the workshop's opening window on a weekday it is open.
 */
import type { ServiceSlot } from './service-requests';

/** Bookings an hour takes unless the owner changes it (spec decision: default 2). */
export const DEFAULT_SLOT_CAPACITY = 2;
export const MAX_SLOT_CAPACITY = 20;
/** A customer may move a booking at most this many times (abuse and workshop-annoyance guard). */
export const MAX_RESCHEDULES = 2;
/** How long a request waits for the workshop before going back to routing (setting `service.acceptance_timeout_min`). */
export const DEFAULT_ACCEPTANCE_TIMEOUT_MIN = 60;

export interface OpeningHours {
  open: string;
  close: string;
  days: readonly number[];
}

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 0 = Sunday, from an IST calendar date (no time zone maths: a calendar date has one weekday everywhere). */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** The part of the day an hour belongs to, so older screens that show morning / afternoon / evening keep working. */
export function slotOfHour(hour: number): ServiceSlot {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** Start hours of the whole hours a workshop is open on `isoDate` (empty on its closed days). */
export function openSlotHours(hours: OpeningHours, isoDate: string): number[] {
  if (!hours.days.includes(weekdayOf(isoDate))) return [];
  const first = Math.ceil(minutesOf(hours.open) / 60);
  const last = Math.floor(minutesOf(hours.close) / 60) - 1;
  const out: number[] = [];
  for (let h = first; h <= last; h += 1) out.push(h);
  return out;
}
