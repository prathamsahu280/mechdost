/**
 * Shop working hours (user 2026-11-14: "each seller configures it … if admin routes to a closed shop then it goes to
 * the shop till morning until it opens and still then it waits for like an hour"). Hours are IST wall-clock times;
 * the weekday is the IST weekday (0 = Sunday). 2026-11-16 is a Monday.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_HOURS, acceptanceDeadline, isShopHours, shopOpenState } from '../src/shop-hours';

const ist = (local: string) => new Date(`${local}+05:30`);
const MON_SAT = { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] };

describe('shop hours', () => {
  it('default is 09:00–21:00, Monday to Saturday', () => {
    expect(DEFAULT_SHOP_HOURS).toEqual(MON_SAT);
  });

  it('validates the shape (one window, IST HH:MM, distinct weekdays 0–6, close after open)', () => {
    expect(isShopHours(MON_SAT)).toBe(true);
    expect(isShopHours({ ...MON_SAT, close: '08:00' })).toBe(false);
    expect(isShopHours({ ...MON_SAT, open: '9:00' })).toBe(false);
    expect(isShopHours({ ...MON_SAT, days: [] })).toBe(false);
    expect(isShopHours({ ...MON_SAT, days: [1, 1] })).toBe(false);
    expect(isShopHours({ ...MON_SAT, days: [7] })).toBe(false);
    expect(isShopHours({ ...MON_SAT, extra: true })).toBe(false);
    expect(isShopHours(null)).toBe(false);
  });

  it('is open from the opening minute up to (not including) closing, in IST', () => {
    expect(shopOpenState(MON_SAT, ist('2026-11-16T08:59:59'))).toEqual({
      open: false,
      opensAt: ist('2026-11-16T09:00:00'),
    });
    expect(shopOpenState(MON_SAT, ist('2026-11-16T09:00:00'))).toEqual({ open: true });
    expect(shopOpenState(MON_SAT, ist('2026-11-16T20:59:59'))).toEqual({ open: true });
    expect(shopOpenState(MON_SAT, ist('2026-11-16T21:00:00'))).toEqual({
      open: false,
      opensAt: ist('2026-11-17T09:00:00'),
    });
  });

  it('uses the IST weekday, not the UTC one (00:30 IST Monday is still Sunday in UTC)', () => {
    // 2026-11-15T19:00Z = Monday 00:30 IST: opens the same IST morning, not on a "Sunday" rule.
    expect(shopOpenState(MON_SAT, new Date('2026-11-15T19:00:00Z'))).toEqual({
      open: false,
      opensAt: ist('2026-11-16T09:00:00'),
    });
  });

  it('skips closed weekdays: Saturday night → Monday morning', () => {
    expect(shopOpenState(MON_SAT, ist('2026-11-21T22:00:00'))).toEqual({
      open: false,
      opensAt: ist('2026-11-23T09:00:00'),
    });
    // Sunday all day
    expect(shopOpenState(MON_SAT, ist('2026-11-22T12:00:00'))).toEqual({
      open: false,
      opensAt: ist('2026-11-23T09:00:00'),
    });
  });

  it('the accept deadline: open → the normal timeout; closed → opening time + grace', () => {
    const open = ist('2026-11-16T10:00:00');
    expect(acceptanceDeadline({ hours: MON_SAT, at: open, timeoutMinutes: 15, graceMinutes: 60 })).toEqual({
      expiresAt: ist('2026-11-16T10:15:00'),
      closed: false,
    });
    const night = ist('2026-11-16T22:30:00');
    expect(acceptanceDeadline({ hours: MON_SAT, at: night, timeoutMinutes: 15, graceMinutes: 60 })).toEqual({
      expiresAt: ist('2026-11-17T10:00:00'),
      closed: true,
    });
    const saturdayNight = ist('2026-11-21T23:00:00');
    expect(
      acceptanceDeadline({ hours: MON_SAT, at: saturdayNight, timeoutMinutes: 15, graceMinutes: 90 }),
    ).toEqual({ expiresAt: ist('2026-11-23T10:30:00'), closed: true });
  });

  it('closing at 24:00 means open to midnight (round the clock with 00:00–24:00 every day)', () => {
    const roundTheClock = { open: '00:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isShopHours(roundTheClock)).toBe(true);
    expect(isShopHours({ ...roundTheClock, open: '24:00' })).toBe(false);
    expect(shopOpenState(roundTheClock, ist('2026-11-22T23:59:59'))).toEqual({ open: true });
    expect(shopOpenState(roundTheClock, ist('2026-11-23T00:00:00'))).toEqual({ open: true });
  });

  it('open every day 00:00–23:59 is closed in the last minute', () => {
    const always = { open: '00:00', close: '23:59', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(shopOpenState(always, ist('2026-11-22T12:00:00'))).toEqual({ open: true });
    expect(shopOpenState(always, ist('2026-11-22T23:59:30'))).toEqual({
      open: false,
      opensAt: ist('2026-11-23T00:00:00'),
    });
  });
});
