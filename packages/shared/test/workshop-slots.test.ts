import { describe, expect, it } from 'vitest';
import { RescheduleServiceRequestSchema, ProposeSchema, SlotCapacitySchema } from '../src/service-requests';
import { serviceRequestMachine } from '../src/state';
import { openSlotHours, slotOfHour, weekdayOf } from '../src/workshop-slots';

const HOURS = { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] };

describe('workshop slots', () => {
  it('lists whole open hours on open weekdays only', () => {
    // 2026-11-16 is a Monday, 2026-11-15 a Sunday.
    expect(weekdayOf('2026-11-16')).toBe(1);
    expect(openSlotHours(HOURS, '2026-11-16')).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(openSlotHours(HOURS, '2026-11-15')).toEqual([]);
  });

  it('keeps only whole hours inside odd opening times', () => {
    expect(openSlotHours({ open: '09:30', close: '12:30', days: [1] }, '2026-11-16')).toEqual([10, 11]);
    expect(openSlotHours({ open: '08:00', close: '08:30', days: [1] }, '2026-11-16')).toEqual([]);
  });

  it('maps hours to the older parts of the day', () => {
    expect([8, 11, 12, 16, 17, 20].map(slotOfHour)).toEqual([
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
  });

  it('validates the proposal, reschedule and capacity bodies strictly', () => {
    const base = { date: '2026-11-16', lowPaise: 1, highPaise: 2, version: 1 };
    expect(ProposeSchema.safeParse({ ...base, hour: 10 }).success).toBe(true);
    expect(ProposeSchema.safeParse({ ...base, slot: 'morning' }).success).toBe(true);
    expect(ProposeSchema.safeParse(base).success).toBe(false);
    expect(ProposeSchema.safeParse({ ...base, hour: 24 }).success).toBe(false);
    expect(ProposeSchema.safeParse({ ...base, hour: 10, extra: 1 }).success).toBe(false);
    expect(
      RescheduleServiceRequestSchema.safeParse({ date: '2026-11-16', slot: 'evening', version: 2 }).success,
    ).toBe(true);
    expect(
      RescheduleServiceRequestSchema.safeParse({ date: '16-11-2026', slot: 'evening', version: 2 }).success,
    ).toBe(false);
    expect(SlotCapacitySchema.safeParse({ date: '2026-11-16', hour: 9, capacity: 21 }).success).toBe(false);
    expect(SlotCapacitySchema.safeParse({ date: '2026-11-16', hour: 9, capacity: 0 }).success).toBe(true);
  });

  it('lets only the customer reopen a confirmed booking', () => {
    expect(serviceRequestMachine.canActor('confirmed', 'awaiting_workshop', 'customer')).toBe(true);
    expect(serviceRequestMachine.canActor('confirmed', 'awaiting_workshop', 'workshop')).toBe(false);
    expect(serviceRequestMachine.canActor('vehicle_received', 'awaiting_workshop', 'customer')).toBe(false);
  });
});
