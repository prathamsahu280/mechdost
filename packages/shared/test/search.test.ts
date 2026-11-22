import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_VOCAB,
  didYouMean,
  normaliseViscosity,
  parseSearchQuery,
  scoreProductText,
  type SearchableProductText,
} from '../src/search';

const parse = (q: string) => parseSearchQuery(q);

describe('viscosity grades', () => {
  it.each(['20w40', '20 w 40', '20W-40', '20w-40', '20 W - 40', '20W 40'])('%s → 20W-40', (q) => {
    expect(parse(`castrol ${q}`).viscosity).toBe('20W-40');
  });
  it('keeps 0W-20 and 5W-30', () => {
    expect(parse('0w20 oil').viscosity).toBe('0W-20');
    expect(parse('5w30').viscosity).toBe('5W-30');
  });
  it('rejects impossible grades', () => {
    expect(normaliseViscosity('99', '4')).toBeNull();
  });
  it('removes the grade from the free text', () => {
    expect(parse('20w40 bike oil').text).toBe('oil');
  });
});

describe('pack sizes', () => {
  it.each([
    ['900ml', 900, 'ml'],
    ['0.9 l', 900, 'ml'],
    ['1 ltr', 1000, 'ml'],
    ['1l', 1000, 'ml'],
    ['5 litre', 5000, 'ml'],
    ['3.5 liter', 3500, 'ml'],
    ['500 gm', 500, 'g'],
    ['1 kg', 1000, 'g'],
    ['250g', 250, 'g'],
  ])('%s', (q, qty, unit) => {
    expect(parse(`castrol ${q}`).netQty).toEqual({ qty, unit });
  });
  it('does not read the viscosity as a pack', () => {
    expect(parse('20w40').netQty).toBeNull();
  });
});

describe('battery and tyre attributes', () => {
  it('reads Ah and voltage', () => {
    expect(parse('exide 35ah').ah).toBe(35);
    expect(parse('exide 35 ah 12v').voltage).toBe(12);
  });
  it.each([
    ['90/90-12', '90/90-12'],
    ['145/80 R12', '145/80R12'],
    ['145/80r12', '145/80R12'],
    ['2.75-17', '2.75-17'],
    ['2.75 - 17', '2.75-17'],
  ])('tyre size %s', (q, size) => {
    expect(parse(`tyre ${q}`).tyreSize).toBe(size);
  });
  it('a pack size is not a tyre size', () => {
    expect(parse('0.9 l').tyreSize).toBeNull();
  });
});

describe('part numbers', () => {
  it('normalised letters+digits of 4 or more', () => {
    expect(parse('NGK BPR6ES').partNumbers).toEqual(['BPR6ES']);
    expect(parse('ngk-bpr6es').partNumbers).toEqual(['NGKBPR6ES']);
  });
  it('plain words and short codes are not part numbers', () => {
    expect(parse('engine oil bs6').partNumbers).toEqual([]);
  });
});

describe('intents', () => {
  it.each([
    ['bike oil', '2W'],
    ['scooty oil', '2W'],
    ['बाइक', '2W'],
    ['स्कूटर', '2W'],
    ['car coolant', '4W'],
    ['suv tyre', '4W'],
    ['गाड़ी', '4W'],
    ['कार', '4W'],
    ['e-rickshaw battery', '3W'],
    ['auto battery', '3W'],
  ])('vehicle %s → %s', (q, type) => {
    expect(parse(q).vehicleType).toBe(type);
  });
  it('trucks and tractors have no 2W/3W/4W type but are recognised', () => {
    expect(parse('truck oil').vehicleType).toBeNull();
    expect(parse('truck oil').vehicleWord).toBe('truck');
    expect(parse('ट्रैक्टर').vehicleWord).toBe('tractor');
  });
  it.each([
    ['engine oil', 'lubricants'],
    ['mobil oil', 'lubricants'],
    ['gear oil', 'lubricants'],
    ['coolant', 'lubricants'],
    ['battery', 'batteries'],
    ['baitri', 'batteries'],
    ['बैटरी', 'batteries'],
    ['tyer', 'tyres'],
    ['टायर', 'tyres'],
    ['air filter', 'filters'],
    ['polish', 'accessories'],
    ['shampoo', 'accessories'],
  ])('category %s → %s', (q, slug) => {
    expect(parse(q).categorySlug).toBe(slug);
  });
  it('Hinglish synonyms expand: tel → oil, तेल → oil', () => {
    expect(parse('tel').expansions.tel).toContain('oil');
    expect(parse('इंजन तेल').expansions['तेल']).toContain('oil');
  });
  it('the vocabulary has no duplicate (term, kind)', () => {
    const keys = DEFAULT_SEARCH_VOCAB.map((v) => `${v.kind}:${v.term}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('free text and edge cases', () => {
  it('empty and punctuation-only input', () => {
    expect(parse('   ').text).toBe('');
    expect(parse('!!! ???').text).toBe('');
  });
  it('keeps brand words', () => {
    expect(parse('castrol 900ml').text).toBe('castrol');
  });
  it('disabled vocabulary entries are ignored', () => {
    const vocab = DEFAULT_SEARCH_VOCAB.map((v) => (v.term === 'tel' ? { ...v, active: false } : v));
    expect(parseSearchQuery('tel', vocab).expansions.tel).toBeUndefined();
  });
});

describe('properties', () => {
  it('never throws and always returns normalised output', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (q) => {
        const r = parse(q);
        expect(r.text).toBe(r.text.trim());
        expect(r.text).not.toMatch(/\s{2,}/);
      }),
    );
  });
  it('viscosity spelling is irrelevant', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('0', '5', '10', '15', '20', '25'),
        fc.constantFrom('30', '40', '50', '60'),
        fc.constantFrom('', ' ', '-', ' - '),
        fc.boolean(),
        (a, b, sep, upper) => {
          const w = upper ? 'W' : 'w';
          expect(parse(`${a}${w}${sep}${b}`).viscosity).toBe(`${a}W-${b}`);
          expect(parse(`${a} ${w}${sep}${b}`).viscosity).toBe(`${a}W-${b}`);
        },
      ),
    );
  });
  it('litres and millilitres agree', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom('l', ' l', 'ltr', ' litre', ' liter'),
        (n, u) => {
          expect(parse(`${n}${u}`).netQty).toEqual({ qty: n * 1000, unit: 'ml' });
          expect(parse(`${n * 1000}ml`).netQty).toEqual({ qty: n * 1000, unit: 'ml' });
        },
      ),
    );
  });
  it('Ah is read for any capacity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.constantFrom('ah', ' ah', 'AH'), (n, u) => {
        expect(parse(`${n}${u}`).ah).toBe(n);
      }),
    );
  });
});

describe('scoreProductText (the demo ranker, same rules as the SQL)', () => {
  const p = (over: Partial<SearchableProductText>): SearchableProductText => ({
    name: '',
    brand: '',
    text: '',
    categorySlug: 'lubricants',
    vehicleTypes: [],
    packs: [],
    inStock: true,
    ...over,
  });
  const oil2w = p({
    name: 'Castrol Activ 4T 20W40 900 ml',
    brand: 'Castrol',
    text: 'engine oil for 2w 20w40 900 ml',
    vehicleTypes: ['2W'],
    packs: [{ qty: 900, unit: 'ml' }],
  });
  const oil4w = p({
    name: 'Castrol Magnatec 5W-30 3.5 L',
    brand: 'Castrol',
    text: 'engine oil for 4w 5w-30 3.5 l',
    vehicleTypes: ['4W'],
    packs: [{ qty: 3500, unit: 'ml' }],
  });
  it('attribute matches outrank plain text matches', () => {
    const q = parse('20w40 bike oil');
    expect(scoreProductText(q, oil2w)).toBeGreaterThan(scoreProductText(q, oil4w));
  });
  it('pack size boosts', () => {
    const q = parse('castrol 900ml');
    expect(scoreProductText(q, oil2w)).toBeGreaterThan(scoreProductText(q, oil4w));
  });
  it('non-matching products score 0', () => {
    expect(scoreProductText(parse('exide'), oil2w)).toBe(0);
  });
  it('a typo still matches the brand', () => {
    expect(scoreProductText(parse('castrl'), oil2w)).toBeGreaterThan(0);
  });
});

describe('didYouMean', () => {
  const candidates = ['Castrol', 'Exide', 'Mobil', 'Batteries', 'Lubricants'];
  it('suggests the closest candidate for a typo', () => {
    expect(didYouMean('castrool', candidates)).toBe('Castrol');
    expect(didYouMean('exidee', candidates)).toBe('Exide');
  });
  it('suggests nothing for gibberish or an exact match', () => {
    expect(didYouMean('zzzzqq', candidates)).toBeNull();
    expect(didYouMean('castrol', candidates)).toBeNull();
  });
});
