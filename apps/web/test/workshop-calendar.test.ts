import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  agendaFor,
  agendaWithCapacity,
  calendarDays,
  combineSlots,
  dayCounts,
  hourText,
  pickDay,
} from '@/lib/workshop-calendar';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const json = (l: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/shared/src/i18n/${l}.json`, import.meta.url), 'utf8'),
  ) as Record<string, Record<string, string>>;

const job = (code: string, status: string, visitDate: string | null, visitHour: number | null) => ({
  code,
  status,
  visitDate,
  visitHour,
});

describe('workshop calendar agenda (P4, design § 6.4)', () => {
  it('the strip is seven IST days from today, rolling over at IST midnight not UTC', () => {
    // 2026-11-28 20:00 UTC is 2026-11-29 01:30 IST.
    const days = calendarDays(new Date('2026-11-28T20:00:00Z'));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-11-29');
    expect(days[6]).toBe('2026-12-05');
    expect(calendarDays(new Date('2026-11-28T18:29:00Z'))[0]).toBe('2026-11-28');
  });

  it('counts accepted visits per day, only for live jobs with a visit date', () => {
    const days = calendarDays(new Date('2026-11-28T04:30:00Z'));
    const rows = [
      job('A', 'confirmed', '2026-11-28', 10),
      job('B', 'in_progress', '2026-11-28', 15),
      job('C', 'confirmed', '2026-11-30', null),
      job('D', 'proposed', null, null),
      job('E', 'paid', '2026-11-28', 9),
      job('F', 'confirmed', '2026-12-30', 9),
    ];
    expect(dayCounts(rows, days)).toEqual({ '2026-11-28': 2, '2026-11-30': 1 });
  });

  it('lists a day by hour, earliest first, with "no hour set" visits last', () => {
    const rows = [
      job('LATE', 'confirmed', '2026-11-28', 16),
      job('NOHOUR', 'confirmed', '2026-11-28', null),
      job('EARLY', 'ready', '2026-11-28', 9),
      job('SAME', 'confirmed', '2026-11-28', 16),
      job('OTHER', 'confirmed', '2026-11-29', 9),
    ];
    const agenda = agendaFor(rows, '2026-11-28');
    expect(agenda.map((g) => g.hour)).toEqual([9, 16, null]);
    expect(agenda[1]?.jobs.map((j) => j.code)).toEqual(['LATE', 'SAME']);
  });

  it('?day picks a day in the strip, anything else is today', () => {
    const days = calendarDays(new Date('2026-11-28T04:30:00Z'));
    expect(pickDay('2026-11-30', days)).toBe('2026-11-30');
    expect(pickDay('2027-01-01', days)).toBe('2026-11-28');
    expect(pickDay(null, days)).toBe('2026-11-28');
    expect(pickDay('<script>', days)).toBe('2026-11-28');
  });

  it('writes the hour on the 24-hour clock (no am/pm words in Hindi)', () => {
    expect(hourText(9)).toBe('09:00');
    expect(hourText(16)).toBe('16:00');
  });

  it('is a tab, a route and has Hindi strings', () => {
    expect(src('app/[locale]/partner/workshop/calendar/page.tsx')).toMatch(/WorkshopPortal tab="calendar"/);
    const en = json('en').partnerWorkshop ?? {};
    const hi = json('hi').partnerWorkshop ?? {};
    expect(en.tab_calendar).toBe('Calendar');
    expect(hi.tab_calendar).toBe('कैलेंडर');
    for (const k of Object.keys(en).filter((k) => k.startsWith('cal_'))) expect(hi[k], k).toBeTruthy();
    expect(Object.keys(en).filter((k) => k.startsWith('cal_')).length).toBeGreaterThan(4);
  });
});

describe('workshop calendar free places per hour (spec 07, 2026-11-28 batch F)', () => {
  it('adds the places of every workshop hour by hour, earliest first', () => {
    expect(
      combineSlots([
        [
          { hour: 10, capacity: 2, free: 1 },
          { hour: 9, capacity: 2, free: 2 },
        ],
        [{ hour: 10, capacity: 3, free: 0 }],
      ]),
    ).toEqual([
      { hour: 9, capacity: 2, free: 2 },
      { hour: 10, capacity: 5, free: 1 },
    ]);
  });

  it('puts free places on each hour of the agenda, adds open hours without visits, keeps unset hour last', () => {
    const rows = [job('A', 'confirmed', '2026-11-30', 10), job('B', 'confirmed', '2026-11-30', null)];
    const out = agendaWithCapacity(agendaFor(rows, '2026-11-30'), [
      { hour: 9, capacity: 2, free: 2 },
      { hour: 10, capacity: 2, free: 1 },
    ]);
    expect(out.map((g) => [g.hour, g.jobs.length, g.places?.free ?? null])).toEqual([
      [9, 0, 2],
      [10, 1, 1],
      [null, 1, null],
    ]);
  });

  it('reads the existing slots route only, and has en and hi strings', () => {
    const c = src('components/portal/workshop-calendar-api.tsx');
    expect(c).toMatch(/\/workshop\/slots\?workshopId=/);
    for (const l of ['en', 'hi'])
      for (const k of ['cal_free', 'cal_hour_closed'])
        expect(json(l).partnerWorkshop?.[k], `${l}.${k}`).toBeTruthy();
  });
});
