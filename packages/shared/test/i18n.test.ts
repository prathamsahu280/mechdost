import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';

/** Hard rule 10: every string exists in English and Hindi (skill next-intl-hindi, website-testing §G3). */
interface Tree {
  [key: string]: string | Tree;
}

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();

describe('locale messages', () => {
  const enLeaves = leaves(en);
  const hiLeaves = leaves(hi);

  it('have identical keys', () => {
    expect([...hiLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it('have no empty values', () => {
    for (const [key, value] of [...enLeaves, ...hiLeaves]) expect(value.trim(), key).not.toBe('');
  });

  it('use the same ICU placeholders in both languages', () => {
    for (const [key, value] of enLeaves)
      expect(placeholders(hiLeaves.get(key) ?? ''), key).toEqual(placeholders(value));
  });

  it('are actually translated (Hindi text contains Devanagari unless it is a brand or number)', () => {
    const allowedLatin = new Set([
      'common.brand',
      'announcement.brand',
      'language.other',
      'language.otherName',
      'footer.whatsapp',
      'footer.copyright',
      'assistant.bot',
      'catalogue.mrp',
      'policies.company.gstinLabel', // a registration code (hard rule 10 allows codes)
    ]);
    for (const [key, value] of hiLeaves) {
      if (allowedLatin.has(key)) continue;
      if (!/\p{L}/u.test(value.replace(/\{[^}]*\}/g, ''))) continue; // placeholders and punctuation only
      expect(/[ऀ-ॿ]/.test(value), key).toBe(true);
    }
  });

  it('never contain mojibake from the concept capture', () => {
    for (const value of [...enLeaves.values(), ...hiLeaves.values()]) expect(value).not.toMatch(/Â|â€|Ã/);
  });
});
