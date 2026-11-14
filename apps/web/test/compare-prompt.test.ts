import { beforeEach, describe, expect, it } from 'vitest';
import { cleanLabel, isCompareSignal, startNew, toPrompt } from '../src/lib/compare/prompt';
import { COMPARE_EVENT, signal } from '../src/lib/compare/signal';
import { addToCompare, readCompare, type CompareList } from '../src/lib/compare/store';

/**
 * The tray's question and notices (redesign 2026-11-14, review C1): the always-loaded toggle only signals
 * (`signal()`, a CustomEvent); the lazily loaded tray turns the signal into a prompt with `toPrompt`.
 */
const events: CustomEvent[] = [];
function fakeWindow(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  events.length = 0;
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
        if (e instanceof CustomEvent) events.push(e);
        return true;
      },
    },
  });
}

const OILS: CompareList = { category: 'lubricants', slugs: ['oil', 'oil-2'], name: 'Lubricants', lang: 'en' };

describe('compare signals and prompts', () => {
  beforeEach(() => {
    fakeWindow();
  });

  it('signal() sends one change event carrying the request', () => {
    signal({ ask: 'switch', slug: 'battery', category: 'batteries', name: 'Batteries', lang: 'en' });
    signal({ say: 'Added to compare (1 of 4)' });
    expect(events.map((e) => e.type)).toEqual([COMPARE_EVENT, COMPARE_EVENT]);
    expect(isCompareSignal(events[0]?.detail)).toBe(true);
    expect(isCompareSignal(events[1]?.detail)).toBe(true);
    expect(isCompareSignal('prompt')).toBe(false);
    expect(isCompareSignal({ ask: 'something else' })).toBe(false);
    expect(isCompareSignal(null)).toBe(false);
  });

  it('another category becomes the question, naming both categories and the count', () => {
    expect(
      toPrompt(
        { ask: 'switch', slug: 'battery', category: 'batteries', name: 'Batteries', lang: 'en' },
        OILS,
      ),
    ).toEqual({
      kind: 'switch',
      slug: 'battery',
      category: 'batteries',
      from: 'lubricants',
      name: 'Batteries',
      lang: 'en',
      fromName: 'Lubricants',
      fromLang: 'en',
      fromCount: 2,
    });
  });

  it('a question with nothing to replace, or for the same category, is no question', () => {
    const ask = { ask: 'switch', slug: 'battery', category: 'batteries' } as const;
    expect(toPrompt(ask, { category: null, slugs: [] })).toBeNull();
    expect(toPrompt(ask, { category: 'batteries', slugs: ['b'] })).toBeNull();
  });

  it('full, refused save and other notices pass through', () => {
    expect(toPrompt({ ask: 'full', slug: 'e', category: 'lubricants' }, OILS)).toEqual({ kind: 'full' });
    expect(toPrompt({ ask: 'save_failed', slug: 'e', category: 'lubricants' }, OILS)).toEqual({
      kind: 'save_failed',
    });
    expect(toPrompt({ ask: 'notice', text: 'You can add up to 99.' }, OILS)).toEqual({
      kind: 'notice',
      text: 'You can add up to 99.',
    });
  });

  it('names are shown only when they are short plain text with a language code', () => {
    expect(cleanLabel('Lubricants', 'en')).toEqual({ name: 'Lubricants', lang: 'en' });
    expect(cleanLabel('x'.repeat(61), 'en')).toEqual({});
    expect(cleanLabel('<b>Oil</b>', 'en')).toEqual({});
    expect(cleanLabel('Oil', 'english')).toEqual({});
    expect(cleanLabel(3, 'en')).toEqual({});
  });

  it('"Start new" replaces the list with that one product and its category name', () => {
    addToCompare('oil', 'lubricants', { name: 'Lubricants', lang: 'en' });
    const p = toPrompt(
      { ask: 'switch', slug: 'battery', category: 'batteries', name: 'Batteries', lang: 'en' },
      readCompare(),
    );
    expect(p?.kind).toBe('switch');
    if (p?.kind !== 'switch') return;
    expect(startNew(p)).toBe('added');
    expect(readCompare()).toEqual({
      category: 'batteries',
      slugs: ['battery'],
      name: 'Batteries',
      lang: 'en',
    });
  });

  it('"Start new" reports a browser that refuses to save', () => {
    fakeWindow({ failWrites: true });
    const p = toPrompt({ ask: 'switch', slug: 'battery', category: 'batteries' }, OILS);
    if (p?.kind !== 'switch') throw new Error('expected a question');
    expect(startNew(p)).toBe('save_failed');
  });
});
