import { describe, expect, it } from 'vitest';
import {
  acknowledged,
  bodyError,
  inboxSla,
  isActive,
  orderCodes,
  supportErrorKey,
  threadFromApi,
} from '../src/lib/support-view';

/** Support on the API (spec 09; Stream D 2026-11-14). */
const msg = (role: string, internal = false) => ({
  id: `${role}-${String(internal)}`,
  role,
  body: 'text',
  internal,
  channel: 'web',
  createdAt: '2026-11-14T10:00:00.000Z',
});

describe('support view', () => {
  it('maps API messages for the shared thread', () => {
    expect(threadFromApi({ messages: [msg('customer')] }).messages).toEqual([
      {
        id: 'customer-false',
        role: 'customer',
        body: 'text',
        internal: false,
        channel: 'web',
        at: '2026-11-14T10:00:00.000Z',
        attachments: [],
      },
    ]);
  });

  it('counts a request as acknowledged after a staff reply or a status change, not an internal note', () => {
    expect(acknowledged({ status: 'open', messages: [msg('customer')] })).toBe(false);
    expect(acknowledged({ status: 'open', messages: [msg('customer'), msg('staff', true)] })).toBe(false);
    expect(acknowledged({ status: 'open', messages: [msg('staff')] })).toBe(true);
    expect(acknowledged({ status: 'in_review', messages: [] })).toBe(true);
  });

  it('maps support codes and leaves the rest to the common messages', () => {
    expect(supportErrorKey('TICKET_DAILY_LIMIT')).toBe('err_limit');
    expect(supportErrorKey('TICKET_BODY_TOO_LONG')).toBe('err_too_long');
    expect(supportErrorKey('REPLY_LIMIT')).toBe('api_err_reply_limit');
    expect(supportErrorKey('TICKET_CLOSED')).toBe('err_not_allowed');
    expect(supportErrorKey('STALE_TICKET')).toBe('err_stale');
    expect(supportErrorKey('RATE_LIMITED')).toBeNull();
  });

  it('checks the message before sending', () => {
    expect(bodyError('   ', 10)).toBe('err_empty');
    expect(bodyError('x'.repeat(11), 10)).toBe('err_too_long');
    expect(bodyError(' ok ', 10)).toBeNull();
  });

  it('flags overdue replies and resolutions on active requests only', () => {
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    const base = {
      status: 'open',
      acknowledged: false,
      slaAckDue: '2026-11-14T11:00:00.000Z',
      slaResolveDue: '2026-12-14T00:00:00.000Z',
    };
    expect(inboxSla(base, now)).toBe('ack_overdue');
    expect(inboxSla({ ...base, acknowledged: true }, now)).toBe('ok');
    expect(inboxSla({ ...base, acknowledged: true, slaResolveDue: '2026-11-14T11:30:00.000Z' }, now)).toBe(
      'resolve_overdue',
    );
    expect(inboxSla({ ...base, status: 'resolved' }, now)).toBe('ok');
    expect(isActive('awaiting_customer')).toBe(true);
    expect(isActive('closed')).toBe(false);
  });

  it('lists every order code once, newest first', () => {
    expect(
      orderCodes([
        { orders: [{ code: 'MD-RPR-2026-AAAAAA' }, { code: 'MD-RPR-2026-BBBBBB' }] },
        { orders: [{ code: 'MD-RPR-2026-AAAAAA' }] },
      ]),
    ).toEqual(['MD-RPR-2026-AAAAAA', 'MD-RPR-2026-BBBBBB']);
  });
});
