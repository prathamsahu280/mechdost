/**
 * "Does this search mean the person is stuck on the road?" (spec 22, user 2026-11-24). A pure, dependency-free check
 * (the header palette is a lazy browser chunk, spec 16): a match puts a "Roadside help" suggestion above the product
 * results. It is a suggestion only, the product search still runs. Words are whole words (so "tower" or "stuckup" do
 * not match "tow" or "stuck"), in English, Hinglish and Hindi. Both the word lists and the query are NFC-normalised, so
 * a precomposed nukta letter (ड़) matches however it was typed.
 */
const nfc = (w: string): string => w.normalize('NFC');

const SINGLE: ReadonlySet<string> = new Set(
  [
    'roadside',
    'towing',
    'tow',
    'towed',
    'puncture',
    'punctured',
    'punchar',
    'breakdown',
    'breakdowns',
    'stuck',
    'stranded',
    'sos',
    'recovery',
    'रोडसाइड',
    'टोइंग',
    'टो',
    'पंक्चर',
    'पंचर',
    'पंक्चरवाला',
    'ब्रेकडाउन',
    'फंस',
    'फंसी',
    'फंसा',
    'फँस',
    'फँसी',
    'फँसा',
    'एसओएस',
  ].map(nfc),
);

/** Every group of alternatives must have one word present (any order, any place). */
const ALL_OF: readonly (readonly ReadonlySet<string>[])[] = (
  [
    [['flat'], ['tyre', 'tire', 'tyres', 'tires']],
    [['battery'], ['dead', 'down', 'flat']],
    [['road'], ['side']],
    [['tow'], ['truck']],
    [['broke', 'broken'], ['down']],
    [['jump'], ['start']],
    [
      ['car', 'bike', 'gaadi', 'gadi', 'vehicle'],
      ['stopped', 'band', 'kharab'],
    ],
    [
      ['गाड़ी', 'गाडी', 'बाइक', 'कार'],
      ['खराब', 'बंद', 'ख़राब'],
    ],
    [['बैटरी'], ['डेड', 'खत्म', 'बंद']],
    [['टायर'], ['पंक्चर', 'पंचर', 'फट', 'फटा']],
    [['स्टार्ट'], ['नहीं']],
    [['रोड'], ['साइड']],
  ] as const
).map((group) => group.map((alts) => new Set(alts.map(nfc))));

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export function matchesRoadsideIntent(query: string): boolean {
  const words = (nfc(query).toLowerCase().match(WORD) ?? []).slice(0, 12);
  if (words.length === 0) return false;
  if (words.some((w) => SINGLE.has(w))) return true;
  const have = new Set(words);
  return ALL_OF.some((group) => group.every((alts) => [...alts].some((a) => have.has(a))));
}
