import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Notice } from '@mechdost/shared/notice-api';
import {
  arrivedSince,
  badgeText,
  emptyActionFor,
  liveText,
  noticeTag,
  noticeTime,
  pollInterval,
  POLL_MS,
  withCount,
} from '../src/lib/notices-view';
import { isSnoozed, pushEnvironment, snoozeUntilFrom, type PushProbe } from '../src/lib/push/push-state';
import en from '../../../packages/shared/src/i18n/en.json';

const copy = { liveOne: en.bell.liveOne, liveOther: en.bell.liveOther, more: en.bell.more };

describe('bell badge and live text', () => {
  it('shows nothing for 0, the number up to 99, then 99+', () => {
    expect(badgeText(0, '99+')).toBe('');
    expect(badgeText(1, '99+')).toBe('1');
    expect(badgeText(99, '99+')).toBe('99');
    expect(badgeText(100, '99+')).toBe('99+');
    expect(badgeText(5000, '99+')).toBe('99+');
  });

  it('says what a screen reader should hear for 0, 1, 3 and 99+', () => {
    expect(liveText(0, copy)).toBe('');
    expect(liveText(1, copy)).toBe('1 new notification');
    expect(liveText(3, copy)).toBe('3 new notifications');
    expect(liveText(120, copy)).toBe('99+ new notifications');
    expect(withCount(en.bell.labelUnread, 7)).toBe('Notifications, 7 unread');
  });
});

describe('polling pace', () => {
  it('partners and staff poll fast, customers slowly, and errors back off to a ceiling', () => {
    expect(pollInterval('shop', 0)).toBe(POLL_MS.portal);
    expect(pollInterval('admin', 0)).toBe(POLL_MS.portal);
    expect(pollInterval('customer', 0)).toBe(POLL_MS.customer);
    expect(pollInterval('shop', 2)).toBe(POLL_MS.portal * 4);
    expect(pollInterval('customer', 9)).toBe(POLL_MS.maxBackoff);
  });
});

describe('new arrivals', () => {
  const n = (id: string): Notice => ({
    id,
    kind: 'order.placed',
    category: 'transactional',
    title: 't',
    body: 'b',
    link: null,
    read: false,
    resolved: false,
    createdAt: '2026-11-15T10:00:00.000Z',
  });
  it('reports only ids not seen before', () => {
    expect(arrivedSince(new Set(['a']), [n('a'), n('b'), n('c')]).map((x) => x.id)).toEqual(['b', 'c']);
    expect(arrivedSince(new Set(['a', 'b']), [n('a'), n('b')])).toEqual([]);
  });
});

describe('empty state action per role', () => {
  it('shoppers go to the shop; partners and staff to their portal', () => {
    expect(emptyActionFor('customer')).toEqual({ href: '/shop', shop: true });
    expect(emptyActionFor('shop').href).toBe('/partner/shop');
    expect(emptyActionFor('workshop').href).toBe('/partner/workshop');
    expect(emptyActionFor('admin').href).toBe('/admin');
  });
});

describe('time', () => {
  it('formats in India time and both languages', () => {
    expect(noticeTime('2026-11-15T10:30:00.000Z', 'en')).toMatch(/15 Nov/);
    expect(noticeTime('2026-11-15T10:30:00.000Z', 'hi')).toMatch(/[ऀ-ॿ]/);
  });
});

describe('push environment', () => {
  const base: PushProbe = {
    userAgent: 'Mozilla/5.0 Chrome/130',
    maxTouchPoints: 0,
    standalone: false,
    hasNotification: true,
    hasPushManager: true,
    hasServiceWorker: true,
    permission: 'default',
  };
  it('maps what the browser reports to one state', () => {
    expect(pushEnvironment(base)).toBe('default');
    expect(pushEnvironment({ ...base, permission: 'granted' })).toBe('granted');
    expect(pushEnvironment({ ...base, permission: 'denied' })).toBe('denied');
    expect(pushEnvironment({ ...base, hasPushManager: false })).toBe('unsupported');
    expect(pushEnvironment({ ...base, hasNotification: false, permission: null })).toBe('unsupported');
  });
  it('iPhone Safari outside the Home Screen explains Add to Home Screen first', () => {
    const iphone = {
      ...base,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1',
      maxTouchPoints: 5,
    };
    expect(pushEnvironment({ ...iphone, hasNotification: false, permission: null })).toBe(
      'ios-needs-home-screen',
    );
    expect(pushEnvironment({ ...iphone, standalone: true })).toBe('default');
    const ipad = { ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', maxTouchPoints: 5 };
    expect(pushEnvironment(ipad)).toBe('ios-needs-home-screen');
    expect(pushEnvironment({ ...base, userAgent: 'Mozilla/5.0 (Macintosh) Safari', maxTouchPoints: 0 })).toBe(
      'default',
    );
  });
  it('"Not now" hides the card for the number of days, then it returns', () => {
    const now = Date.UTC(2026, 10, 15);
    const until = snoozeUntilFrom(now, 14);
    expect(isSnoozed(String(until), now)).toBe(true);
    expect(isSnoozed(String(until), now + 13 * 86_400_000)).toBe(true);
    expect(isSnoozed(String(until), now + 14 * 86_400_000 + 1)).toBe(false);
    expect(isSnoozed(null, now)).toBe(false);
    expect(isSnoozed('garbage', now)).toBe(false);
  });
});

describe('push worker', () => {
  const worker = readFileSync(
    fileURLToPath(new URL('../public/firebase-messaging-sw.js', import.meta.url)),
    'utf8',
  );
  // Code only: the comments explain the design and may name Firebase.
  const code = worker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('has no Firebase code, no keys and no network calls', () => {
    expect(code).not.toMatch(/importScripts|firebase|apiKey|fetch\(/i);
  });
  it('only opens paths on this site and shows title and body only', () => {
    expect(worker).toMatch(/safePath/);
    expect(worker).toMatch(/charAt\(1\) !== '\/'/);
    expect(worker).toMatch(/showNotification/);
    expect(worker).toMatch(/notificationclick/);
  });
});

describe('notice tag', () => {
  it('shows New only while unread and Done once the action is taken care of', () => {
    expect(noticeTag({ read: false, resolved: false })).toBe('new');
    expect(noticeTag({ read: true, resolved: false })).toBeNull();
    // A resolved notice is also marked read by the server, but even an unread one never says "New".
    expect(noticeTag({ read: true, resolved: true })).toBe('done');
    expect(noticeTag({ read: false, resolved: true })).toBe('done');
  });
});
