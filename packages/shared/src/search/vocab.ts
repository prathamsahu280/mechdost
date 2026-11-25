/**
 * The search vocabulary (spec 02 "Smart search", design 2026-11-22). One list serves three jobs: the seed of the
 * admin-editable `search_synonyms` table (migration 0080), the fallback when the table is empty, and the demo
 * catalogue's search. Dependency-free on purpose: the suggestion island imports it (budget, spec 16).
 *
 * Kinds:
 * - `synonym`: a single word (any script) that also means other words ("tel" → "oil"); the expansions are OR-ed into
 *   the text search and the original word stays.
 * - `category`: a word or phrase that points at a category slug (`expandsTo[0]`); a boost, or the filter when the query
 *   has no other words. Matched on the words and their synonym expansions, longest phrase first.
 * - `vehicle`: a word or phrase for a vehicle; `expandsTo[0]` is `2W`/`3W`/`4W`, or a plain word ("truck") when the
 *   catalogue has no such type (the word is then only a text hint).
 */
export const SEARCH_VOCAB_KINDS = ['synonym', 'category', 'vehicle'] as const;
export type SearchVocabKind = (typeof SEARCH_VOCAB_KINDS)[number];
export const SEARCH_VOCAB_LOCALES = ['en', 'hi', 'hinglish'] as const;
export type SearchVocabLocale = (typeof SEARCH_VOCAB_LOCALES)[number];

export interface SearchVocabEntry {
  term: string;
  locale: SearchVocabLocale;
  kind: SearchVocabKind;
  expandsTo: readonly string[];
  /** `false` = switched off by an admin; omitted = on. */
  active?: boolean;
}

const e = (
  kind: SearchVocabKind,
  locale: SearchVocabLocale,
  expandsTo: readonly string[],
  ...terms: string[]
): SearchVocabEntry[] => terms.map((term) => ({ term, locale, kind, expandsTo }));

export const DEFAULT_SEARCH_VOCAB: readonly SearchVocabEntry[] = [
  // Hinglish and Hindi words for the things people search.
  ...e('synonym', 'hinglish', ['oil'], 'tel', 'oyl'),
  ...e('synonym', 'hi', ['oil'], 'तेल', 'ऑयल', 'आयल'),
  ...e('synonym', 'hinglish', ['battery'], 'baitri', 'battri', 'bettery'),
  ...e('synonym', 'hi', ['battery'], 'बैटरी', 'बेटरी'),
  ...e('synonym', 'hinglish', ['tyre', 'tire'], 'tyer', 'tayar', 'tier'),
  ...e('synonym', 'hi', ['tyre', 'tire'], 'टायर', 'टायर्स'),
  ...e('synonym', 'en', ['tyre'], 'tire', 'tires', 'tyres'),
  ...e('synonym', 'hinglish', ['filter'], 'filtar', 'filtr'),
  ...e('synonym', 'hi', ['filter'], 'फ़िल्टर', 'फिल्टर'),
  ...e('synonym', 'hinglish', ['coolant'], 'colant', 'coolent'),
  ...e('synonym', 'hi', ['coolant'], 'कूलेंट'),
  ...e('synonym', 'hinglish', ['grease'], 'grees', 'greez'),
  ...e('synonym', 'hi', ['grease'], 'ग्रीस'),
  ...e('synonym', 'hinglish', ['brake'], 'breek'),
  ...e('synonym', 'hi', ['brake'], 'ब्रेक'),
  ...e('synonym', 'hinglish', ['polish'], 'palish'),
  ...e('synonym', 'hi', ['polish'], 'पॉलिश'),
  ...e('synonym', 'hi', ['shampoo'], 'शैम्पू'),
  ...e('synonym', 'hinglish', ['engine'], 'ingin', 'injan'),
  ...e('synonym', 'hi', ['engine'], 'इंजन'),
  ...e('synonym', 'hinglish', ['car'], 'gaadi', 'gadi'),
  ...e('synonym', 'hinglish', ['bike'], 'baik'),

  // Vehicle intent. 2W / 3W / 4W are the catalogue's types; trucks, buses and tractors are only a text hint.
  ...e('vehicle', 'en', ['2W'], 'bike', 'bikes', 'motorcycle', 'motorbike', 'scooter', 'scooty', 'moped'),
  ...e('vehicle', 'hi', ['2W'], 'बाइक', 'मोटरसाइकिल', 'स्कूटर', 'स्कूटी'),
  ...e('vehicle', 'hinglish', ['2W'], 'baik'),
  ...e('vehicle', 'en', ['4W'], 'car', 'cars', 'suv', 'sedan', 'hatchback'),
  ...e('vehicle', 'hi', ['4W'], 'कार', 'गाड़ी', 'गाड़ियाँ'),
  ...e('vehicle', 'hinglish', ['4W'], 'gaadi', 'gadi', 'gaari'),
  ...e(
    'vehicle',
    'en',
    ['3W'],
    'e-rickshaw',
    'erickshaw',
    'e rickshaw',
    'rickshaw',
    'auto',
    'autorickshaw',
    'tuk tuk',
  ),
  ...e('vehicle', 'hi', ['3W'], 'ई-रिक्शा', 'रिक्शा', 'ऑटो'),
  ...e('vehicle', 'en', ['truck'], 'truck', 'lorry'),
  ...e('vehicle', 'hi', ['truck'], 'ट्रक'),
  ...e('vehicle', 'en', ['bus'], 'bus'),
  ...e('vehicle', 'hi', ['bus'], 'बस'),
  ...e('vehicle', 'en', ['tractor'], 'tractor'),
  ...e('vehicle', 'hi', ['tractor'], 'ट्रैक्टर'),

  // Category intent (slugs of the top-level categories; a child category is included by the listing).
  ...e(
    'category',
    'en',
    ['lubricants'],
    'engine oil',
    'oil',
    'mobil oil',
    'gear oil',
    'brake fluid',
    'coolant',
    'grease',
    'lubricant',
    'lubricants',
    'transmission oil',
    'fork oil',
    'motor oil',
  ),
  ...e('category', 'hi', ['lubricants'], 'लुब्रिकेंट'),
  ...e('category', 'en', ['batteries'], 'battery', 'batteries', 'inverter battery'),
  ...e('category', 'hi', ['batteries'], 'बैटरियां'),
  ...e('category', 'en', ['tyres'], 'tyre', 'tyres', 'tube', 'tubeless'),
  ...e('category', 'en', ['filters'], 'filter', 'filters', 'air filter', 'oil filter', 'fuel filter'),
  ...e('category', 'en', ['bearings'], 'bearing', 'bearings'),
  ...e(
    'category',
    'en',
    ['spare-parts'],
    'spark plug',
    'brake pad',
    'brake pads',
    'clutch plate',
    'chain sprocket',
  ),
  ...e(
    'category',
    'en',
    ['accessories'],
    'polish',
    'shampoo',
    'spray',
    'wax',
    'car care',
    'cleaner',
    'helmet',
  ),
  ...e('category', 'en', ['workshop-tools'], 'spanner', 'wrench', 'tool kit'),
  ...e('category', 'en', ['ev-essentials'], 'ev charger', 'charger'),
];

/** Words that never count for a typo or part-number guess. */
export const SEARCH_STOP_WORDS: ReadonlySet<string> = new Set([
  'for',
  'the',
  'and',
  'with',
  'of',
  'in',
  'a',
  'an',
  'ka',
  'ki',
  'ke',
  'ko',
  'ke',
  'liye',
  'wala',
  'wali',
  'का',
  'की',
  'के',
  'को',
  'लिए',
  'और',
]);

/** Ranking weights, shared by the SQL (`packages/db/src/repo/search.ts`) and the demo ranker; documented in spec 02. */
export const SEARCH_WEIGHTS = {
  /** A query word found in the product name or brand. */
  wordInName: 1,
  /** A query word found in the description / spec / compatibility text only. */
  wordInText: 0.5,
  /** A query word that matches a name or brand only after typo tolerance. */
  wordTypo: 0.3,
  viscosity: 1.5,
  packSize: 0.8,
  batteryAh: 1,
  voltage: 0.5,
  tyreSize: 3,
  partNumber: 1,
  vehicleIntent: 1.5,
  categoryIntent: 0.4,
  inStock: 0.2,
} as const;
