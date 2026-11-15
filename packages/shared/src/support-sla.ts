/**
 * Support first-reply SLA (design 2026-11-15 "Support next tier", item 4; spec 09). The target is a number of
 * working minutes inside the support hours (admin settings, IST wall clock, every day of the week): a request that
 * arrives outside the hours starts counting at the next opening. IST has no DST, so the arithmetic is exact.
 */
import { istDateString, istStartOfDay } from './time';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface SupportHours {
  /** Opening, minutes after IST midnight (9:00 = 540). */
  startMinute: number;
  /** Closing, minutes after IST midnight (21:00 = 1260); after the opening. */
  endMinute: number;
}

export const DEFAULT_SUPPORT_HOURS: SupportHours = { startMinute: 540, endMinute: 1260 };
export const DEFAULT_FIRST_REPLY_MINUTES = 120;

/** Hours that cannot work (empty or inverted window) fall back to the defaults instead of looping or never ending. */
export function sanitiseHours(hours: SupportHours): SupportHours {
  const ok =
    Number.isInteger(hours.startMinute) &&
    Number.isInteger(hours.endMinute) &&
    hours.startMinute >= 0 &&
    hours.endMinute <= 1440 &&
    hours.startMinute < hours.endMinute;
  return ok ? hours : DEFAULT_SUPPORT_HOURS;
}

/** The instant `minutes` working minutes after `from`, counting only inside the support hours (IST). */
export function addWorkingMinutes(from: Date, minutes: number, hoursIn: SupportHours): Date {
  const hours = sanitiseHours(hoursIn);
  let remaining = Math.max(0, minutes) * MINUTE_MS;
  let cursor = from.getTime();
  // At most one pass per day; the setting caps the target at 1,440 minutes, so a few passes suffice.
  for (let guard = 0; guard < 400; guard++) {
    const dayStart = istStartOfDay(istDateString(new Date(cursor))).getTime();
    const open = dayStart + hours.startMinute * MINUTE_MS;
    const close = dayStart + hours.endMinute * MINUTE_MS;
    if (cursor < open) cursor = open;
    if (cursor >= close) {
      cursor = dayStart + DAY_MS + hours.startMinute * MINUTE_MS;
      continue;
    }
    const available = close - cursor;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
    cursor = dayStart + DAY_MS + hours.startMinute * MINUTE_MS;
  }
  return new Date(cursor + remaining);
}

export const SLA_STATES = ['met', 'on_track', 'overdue'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** `met` once staff have replied to the customer, else `overdue` after the deadline, else `on_track`. */
export function firstReplySla(now: Date, due: Date, firstRepliedAt: Date | null): SlaState {
  if (firstRepliedAt) return 'met';
  return now.getTime() > due.getTime() ? 'overdue' : 'on_track';
}
