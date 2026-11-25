import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { correctionSegments, type CorrectResponseView } from '@mechdost/shared/ustaad/correction';
import {
  applyChoice,
  correctionErrorKey,
  shownText,
  suggestViewFor,
  textLang,
  visibleSegments,
} from '../src/lib/ustaad/correction';

const result = (over: Partial<CorrectResponseView> = {}): CorrectResponseView => {
  const original = 'brek kaam nhi kr rha';
  const text = 'Brake kaam nahi kar raha.';
  const segments = correctionSegments(original, text);
  return {
    mode: 'suggest',
    engine: 'wordlist',
    text,
    original,
    changed: true,
    changes: segments.filter((s) => s.kind === 'changed').length,
    segments,
    ...over,
  };
};

describe('smart correction on the web (spec 23 § 11)', () => {
  it('shows the suggest card only for a changed suggest result; auto and clear otherwise', () => {
    expect(suggestViewFor(result()).kind).toBe('suggest');
    expect(suggestViewFor(result({ mode: 'auto' })).kind).toBe('auto');
    expect(suggestViewFor(result({ changed: false })).kind).toBe('clear');
    expect(suggestViewFor(result({ mode: 'off' })).kind).toBe('clear');
  });

  it('Use suggestion stores the original and offers Undo; Keep mine and Edit myself keep the member text', () => {
    expect(applyChoice('use', result())).toEqual({
      text: 'Brake kaam nahi kar raha.',
      undo: 'brek kaam nhi kr rha',
      correction: 'suggested_used',
      original: 'brek kaam nhi kr rha',
    });
    for (const c of ['keep', 'edit'] as const)
      expect(applyChoice(c, result())).toEqual({
        text: 'brek kaam nhi kr rha',
        undo: null,
        correction: 'none',
        original: null,
      });
  });

  it('visible segments rebuild the suggestion exactly', () => {
    const r = result();
    expect(
      visibleSegments(r.segments)
        .map((s) => s.text)
        .join(''),
    ).toBe(r.text);
  });

  it('"Edited · see original" swaps to the original only when there is one', () => {
    const post = { body: 'Brake kaam nahi kar raha.', bodyOriginal: 'brek kaam nhi kr rha' };
    expect(shownText(post, false)).toBe(post.body);
    expect(shownText(post, true)).toBe(post.bodyOriginal);
    expect(shownText({ body: 'x', bodyOriginal: null }, true)).toBe('x');
  });

  it('maps errors and member-text language', () => {
    expect(correctionErrorKey('RATE_LIMITED')).toBe('limited');
    expect(correctionErrorKey('NETWORK')).toBe('failed');
    expect(textLang('बैटरी नई है')).toBe('hi');
    expect(textLang('battery new hai')).toBeUndefined(); // no guessed Hinglish voice for Latin text
    expect(textLang('battery new hai', 'hinglish')).toBe('hi-Latn');
    expect(textLang('battery is new', 'en')).toBe('en');
    expect(textLang('6301')).toBeUndefined();
  });

  it('has every correction string in English and Hindi', () => {
    const e = en.ustaad.correction as Record<string, string>;
    const h = hi.ustaad.correction as Record<string, string>;
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of ['title', 'youWrote', 'use', 'keep', 'edit', 'edited', 'seeFixed', 'autoNote', 'undo'])
      expect(h[k]?.trim(), k).toBeTruthy();
    expect(h.use).not.toMatch(/[A-Za-z]/);
  });
});
