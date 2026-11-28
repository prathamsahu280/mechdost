/** How long ago a sign-in was last active, as a bucket the Security screen words in the locale (spec 01 § Devices). */
export type ActiveAgo =
  | { kind: 'now' }
  | { kind: 'minutes'; n: number }
  | { kind: 'hours'; n: number }
  | { kind: 'days'; n: number }
  | { kind: 'date' };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Under 5 minutes is "Active now" (last active is refreshed hourly, so it is never more precise than that). */
export function activeAgo(lastActiveAtIso: string, nowMs: number): ActiveAgo {
  const diff = Math.max(0, nowMs - Date.parse(lastActiveAtIso));
  if (Number.isNaN(diff) || diff < 5 * MIN) return { kind: 'now' };
  if (diff < HOUR) return { kind: 'minutes', n: Math.floor(diff / MIN) };
  if (diff < DAY) return { kind: 'hours', n: Math.floor(diff / HOUR) };
  if (diff < 30 * DAY) return { kind: 'days', n: Math.floor(diff / DAY) };
  return { kind: 'date' };
}

/** The date for the "date" bucket, in IST (business display zone), in the page language. */
export function istDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}
