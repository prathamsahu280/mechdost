import { describe, expect, it } from 'vitest';
import { noticeKinds } from '../src/notice-catalogue';
import {
  NOTICE_PRIORITIES,
  NOTICE_PRIORITY_OF_KIND,
  noticeBucket,
  noticePriorityOf,
  type NoticePriority,
} from '../src/notice-api';

describe('notice priority (spec 10: urgent / action / info / success)', () => {
  it('has exactly the four codes', () => {
    expect([...NOTICE_PRIORITIES]).toEqual(['urgent', 'action', 'info', 'success']);
  });

  it('covers every notice kind and no kind that does not exist', () => {
    expect(Object.keys(NOTICE_PRIORITY_OF_KIND).sort()).toEqual([...noticeKinds()].sort());
  });

  it.each([
    ['shop.offer_expiring', 'urgent'],
    ['shop.order_routed', 'urgent'],
    ['staff.order_needs_routing', 'urgent'],
    ['staff.refund_overdue', 'urgent'],
    ['rsa.offer', 'urgent'],
    ['refund.failed', 'urgent'],
    ['quote.expiring', 'urgent'],
    ['service.proposed', 'action'],
    ['service.estimate_ready', 'action'],
    ['staff.new_ticket', 'action'],
    ['order.placed', 'info'],
    ['order.delivered', 'success'],
    ['refund.processed', 'success'],
    ['ticket.resolved', 'success'],
  ] as [string, NoticePriority][])('%s is %s', (kind, priority) => {
    expect(noticePriorityOf(kind)).toBe(priority);
  });

  it('an unknown or missing kind is info (never urgent by accident)', () => {
    expect(noticePriorityOf(null)).toBe('info');
    expect(noticePriorityOf('made.up')).toBe('info');
  });

  it('groups: unread urgent 0, unread 1, read 2', () => {
    expect(noticeBucket({ read: false, priority: 'urgent' })).toBe(0);
    expect(noticeBucket({ read: false, priority: 'action' })).toBe(1);
    expect(noticeBucket({ read: false, priority: 'success' })).toBe(1);
    expect(noticeBucket({ read: true, priority: 'urgent' })).toBe(2);
    expect(noticeBucket({ read: true, priority: 'info' })).toBe(2);
  });
});
