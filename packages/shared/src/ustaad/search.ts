/**
 * Discover search across scripts (SIM-P22, live QA 2026-11-27): "Ramesh" must find "रमेश वर्मा" and "सुरेश" must find
 * "Suresh Sahu", and work words ("wiring", "बैटरी") must match members' work tags.
 *
 * A name key is the consonant skeleton of a name in one shared Latin alphabet: vowels, matras, `h` / `ह` (aspiration),
 * virama, nukta and chandrabindu are dropped, and sound-alike letters fold together (v/w, f/ph/फ → p, z/ज़ → j,
 * q/क़ → k, श/ष/स → s, ड़ → r, anusvara → n). "Ramesh", "रमेश" and "Rameshh" all give `rms`. The same map is used in
 * TypeScript (for the typed query) and in SQL through `translate()` (for stored names), so both sides always agree.
 */
const FOLD: readonly (readonly [string, string])[] = [
  ['w', 'v'],
  ['f', 'p'],
  ['z', 'j'],
  ['q', 'k'],
  ['x', 'k'],
  ['क', 'k'],
  ['ख', 'k'],
  ['ग', 'g'],
  ['घ', 'g'],
  ['ङ', 'n'],
  ['च', 'c'],
  ['छ', 'c'],
  ['ज', 'j'],
  ['झ', 'j'],
  ['ञ', 'n'],
  ['ट', 't'],
  ['ठ', 't'],
  ['त', 't'],
  ['थ', 't'],
  ['ड', 'd'],
  ['ढ', 'd'],
  ['द', 'd'],
  ['ध', 'd'],
  ['ण', 'n'],
  ['न', 'n'],
  ['प', 'p'],
  ['फ', 'p'],
  ['ब', 'b'],
  ['भ', 'b'],
  ['म', 'm'],
  ['य', 'y'],
  ['र', 'r'],
  ['ल', 'l'],
  ['ळ', 'l'],
  ['व', 'v'],
  ['श', 's'],
  ['ष', 's'],
  ['स', 's'],
  ['ं', 'n'],
  ['क़', 'k'], // क़
  ['ख़', 'k'], // ख़
  ['ग़', 'g'], // ग़
  ['ज़', 'j'], // ज़
  ['ड़', 'r'], // ड़
  ['ढ़', 'r'], // ढ़
  ['फ़', 'p'], // फ़
  ['य़', 'y'], // य़
];
/** Dropped: Latin vowels and h; Devanagari vowels, matras, ह, virama, nukta, chandrabindu, visarga. */
const DROP = 'aeiouhअआइईउऊऋएऐओऔऑऍािीुूृेैोौॉॅह़्ँः';

export const NAME_KEY_FROM = FOLD.map(([a]) => a).join('') + DROP;
export const NAME_KEY_TO = FOLD.map(([, b]) => b).join('');

const MAP = new Map<string, string>([
  ...FOLD.map(([a, b]) => [a, b] as [string, string]),
  ...Array.from(DROP, (c) => [c, ''] as [string, string]),
]);

/** The name key of a typed query or a stored name (NFC, lower case, single spaces). */
export function ustaadNameKey(text: string): string {
  const lower = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  let out = '';
  for (const ch of lower) out += MAP.get(ch) ?? ch;
  return out;
}

/** Work words in both languages and common spellings → the member's work and vehicle codes. */
export const USTAAD_WORK_WORDS: Readonly<Record<string, readonly string[]>> = {
  electrical: [
    'electrical',
    'electric',
    'electrician',
    'wiring',
    'wire',
    'bijli',
    'बिजली',
    'वायरिंग',
    'इलेक्ट्रिकल',
  ],
  battery: ['battery', 'battri', 'batri', 'बैटरी', 'बैट्री'],
  engine: ['engine', 'engin', 'injan', 'इंजन', 'इंजिन'],
  ac: ['ac', 'aircon', 'a/c', 'एसी'],
  tyres: ['tyre', 'tyres', 'tire', 'tires', 'puncture', 'टायर', 'पंचर'],
  denting_painting: ['denting', 'painting', 'dent', 'paint', 'डेंटिंग', 'पेंटिंग'],
  suspension_brakes: ['brake', 'brakes', 'suspension', 'ब्रेक', 'सस्पेंशन'],
  diagnostics: ['diagnostics', 'diagnosis', 'scanner', 'obd', 'स्कैनर'],
  ev: ['ev', 'e-rickshaw', 'erickshaw', 'ई रिक्शा', 'इलेक्ट्रिक गाड़ी'],
  two_wheeler: ['bike', 'scooter', 'two wheeler', 'बाइक', 'स्कूटर'],
};

/** Work codes a query names (whole words, either script). */
export function ustaadWorkCodesFor(query: string): string[] {
  const q = query.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const words = new Set(q.split(' '));
  return Object.entries(USTAAD_WORK_WORDS)
    .filter(([, list]) => list.some((w) => w === q || words.has(w)))
    .map(([code]) => code);
}
