/**
 * Messages restyle (UI upgrade U3, design § 3.7; spec 23 § 21i): the pure rules behind the sticky thread, the
 * day separators (IST), the closed state, the inbox preview, the polite incoming announcement, the hidden dock and the
 * new copy in both languages.
 */
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { ThreadViewDto } from '@mechdost/shared/ustaad/dto/messages';
import {
  clockOf,
  countIncoming,
  dayWord,
  groupByDay,
  isClosedThread,
  istDayKey,
  previewOf,
} from '../src/components/ustaad/messages/view';
import { hidesDock } from '../src/components/ustaad/shell/tabs';

const at = (iso: string) => ({ createdAt: iso });

describe('day separators use the IST day', () => {
  it('23:30 UTC is already the next day in India', () => {
    expect(istDayKey('2026-11-26T23:30:00.000Z')).toBe('2026-11-27');
    expect(istDayKey('2026-11-26T18:29:00.000Z')).toBe('2026-11-26');
  });
  it('groups oldest-first messages into days and keeps order', () => {
    const g = groupByDay([
      at('2026-11-26T18:00:00.000Z'),
      at('2026-11-26T18:40:00.000Z'),
      at('2026-11-27T05:00:00.000Z'),
    ]);
    expect(g.map((d) => [d.day, d.items.length])).toEqual([
      ['2026-11-26', 1],
      ['2026-11-27', 2],
    ]);
  });
  it('names today and yesterday, leaves other days to the date', () => {
    const now = '2026-11-27T10:00:00.000Z';
    expect(dayWord('2026-11-27', now)).toBe('today');
    expect(dayWord('2026-11-26', now)).toBe('yesterday');
    expect(dayWord('2026-11-20', now)).toBeNull();
  });
});

describe('closed conversation', () => {
  it('declined and blocked threads are closed; requested and open are not', () => {
    expect(isClosedThread({ status: 'declined', mine: false })).toBe(true);
    expect(isClosedThread({ status: 'blocked', mine: true })).toBe(true);
    expect(isClosedThread({ status: 'open', mine: true })).toBe(false);
    expect(isClosedThread({ status: 'requested', mine: false })).toBe(false);
  });
});

describe('inbox preview', () => {
  it('says what kind of message it is, with the duration of a voice note', () => {
    expect(previewOf({ kind: 'voice', text: null, durationMs: 12_400, mine: false })).toEqual({
      kind: 'voice',
      clock: '0:12',
      mine: false,
    });
    expect(previewOf({ kind: 'voice', text: null, durationMs: null, mine: true })).toEqual({
      kind: 'voice',
      clock: null,
      mine: true,
    });
    expect(previewOf({ kind: 'photo', text: null, durationMs: null, mine: false })).toEqual({
      kind: 'photo',
      clock: null,
      mine: false,
    });
    expect(previewOf({ kind: 'post_share', text: null, durationMs: null, mine: false })).toEqual({
      kind: 'post_share',
      clock: null,
      mine: false,
    });
  });
  it('text keeps its words; nothing yet gives no preview', () => {
    expect(previewOf({ kind: 'text', text: 'Kal aana', durationMs: null, mine: true })).toEqual({
      kind: 'text',
      text: 'Kal aana',
      mine: true,
    });
    expect(previewOf(null)).toBeNull();
    expect(previewOf(undefined)).toBeNull();
  });
  it('formats minutes and seconds', () => {
    expect(clockOf(65_000)).toBe('1:05');
    expect(clockOf(0)).toBe('0:00');
  });
  it('the thread view accepts the optional last-message summary', () => {
    const base = {
      id: '0193a000-0000-7000-8000-000000000301',
      status: 'open',
      mine: true,
      other: {
        id: '0193a000-0000-7000-8000-000000000001',
        handle: 'suresh',
        displayName: 'Suresh',
        displayNameHi: null,
        track: 'ustaad',
        level: 'pakka',
        verified: false,
        official: false,
        areaLabel: 'Raipur',
        areaLabelHi: null,
        photoMediaId: null,
      },
      muted: false,
      unread: true,
      lastMessageAt: '2026-11-26T06:00:00.000Z',
    };
    expect(ThreadViewDto.safeParse(base).success).toBe(true);
    const last = { kind: 'voice', text: null, durationMs: 12000, mine: false };
    expect(ThreadViewDto.safeParse({ ...base, last }).success).toBe(true);
    expect(ThreadViewDto.safeParse({ ...base, last: { ...last, kind: 'bogus' } }).success).toBe(false);
  });
});

describe('polite incoming announcement', () => {
  const m = (id: string, mine: boolean) => ({ id, mine });
  it('says nothing on first load', () => {
    expect(countIncoming(null, [m('a', false)])).toBe(0);
  });
  it('counts only new messages from the other member', () => {
    const known = new Set(['a']);
    expect(countIncoming(known, [m('a', false), m('b', false), m('c', true), m('d', false)])).toBe(2);
    expect(countIncoming(known, [m('a', false)])).toBe(0);
  });
});

describe('the dock steps aside on a conversation', () => {
  it('hides on /ustaad/messages/<id> in both languages, not on the inbox', () => {
    expect(hidesDock('/ustaad/messages/0193a')).toBe(true);
    expect(hidesDock('/hi/ustaad/messages/0193a')).toBe(true);
    expect(hidesDock('/ustaad/messages')).toBe(false);
    expect(hidesDock('/ustaad/messages/')).toBe(false);
    expect(hidesDock('/ustaad/q/abc')).toBe(false);
  });
});

describe('new copy exists in English and Hindi', () => {
  const KEYS = [
    'today',
    'yesterday',
    'newIncomingNote',
    'previewShared',
    'previewYou',
    'unreadWord',
    'requestsRow',
  ];
  it.each(KEYS)('%s', (k) => {
    const e = (en.ustaad.messages as Record<string, string>)[k];
    const h = (hi.ustaad.messages as Record<string, string>)[k];
    expect(e).toBeTruthy();
    expect(h).toBeTruthy();
    expect(h).not.toBe(e);
  });
});
