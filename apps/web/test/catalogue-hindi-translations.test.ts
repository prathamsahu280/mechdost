import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogueProperNameForms } from '@mechdost/shared/catalogue-hindi';
import { latinOffenders } from './hindi-allowlist';

/**
 * The imported catalogue's reviewed Hindi (`docs/catalogue/catalogue-v2-translations-hi.json`) must pass the same
 * English-word check as every `/hi` page (hard rule 10), with the maker's brand and series names allowed.
 */
describe('imported catalogue Hindi passes the /hi English-word check', () => {
  const file = JSON.parse(
    readFileSync(
      new URL('../../../docs/catalogue/catalogue-v2-translations-hi.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, string>;
  const extra = catalogueProperNameForms();

  it('every translated name, value and description', () => {
    const bad = Object.entries(file).flatMap(([en, hi]) => {
      const words = latinOffenders(hi, extra);
      return words.length > 0 ? [`${en.slice(0, 50)} => ${words.join(', ')}`] : [];
    });
    expect(bad).toEqual([]);
  });
});
