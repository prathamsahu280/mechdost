/**
 * Shop working hours (user 2026-11-14; decision 2026-11-14 "Shop hours and closed-shop offers"; spec 07). One window
 * on the listed weekdays (0 = Sunday), wall-clock times in IST — the same shape as `workshops.hours`. Routing
 * suggests open shops first; an order routed to a closed shop waits for it: the accept deadline is the next opening
 * time plus the admin's grace (`orders.closed_shop_grace_min`). No Zod: the db layer and the browser import this.
 */
export interface ShopHours {
  open: string;
  close: string;
  days: number[];
}

/** For shops that never set their hours (ruling 2026-11-14): 09:00–21:00, Monday to Saturday. */
export const DEFAULT_SHOP_HOURS: ShopHours = { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] };

export const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Closing time: any HH:MM, or 24:00 = open until midnight (00:00–24:00 every day = round the clock). */
export const CLOSE_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isShopHours(value: unknown): value is ShopHours {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'close,days,open') return false;
  const v = value as Record<string, unknown>;
  const { open, close, days } = v;
  return (
    typeof open === 'string' &&
    typeof close === 'string' &&
    HHMM_RE.test(open) &&
    CLOSE_RE.test(close) &&
    open < close &&
    Array.isArray(days) &&
    days.length >= 1 &&
    days.length <= 7 &&
    days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) &&
    new Set(days).size === days.length
  );
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Open now, or closed with the next opening instant (searches the coming week). */
export function shopOpenState(hours: ShopHours, at: Date): { open: true } | { open: false; opensAt: Date } {
  const local = at.getTime() + IST_OFFSET_MS; // IST wall clock as if it were UTC
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const minuteOfDay = (local - dayStart) / 60_000;
  const weekday = new Date(dayStart).getUTCDay();
  const open = minutesOf(hours.open);
  const close = minutesOf(hours.close);
  if (hours.days.includes(weekday) && minuteOfDay >= open && minuteOfDay < close) return { open: true };
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = (weekday + ahead) % 7;
    if (!hours.days.includes(day)) continue;
    if (ahead === 0 && minuteOfDay >= open) continue; // today's window has started or passed
    return { open: false, opensAt: new Date(dayStart + ahead * DAY_MS + open * 60_000 - IST_OFFSET_MS) };
  }
  // Unreachable with valid hours (at least one weekday); a full week ahead as a safe bound.
  return { open: false, opensAt: new Date(at.getTime() + 7 * DAY_MS) };
}

/** The instant today's window closes (the shop must be open at `at`). */
function closingInstant(hours: ShopHours, at: Date): Date {
  const local = at.getTime() + IST_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  return new Date(dayStart + minutesOf(hours.close) * 60_000 - IST_OFFSET_MS);
}

/**
 * When an offer to this shop runs out: the normal accept timeout while the shop is open; if it is closed — or the
 * timeout would run past today's closing time (user 2026-11-14: "treat as closed") — the next opening time plus the
 * grace minutes (the offer waits overnight and over closed days). Open past midnight (24:00 into a 00:00 opening the
 * next day) is one continuous window, never "closing".
 */
export function acceptanceDeadline(input: {
  hours: ShopHours;
  at: Date;
  timeoutMinutes: number;
  graceMinutes: number;
}): { expiresAt: Date; closed: boolean } {
  const normal = new Date(input.at.getTime() + input.timeoutMinutes * 60_000);
  const waitFrom = (from: Date) => {
    const next = shopOpenState(input.hours, from);
    // Open again right at `from` (a 24:00 close running into a 00:00 opening): the window simply continues.
    if (next.open) return { expiresAt: normal, closed: false };
    return { expiresAt: new Date(next.opensAt.getTime() + input.graceMinutes * 60_000), closed: true };
  };
  const state = shopOpenState(input.hours, input.at);
  if (!state.open) return waitFrom(input.at);
  const closesAt = closingInstant(input.hours, input.at);
  return normal.getTime() > closesAt.getTime() ? waitFrom(closesAt) : { expiresAt: normal, closed: false };
}
