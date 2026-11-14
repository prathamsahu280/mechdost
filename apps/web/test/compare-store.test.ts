import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/lib/compare/store';
import {
  addToCompare,
  clearCompare,
  COMPARE_MAX,
  compareHref,
  readCompare,
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
        sent.push(e.type);
        return true;
      },
    },
  });
  return data;
}

describe('compare list (design 2026-11-13)', () => {
  beforeEach(() => {
    fakeWindow();
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

  it('refuses another category without changing anything, and can start a new comparison instead', () => {
    addToCompare('oil', 'lubricants');
    sent.length = 0;
    expect(addToCompare('battery', 'batteries')).toBe('other_category');
    expect(readCompare()).toEqual({ category: 'lubricants', slugs: ['oil'] });
    expect(sent).toEqual([]);
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

describe('category name kept with the list (redesign 2026-11-14)', () => {
  beforeEach(() => {
    fakeWindow();
  });

  it('the first product names the category in the page language; later ones keep it', () => {
    addToCompare('oil', 'lubricants', { name: 'Lubricants', lang: 'en' });
    addToCompare('oil-2', 'lubricants', { name: 'ignored', lang: 'hi' });
    expect(readCompare()).toEqual({
      category: 'lubricants',
      slugs: ['oil', 'oil-2'],
      name: 'Lubricants',
      lang: 'en',
    });
    expect(startNewComparison('battery', 'batteries', { name: 'Batteries', lang: 'en' })).toBe('added');
    expect(readCompare()).toMatchObject({ category: 'batteries', name: 'Batteries', lang: 'en' });
  });

  it('a stored name that is not a string is dropped (the tray validates it before showing it)', () => {
    const data = fakeWindow();
    data.set('mechdost-compare', JSON.stringify({ category: 'tyres', slugs: ['a'], name: 3, lang: 'en' }));
    expect(readCompare()).toEqual({ category: 'tyres', slugs: ['a'] });
  });

  /**
   * JS budget (review 2026-11-14, C1): the store ships on every shop page, so the tray's question logic lives in
   * `prompt.ts`, which only the lazily loaded tray imports.
   */
  it('keeps no question state: that belongs to the tray', () => {
    expect(Object.keys(store).sort()).toEqual(
      [
        'COMPARE_MAX',
        'addToCompare',
        'clearCompare',
        'compareHref',
        'readCompare',
        'removeFromCompare',
        'startNewComparison',
        'useCompare',
      ].sort(),
    );
  });
});
