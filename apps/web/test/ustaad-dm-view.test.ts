/**
 * Ustaad messages, My network and Discover (spec 23 § 4 flows 7–8, § 5; workstream D2 web): the pure view rules the
 * screens rely on, plus en/hi copy parity for the three namespaces and every API code the screens turn into words.
 */
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import {
  DM_ERROR_CODES,
  chronological,
  composerMode,
  dmErrorKey,
  initials,
  normaliseHandle,
  parseDiscoverFilters,
  parseNetworkTab,
  parseThreadBox,
  pickExactHandle,
  tickState,
} from '../src/components/ustaad/messages/view';

const msg = (over: Partial<{ mine: boolean; pending: boolean; read: boolean }>) => ({
  mine: true,
  pending: false,
  read: false,
  ...over,
});

describe('thread list box and network tab come from the address', () => {
  it('known boxes pass, anything else is the inbox', () => {
    expect(parseThreadBox('requests')).toBe('requests');
    expect(parseThreadBox('sent')).toBe('sent');
    expect(parseThreadBox('junk')).toBe('inbox');
    expect(parseThreadBox(undefined)).toBe('inbox');
  });
  it('known tabs pass, anything else is followers', () => {
    for (const tab of ['followers', 'following', 'connections', 'requests', 'blocked'] as const)
      expect(parseNetworkTab(tab)).toBe(tab);
    expect(parseNetworkTab('<script>')).toBe('followers');
  });
});

describe('read ticks are shown only on my messages', () => {
  it('held → pending, read → seen, else sent', () => {
    expect(tickState(msg({ pending: true, read: true }))).toBe('pending');
    expect(tickState(msg({ read: true }))).toBe('seen');
    expect(tickState(msg({}))).toBe('sent');
  });
  it('their message has no tick', () => {
    expect(tickState(msg({ mine: false, read: true }))).toBeNull();
  });
});

describe('messages arrive newest first and are shown oldest first', () => {
  it('reverses without touching the input', () => {
    const input = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
    expect(chronological(input).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(input[0]?.id).toBe('c');
  });
});

describe('initials avatar', () => {
  it('two words → two letters, upper case', () => {
    expect(initials('ramesh sahu')).toBe('RS');
  });
  it('one word → one letter; Devanagari works', () => {
    expect(initials('Imran')).toBe('I');
    expect(initials('रमेश साहू')).toBe('रस');
  });
  it('empty → a neutral mark', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('?to=<handle> resolution', () => {
  it('accepts a handle with or without @, lower-cases it', () => {
    expect(normaliseHandle('@Ramesh_RPR')).toBe('ramesh_rpr');
    expect(normaliseHandle('suresh_auto')).toBe('suresh_auto');
  });
  it('refuses anything that is not a handle', () => {
    expect(normaliseHandle('a')).toBeNull();
    expect(normaliseHandle('x y')).toBeNull();
    expect(normaliseHandle('https://evil.example')).toBeNull();
    expect(normaliseHandle(undefined)).toBeNull();
  });
  it('only an exact handle match counts (a substring search may return others first)', () => {
    const items = [{ handle: 'ramesh_rpr_2' }, { handle: 'Ramesh_RPR' }];
    expect(pickExactHandle(items, 'ramesh_rpr')).toBe(items[1]);
    expect(pickExactHandle([{ handle: 'ramesh_rpr_2' }], 'ramesh_rpr')).toBeNull();
  });
});

describe('what the composer shows for a thread', () => {
  it('open → full composer', () => {
    expect(composerMode({ status: 'open', mine: true })).toBe('open');
  });
  it('my request waiting → one message only, no composer', () => {
    expect(composerMode({ status: 'requested', mine: true })).toBe('waiting');
  });
  it('a request to me → accept or decline, no composer', () => {
    expect(composerMode({ status: 'requested', mine: false })).toBe('decide');
  });
  it('declined and blocked are closed', () => {
    expect(composerMode({ status: 'declined', mine: true })).toBe('closed');
    expect(composerMode({ status: 'blocked', mine: false })).toBe('closed');
  });
});

describe('Discover filters', () => {
  it('keeps a typed search of 2+ characters and known codes only', () => {
    expect(parseDiscoverFilters({ q: ' splendor ', work: 'engine', level: 'pakka' })).toEqual({
      q: 'splendor',
      work: 'engine',
      level: 'pakka',
    });
  });
  it('drops a 1-character search and unknown codes', () => {
    expect(parseDiscoverFilters({ q: 'a', work: 'flying', level: 'king' })).toEqual({
      q: null,
      work: null,
      level: null,
    });
  });
});

describe('error codes become words in both languages', () => {
  it('a known code has its own key, others the generic one', () => {
    expect(dmErrorKey('USTAAD_DM_LINK')).toBe('err_USTAAD_DM_LINK');
    expect(dmErrorKey('SOMETHING_NEW')).toBe('err_generic');
    expect(dmErrorKey('HTTP_429')).toBe('err_RATE_LIMITED');
  });
  for (const lang of [
    ['en', en],
    ['hi', hi],
  ] as const) {
    it(`${lang[0]}: every code the screens can show has text`, () => {
      const m = lang[1].ustaad.messages as Record<string, string>;
      for (const code of DM_ERROR_CODES) expect(m[`err_${code}`], code).toBeTruthy();
      expect(m.err_generic).toBeTruthy();
    });
  }
});

describe('copy parity (en ↔ hi) for messages, network and discover', () => {
  for (const ns of ['messages', 'network', 'discover'] as const) {
    it(ns, () => {
      const e = en.ustaad[ns] as Record<string, string>;
      const h = hi.ustaad[ns] as Record<string, string>;
      expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
      for (const [k, v] of Object.entries(h)) expect(v.trim(), `${ns}.${k}`).not.toBe('');
    });
  }
});
