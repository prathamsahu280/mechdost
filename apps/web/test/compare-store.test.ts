import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToCompare,
  answerSwitch,
  clearCompare,
  COMPARE_MAX,
  compareHref,
  dismissPrompt,
  readCompare,
  readPrompt,
  removeFromCompare,
  startNewComparison,
} from '../src/lib/compare/store';
import { COMPARE_EVENT } from '../src/lib/compare/signal';

/** Minimal browser stand-in: localStorage, storage-event listeners, and the change event it sends. */
const sent: string[] = [];
function fakeWindow(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  sent.length = 0;
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (opts.failWrites) throw new Error('QuotaExceededError');
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: (e: Event) => {
        sent.push(e instanceof CustomEvent && e.detail === 'prompt' ? `${e.type}:prompt` : e.type);
        return true;
      },
    },
  });
  return data;
}

describe('compare list (design 2026-11-13)', () => {
  beforeEach(() => {
    fakeWindow();
    dismissPrompt();
    sent.length = 0;
  });

  it('tells the page after every change, so the tray loader can load the tray (JS budget 2026-11-13)', () => {
    addToCompare('castrol-activ-4t-20w40-900ml', 'lubricants');
    removeFromCompare('castrol-activ-4t-20w40-900ml');
    expect(sent).toEqual([COMPARE_EVENT, COMPARE_EVENT]);
  });

  it('holds at most 4 products of one category', () => {
    expect(COMPARE_MAX).toBe(4);
    for (const s of ['a', 'b', 'c', 'd']) expect(addToCompare(s, 'lubricants')).toBe('added');
    expect(addToCompare('e', 'lubricants')).toBe('full');
    expect(readCompare()).toEqual({ category: 'lubricants', slugs: ['a', 'b', 'c', 'd'] });
  });

  it('adding the same product twice keeps one', () => {
    addToCompare('a', 'lubricants');
    expect(addToCompare('a', 'lubricants')).toBe('added');
    expect(readCompare().slugs).toEqual(['a']);
  });

  it('refuses another category and can start a new comparison instead', () => {
    addToCompare('oil', 'lubricants');
    expect(addToCompare('battery', 'batteries')).toBe('other_category');
    expect(readCompare()).toEqual({ category: 'lubricants', slugs: ['oil'] });
    expect(startNewComparison('battery', 'batteries')).toBe('added');
    expect(readCompare()).toEqual({ category: 'batteries', slugs: ['battery'] });
  });

  it('removes and clears; an empty list has no category', () => {
    addToCompare('a', 'tyres');
    addToCompare('b', 'tyres');
    removeFromCompare('a');
    expect(readCompare()).toEqual({ category: 'tyres', slugs: ['b'] });
    removeFromCompare('b');
    expect(readCompare()).toEqual({ category: null, slugs: [] });
    addToCompare('c', 'batteries');
    clearCompare();
    expect(readCompare()).toEqual({ category: null, slugs: [] });
  });

  it('ignores a tampered stored value', () => {
    const data = fakeWindow();
    data.set(
      'mechdost-compare',
      JSON.stringify({ category: 'tyres', slugs: ['ok', 3, 'BAD SLUG', 'a', 'b', 'c', 'd'] }),
    );
    expect(readCompare()).toEqual({ category: 'tyres', slugs: ['ok', 'a', 'b', 'c'] });
    data.set('mechdost-compare', '{not json');
    expect(readCompare()).toEqual({ category: null, slugs: [] });
  });

  it('reports a browser that refuses to save', () => {
    fakeWindow({ failWrites: true });
    expect(addToCompare('a', 'tyres')).toBe('save_failed');
    expect(startNewComparison('a', 'tyres')).toBe('save_failed');
  });

  it('builds the shareable link', () => {
    expect(compareHref(['a', 'b'])).toBe('/compare?p=a,b');
  });
});

/** One shared question for every card (redesign 2026-11-14): the tray asks, the cards hold no messages. */
describe('the tray question (redesign 2026-11-14)', () => {
  const OIL = { name: 'Lubricants', lang: 'en' };
  const BATTERY = { name: 'Batteries', lang: 'en' };

  beforeEach(() => {
    fakeWindow();
    dismissPrompt();
    sent.length = 0;
  });

  it('keeps the category name and language with the list, for the tray', () => {
    addToCompare('oil', 'lubricants', OIL);
    expect(readCompare()).toEqual({ category: 'lubricants', slugs: ['oil'], name: 'Lubricants', lang: 'en' });
  });

  it('another category raises one question for the tray and changes nothing yet', () => {
    addToCompare('oil', 'lubricants', OIL);
    addToCompare('oil-2', 'lubricants', OIL);
    sent.length = 0;
    expect(addToCompare('battery', 'batteries', BATTERY)).toBe('other_category');
    expect(readPrompt()).toEqual({
      kind: 'switch',
      slug: 'battery',
      category: 'batteries',
      name: 'Batteries',
      lang: 'en',
      fromName: 'Lubricants',
      fromLang: 'en',
      fromCount: 2,
    });
    expect(readCompare().slugs).toEqual(['oil', 'oil-2']);
    // The loader hears it, so the tray loads even if it was not on screen yet.
    expect(sent).toEqual([`${COMPARE_EVENT}:prompt`]);
  });

  it('"Start new" replaces the list with that one product and closes the question', () => {
    addToCompare('oil', 'lubricants', OIL);
    addToCompare('battery', 'batteries', BATTERY);
    expect(answerSwitch(true)).toBe('added');
    expect(readCompare()).toEqual({
      category: 'batteries',
      slugs: ['battery'],
      name: 'Batteries',
      lang: 'en',
    });
    expect(readPrompt()).toBeNull();
  });

  it('"Keep current" changes nothing and closes the question', () => {
    addToCompare('oil', 'lubricants', OIL);
    addToCompare('battery', 'batteries', BATTERY);
    expect(answerSwitch(false)).toBe('kept');
    expect(readCompare().slugs).toEqual(['oil']);
    expect(readPrompt()).toBeNull();
    expect(answerSwitch(true)).toBeNull();
  });

  it('a newer question replaces an older one; any change to the list closes it', () => {
    addToCompare('oil', 'lubricants', OIL);
    addToCompare('battery', 'batteries', BATTERY);
    addToCompare('tyre', 'tyres', { name: 'Tyres', lang: 'en' });
    expect(readPrompt()).toMatchObject({ kind: 'switch', slug: 'tyre' });
    clearCompare();
    expect(readPrompt()).toBeNull();
  });

  it('a fifth product and a refused save are told in the tray too', () => {
    for (const s of ['a', 'b', 'c', 'd']) addToCompare(s, 'lubricants', OIL);
    expect(addToCompare('e', 'lubricants', OIL)).toBe('full');
    expect(readPrompt()).toEqual({ kind: 'full' });
    removeFromCompare('a');
    expect(readPrompt()).toBeNull();
    fakeWindow({ failWrites: true });
    expect(addToCompare('a', 'tyres')).toBe('save_failed');
    expect(readPrompt()).toEqual({ kind: 'save_failed' });
    dismissPrompt();
    expect(readPrompt()).toBeNull();
  });

  it('the snapshot is the same object until something changes (useSyncExternalStore)', () => {
    addToCompare('oil', 'lubricants', OIL);
    addToCompare('battery', 'batteries', BATTERY);
    expect(readPrompt()).toBe(readPrompt());
  });

  it('drops a stored name that is not plain text', () => {
    const data = fakeWindow();
    data.set(
      'mechdost-compare',
      JSON.stringify({ category: 'tyres', slugs: ['a'], name: 'x'.repeat(200), lang: 'english' }),
    );
    expect(readCompare()).toEqual({ category: 'tyres', slugs: ['a'] });
  });
});
