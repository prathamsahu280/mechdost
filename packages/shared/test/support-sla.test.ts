import { describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORT_HOURS, addWorkingMinutes, firstReplySla, sanitiseHours } from '../src/support-sla';

/** IST wall-clock time as a UTC instant (IST = UTC+05:30). */
const ist = (iso: string) => new Date(`${iso}+05:30`);
const H = DEFAULT_SUPPORT_HOURS;

describe('addWorkingMinutes (support hours 9:00 to 21:00 IST)', () => {
  it('counts inside the same day', () => {
    expect(addWorkingMinutes(ist('2026-11-16T10:00:00'), 120, H)).toEqual(ist('2026-11-16T12:00:00'));
  });
  it('waits for the opening when the request arrives at night', () => {
    expect(addWorkingMinutes(ist('2026-11-16T23:30:00'), 120, H)).toEqual(ist('2026-11-17T11:00:00'));
  });
  it('waits for the opening when it arrives before the hours', () => {
    expect(addWorkingMinutes(ist('2026-11-16T06:00:00'), 120, H)).toEqual(ist('2026-11-16T11:00:00'));
  });
  it('carries the rest over the closing time into the next morning', () => {
    expect(addWorkingMinutes(ist('2026-11-16T20:00:00'), 120, H)).toEqual(ist('2026-11-17T10:00:00'));
  });
  it('a request at exactly the closing time starts tomorrow', () => {
    expect(addWorkingMinutes(ist('2026-11-16T21:00:00'), 60, H)).toEqual(ist('2026-11-17T10:00:00'));
  });
  it('uses the IST day, not the UTC day (22:00 UTC is 03:30 IST the next day)', () => {
    expect(addWorkingMinutes(new Date('2026-11-16T22:00:00Z'), 30, H)).toEqual(ist('2026-11-17T09:30:00'));
  });
  it('follows custom hours; zero minutes returns the same instant inside the hours', () => {
    const hours = { startMinute: 600, endMinute: 660 };
    expect(addWorkingMinutes(ist('2026-11-16T10:30:00'), 45, hours)).toEqual(ist('2026-11-17T10:15:00'));
    expect(addWorkingMinutes(ist('2026-11-16T10:30:00'), 0, hours)).toEqual(ist('2026-11-16T10:30:00'));
  });
  it('falls back to the defaults for an inverted window', () => {
    expect(sanitiseHours({ startMinute: 900, endMinute: 600 })).toEqual(H);
    expect(addWorkingMinutes(ist('2026-11-16T10:00:00'), 60, { startMinute: 900, endMinute: 600 })).toEqual(
      ist('2026-11-16T11:00:00'),
    );
  });
});

describe('firstReplySla', () => {
  const due = ist('2026-11-16T12:00:00');
  it('is met once staff replied, even late', () => {
    expect(firstReplySla(ist('2026-11-17T12:00:00'), due, ist('2026-11-17T11:00:00'))).toBe('met');
  });
  it('is on track before the deadline and overdue after it', () => {
    expect(firstReplySla(ist('2026-11-16T11:59:00'), due, null)).toBe('on_track');
    expect(firstReplySla(ist('2026-11-16T12:01:00'), due, null)).toBe('overdue');
  });
});
