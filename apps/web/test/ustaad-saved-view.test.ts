import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import {
  freeSuggestions,
  nameProblem,
  savedErrorKey,
  savedHref,
  withCollection,
} from '../src/lib/ustaad/saved-view';

const ID = '0193a900-0000-7000-8000-000000000001';
const item = (kind: 'post' | 'question' | 'answer' | 'job' | 'lesson', code: string | null) => ({
  kind,
  id: ID,
  savedAt: '2026-11-28T00:00:00.000Z',
  text: 'x',
  textHi: null,
  code,
  collectionIds: [] as string[],
});

describe('savedHref: every row opens the item itself', () => {
  it('posts by id, questions and answers by the question code, jobs by code, lessons in Learn', () => {
    expect(savedHref(item('post', null), 'en')).toBe(`/ustaad/p/${ID}`);
    expect(savedHref(item('question', 'UQ-RPR-2026-AAAAAA'), 'en')).toBe('/ustaad/q/UQ-RPR-2026-AAAAAA');
    expect(savedHref(item('answer', 'UQ-RPR-2026-AAAAAA'), 'hi')).toBe('/hi/ustaad/q/UQ-RPR-2026-AAAAAA');
    expect(savedHref(item('job', 'UJ-RPR-2026-BBBBBB'), 'en')).toBe('/ustaad/jobs/UJ-RPR-2026-BBBBBB');
    expect(savedHref(item('lesson', null), 'hi')).toBe('/hi/ustaad/learn');
  });
  it('falls back to Home when a code is missing (never a broken link)', () => {
    expect(savedHref(item('question', null), 'en')).toBe('/ustaad');
  });
});

describe('savedErrorKey: API codes to the words next to the field', () => {
  it('maps the duplicate name, the limit, the stale version and a gone collection', () => {
    expect(savedErrorKey('UNIQUE_VIOLATION')).toBe('err_nameTaken');
    expect(savedErrorKey('USTAAD_SAVE_COLLECTIONS_MAX')).toBe('err_tooMany');
    expect(savedErrorKey('CONFLICT')).toBe('err_changed');
    expect(savedErrorKey('NOT_FOUND')).toBe('err_gone');
    expect(savedErrorKey('NETWORK')).toBe('err_failed');
  });
});

describe('nameProblem: the same rules as the API, before the call', () => {
  it('accepts a normal name and refuses empty, too long and angle brackets', () => {
    expect(nameProblem('Wiring')).toBeNull();
    expect(nameProblem('  ')).toBe('err_empty');
    expect(nameProblem('x'.repeat(41))).toBe('err_tooLong');
    expect(nameProblem('a<b')).toBe('err_invalid');
  });
});

describe('freeSuggestions / withCollection', () => {
  it('leaves out suggested names the member already has, ignoring case', () => {
    expect(
      freeSuggestions(
        [
          { code: 'wiring', word: 'Wiring' },
          { code: 'tips', word: 'Tips' },
        ],
        ['wiring'],
      ),
    ).toEqual([{ code: 'tips', word: 'Tips' }]);
  });
  it('ticks and unticks one collection on an item without touching the others', () => {
    const a = withCollection({ ...item('job', 'UJ'), collectionIds: ['c1'] }, 'c2', true);
    expect(a.collectionIds).toEqual(['c1', 'c2']);
    expect(withCollection(a, 'c2', true).collectionIds).toEqual(['c1', 'c2']);
    expect(withCollection(a, 'c1', false).collectionIds).toEqual(['c2']);
  });
});

describe('words and events', () => {
  const keys = (o: unknown): string[] => Object.keys(o ?? {}).sort();
  it('ustaad.saved has the same keys in English and Hindi, none empty', () => {
    const e = (en as unknown as { ustaad: { saved: Record<string, string> } }).ustaad.saved;
    const h = (hi as unknown as { ustaad: { saved: Record<string, string> } }).ustaad.saved;
    expect(keys(h)).toEqual(keys(e));
    for (const v of Object.values(h)) expect(v.trim()).not.toBe('');
  });
});
