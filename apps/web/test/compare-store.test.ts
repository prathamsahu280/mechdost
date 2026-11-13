import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToCompare,
  clearCompare,
  COMPARE_MAX,
  compareHref,
  readCompare,
  removeFromCompare,
  startNewComparison,
} from '../src/lib/compare/store';

/** Minimal browser stand-in: the store needs localStorage and storage-event listeners only. */
function fakeWindow(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>();
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
    },
  });
  return data;
}

describe('compare list (design 2026-11-13)', () => {
  beforeEach(() => {
    fakeWindow();
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
