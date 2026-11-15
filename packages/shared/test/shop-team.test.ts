/**
 * Busy toggle and shop team rules (design 2026-11-15): "closed today" ends at midnight in India, "busy for N hours"
 * is a bounded whole number, an invite needs an Indian mobile and a short name.
 */
import { describe, expect, it } from 'vitest';
import {
  busyUntilFor,
  nextIstMidnight,
  ShopBusyBodySchema,
  SHOP_BUSY_HOURS_MAX,
  StaffInviteBodySchema,
} from '../src/shop-team';

describe('busy toggle', () => {
  it('closed today ends at the next midnight IST, also just before and just after it', () => {
    expect(nextIstMidnight(new Date('2026-11-16T12:00:00+05:30')).toISOString()).toBe(
      '2026-11-16T18:30:00.000Z',
    );
    expect(nextIstMidnight(new Date('2026-11-16T23:59:59+05:30')).toISOString()).toBe(
      '2026-11-16T18:30:00.000Z',
    );
    expect(nextIstMidnight(new Date('2026-11-17T00:00:00+05:30')).toISOString()).toBe(
      '2026-11-17T18:30:00.000Z',
    );
  });

  it('busy for N hours adds N hours; clear has no end', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    expect(busyUntilFor({ mode: 'hours', hours: 3 }, now)?.toISOString()).toBe('2026-11-16T13:00:00.000Z');
    expect(busyUntilFor({ mode: 'clear' }, now)).toBeNull();
    expect(busyUntilFor({ mode: 'closed_today' }, now)?.toISOString()).toBe('2026-11-16T18:30:00.000Z');
  });

  it('validates the body: whole hours from 1 to the maximum, no extra fields', () => {
    expect(ShopBusyBodySchema.safeParse({ mode: 'hours', hours: 2 }).success).toBe(true);
    expect(ShopBusyBodySchema.safeParse({ mode: 'hours', hours: 0 }).success).toBe(false);
    expect(ShopBusyBodySchema.safeParse({ mode: 'hours', hours: 1.5 }).success).toBe(false);
    expect(ShopBusyBodySchema.safeParse({ mode: 'hours', hours: SHOP_BUSY_HOURS_MAX + 1 }).success).toBe(
      false,
    );
    expect(ShopBusyBodySchema.safeParse({ mode: 'closed_today', hours: 2 }).success).toBe(false);
    expect(ShopBusyBodySchema.safeParse({ mode: 'forever' }).success).toBe(false);
  });
});

describe('staff invite body', () => {
  it('takes an Indian mobile (stored as +91…) and a name of 2 to 60 characters', () => {
    expect(StaffInviteBodySchema.parse({ name: ' Mohan ', phone: '98765 43210' })).toEqual({
      name: 'Mohan',
      phone: '+919876543210',
    });
    expect(StaffInviteBodySchema.safeParse({ name: 'M', phone: '9876543210' }).success).toBe(false);
    expect(StaffInviteBodySchema.safeParse({ name: 'Mohan', phone: '1234567890' }).success).toBe(false);
    expect(
      StaffInviteBodySchema.safeParse({ name: 'Mohan', phone: '9876543210', role: 'owner' }).success,
    ).toBe(false);
  });
});
