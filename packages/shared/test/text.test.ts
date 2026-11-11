import { describe, expect, it } from 'vitest';
import { cleanContentText } from '../src/content';
import { cleanLine } from '../src/text';

describe('plain-text cleaning (review low: Hindi joiners)', () => {
  it('keeps ZWJ/ZWNJ inside Devanagari words instead of splitting them', () => {
    const word = 'क्‍ष और क्‌ष'; // conjunct forms written with ZWJ (U+200D) and ZWNJ (U+200C)
    expect(cleanLine(word, 100)).toBe(word);
    expect(cleanContentText('hero.titleLine1', word)).toBe(word);
  });

  it('drops other invisible format characters without splitting the word, and control characters', () => {
    expect(cleanLine('ab‮cd​ef', 100)).toBe('abcdef');
    expect(cleanLine('one\u0007two\nthree', 100)).toBe('one two three');
  });

  it('never cuts a character in half at the length limit', () => {
    expect(cleanLine('ab😀', 3)).toBe('ab');
    expect(cleanLine('ab😀', 4)).toBe('ab😀');
  });
});
