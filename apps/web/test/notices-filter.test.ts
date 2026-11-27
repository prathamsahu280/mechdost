/**
 * Notification centre filter and day groups (Ustaad UI upgrade U4, design § 3.9): chips "All · Ustaad · Orders ·
 * Service" kept in the URL, rows grouped "Today / Yesterday / This week / Earlier" by the IST calendar day.
 */
import { describe, expect, it } from 'vitest';
import {
  dayGroup,
  groupByDay,
  noticeFilterOf,
  NOTICE_FILTERS,
  passesFilter,
} from '../src/lib/notices-filter';

describe('notice filter', () => {
  it('reads the URL value, unknown → all', () => {
    expect(NOTICE_FILTERS).toEqual(['all', 'ustaad', 'orders', 'service']);
    expect(noticeFilterOf('ustaad')).toBe('ustaad');
    expect(noticeFilterOf('nope')).toBe('all');
    expect(noticeFilterOf(null)).toBe('all');
  });
  it('matches by kind family', () => {
    expect(passesFilter('ustaad.answer_posted', 'ustaad')).toBe(true);
    expect(passesFilter('order.confirmed', 'ustaad')).toBe(false);
    expect(
      ['order.confirmed', 'refund.done', 'payment.failed', 'delivery.out', 'cod.approved'].every((k) =>
        passesFilter(k, 'orders'),
      ),
    ).toBe(true);
    expect(['service.ready', 'quote.sent', 'rsa.assigned'].every((k) => passesFilter(k, 'service'))).toBe(
      true,
    );
    expect(passesFilter('service.ready', 'orders')).toBe(false);
    expect(passesFilter('staff.anything', 'all')).toBe(true);
    expect(passesFilter(null, 'all')).toBe(true);
    expect(passesFilter(null, 'ustaad')).toBe(false);
  });
});

describe('day groups (IST)', () => {
  // 2026-11-27 10:00 IST = 04:30 UTC
  const now = new Date('2026-11-27T04:30:00.000Z');
  it('today, yesterday, this week, earlier by the IST calendar day', () => {
    expect(dayGroup('2026-11-26T19:00:00.000Z', now)).toBe('today'); // 00:30 IST on the 27th
    expect(dayGroup('2026-11-26T18:00:00.000Z', now)).toBe('yesterday'); // 23:30 IST on the 26th
    expect(dayGroup('2026-11-22T04:30:00.000Z', now)).toBe('thisWeek'); // 5 days ago
    expect(dayGroup('2026-11-20T04:30:00.000Z', now)).toBe('earlier'); // 7 days ago
  });
  it('keeps the feed order and makes one group per run', () => {
    const rows = [
      { id: 'a', createdAt: '2026-11-27T03:00:00.000Z' },
      { id: 'b', createdAt: '2026-11-26T10:00:00.000Z' },
      { id: 'c', createdAt: '2026-11-26T09:00:00.000Z' },
      { id: 'd', createdAt: '2026-11-10T09:00:00.000Z' },
    ];
    expect(groupByDay(rows, now).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['today', ['a']],
      ['yesterday', ['b', 'c']],
      ['earlier', ['d']],
    ]);
  });
});
