/**
 * India Standard Time helpers. Store timestamptz (UTC); compute business days in IST.
 * IST is a fixed UTC+05:30 with no DST, so offset arithmetic is exact.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;

/** The IST wall-clock fields of an instant. */
export function istParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** IST calendar date as YYYY-MM-DD. */
export function istDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istYear(date: Date): number {
  return istParts(date).year;
}

/** The UTC instant at which a given IST calendar date (YYYY-MM-DD) starts. */
export function istStartOfDay(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RangeError(`Invalid date: ${isoDate}`);
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - IST_OFFSET_MS);
}
