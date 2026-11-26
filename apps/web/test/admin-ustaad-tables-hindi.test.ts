/**
 * Hindi on the Admin → Ustaad lists (hard rule 10; state audit API-ADM-USTAAD on /hi found "batteries" from a
 * promotion's English title in a screen-reader label). A row is named by its Hindi text on /hi when the row has one
 * (`nameHi`, `titleHi`, `labelHi`, `textHi`); names staff type in one language only (word-list phrases, hashtag slugs,
 * codes) stay as typed and are marked as user content around the name only, never around our own words.
 */
import { describe, expect, it } from 'vitest';
import { TABLES, wordsTable } from '../src/lib/admin-ustaad-tables-config';
import { rowName, splitAroundName } from '../src/lib/admin-ustaad-tables';

describe('rowName', () => {
  const promo = { titleEn: 'Exide batteries', titleHi: 'एक्साइड बैटरी' };
  it('uses the Hindi text on /hi when the row has one', () => {
    expect(rowName(TABLES.promotions, promo, 'hi')).toEqual({ text: 'एक्साइड बैटरी', localized: true });
    expect(rowName(TABLES.badges, { nameEn: 'Battery king', nameHi: 'बैटरी किंग' }, 'hi').text).toBe(
      'बैटरी किंग',
    );
    expect(rowName(TABLES.reasons, { code: 'spam', labelEn: 'Spam', labelHi: 'स्पैम' }, 'hi').text).toBe(
      'स्पैम',
    );
    expect(rowName(TABLES.coachmarks, { textEn: 'Tap to ask', textHi: 'दबाकर पूछें' }, 'hi').text).toBe(
      'दबाकर पूछें',
    );
    expect(rowName(TABLES.cities, { name: 'Raipur', nameHi: 'रायपुर' }, 'hi').text).toBe('रायपुर');
  });
  it('uses the English text in English, and the typed text when there is no Hindi', () => {
    expect(rowName(TABLES.promotions, promo, 'en')).toEqual({ text: 'Exide batteries', localized: true });
    expect(rowName(TABLES.promotions, { titleEn: 'Exide', titleHi: '' }, 'hi').text).toBe('Exide');
    expect(rowName(wordsTable('scam_phrase'), { phrase: 'registration fee' }, 'hi')).toEqual({
      text: 'registration fee',
      localized: false,
    });
    expect(rowName(TABLES.tags, { slug: 'battery' }, 'hi')).toEqual({ text: 'battery', localized: false });
  });
});

describe('splitAroundName', () => {
  it('keeps the sentence and its word order, with the name cut out for a marker', () => {
    expect(splitAroundName((name) => `${name} बदलें`)).toEqual({ before: '', after: ' बदलें' });
    expect(splitAroundName((name) => `Edit ${name}`)).toEqual({ before: 'Edit ', after: '' });
    expect(splitAroundName((name) => `#${name} मिलाएँ`)).toEqual({ before: '#', after: ' मिलाएँ' });
  });
});
