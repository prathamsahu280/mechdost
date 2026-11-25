import type { SmartCorrectionEngine, CorrectionInput } from './engine';
import { guardTokens, meaningGuard, normaliseForGuard } from './guard';

/**
 * Word-list engine (spec 23 § 11): the fallback when no LLM key is set, on error, on timeout, when the daily LLM budget
 * is spent, or when the member has not given the `ustaad_correction` consent. Runs on our server; nothing leaves it.
 *
 * 1. Common Hinglish/Hindi misspellings → corrections: the built-in list below (from the concept prototype) plus the
 *    admin's `ustaad_word_lists` rows of list `correction` (admin rows win).
 * 2. Spacing and punctuation: collapse repeated spaces, no space before , . ? !, capital first letter and a closing
 *    full stop on Latin-script text — never next to a word with a digit (`DOT 3`, `175/65 R14`, `12V`) or a
 *    protected word.
 *
 * A single change that the meaning guard would refuse (an admin row that drops a negation, changes a number or a
 * protected word) is skipped; the other changes stay.
 */
export const BUILT_IN_CORRECTIONS: Readonly<Record<string, string>> = {
  filtr: 'filter',
  fir: 'phir',
  rha: 'raha',
  rhi: 'rahi',
  rhe: 'rahe',
  krta: 'karta',
  krti: 'karti',
  kro: 'karo',
  kr: 'kar',
  krna: 'karna',
  h: 'hai',
  hn: 'hain',
  ni: 'nahi',
  nhi: 'nahi',
  nai: 'nahi',
  nahin: 'nahi',
  battry: 'battery',
  batry: 'battery',
  betry: 'battery',
  baitri: 'battery',
  clik: 'click',
  sterring: 'steering',
  brek: 'brake',
  brak: 'brake',
  engin: 'engine',
  injan: 'engine',
  oill: 'oil',
  tayar: 'tyre',
  tyar: 'tyre',
  tyer: 'tyre',
  kese: 'kaise',
  kayse: 'kaise',
  gadi: 'gaadi',
  gaddi: 'gaadi',
  avrage: 'average',
  avg: 'average',
  pikup: 'pickup',
  servic: 'service',
  sarvis: 'service',
  servis: 'service',
  controler: 'controller',
  kontroler: 'controller',
  plz: 'please',
  pls: 'please',
  wairing: 'wiring',
  cluch: 'clutch',
  clach: 'clutch',
  acclerator: 'accelerator',
  silencr: 'silencer',
  milage: 'mileage',
  rilay: 'relay',
  carburator: 'carburettor',
  karborator: 'carburettor',
  carbrettor: 'carburettor',
  sensar: 'sensor',
  sensr: 'sensor',
  indicater: 'indicator',
  sprokit: 'sprocket',
  kyu: 'kyun',
  mtlb: 'matlab',
  bhot: 'bahut',
  bht: 'bahut',
  thik: 'theek',
  thk: 'theek',
  rikshaw: 'rickshaw',
  riksha: 'rickshaw',
  splendor: 'Splendor',
  activa: 'Activa',
  pulsar: 'Pulsar',
  apache: 'Apache',
  bolero: 'Bolero',
  alto: 'Alto',
  hf: 'HF',
  jupiter: 'Jupiter',
  scorpio: 'Scorpio',
};

export interface WordListRow {
  phrase: string;
  replacement: string;
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const LATIN_WORD = /^[A-Za-z]+$/;
/** No single change is refused for length: the whole-text length rule still applies at the end. */
const PER_CHANGE = { maxLengthChangePct: 10_000 };

export function createWordListEngine(opts: {
  rows?: readonly WordListRow[];
  maxLengthChangePct: number;
}): SmartCorrectionEngine {
  const map = new Map<string, string>(Object.entries(BUILT_IN_CORRECTIONS));
  for (const r of opts.rows ?? []) {
    const key = normaliseForGuard(r.phrase.trim());
    if (key && !/\s/.test(key)) map.set(key, r.replacement.trim());
  }
  return {
    id: 'wordlist',
    model: 'wordlist',
    correct(input: CorrectionInput) {
      return Promise.resolve({ text: wordListCorrect(input, map, opts.maxLengthChangePct) });
    },
  };
}

function wordListCorrect(
  input: CorrectionInput,
  map: ReadonlyMap<string, string>,
  maxLengthChangePct: number,
): string {
  const protectedWords = new Set(input.protected.flatMap((p) => guardTokens(p)));
  const isProtected = (w: string) => protectedWords.has(normaliseForGuard(w));

  let out = input.text.replace(WORD, (word) => {
    if (/\d/.test(word) || isProtected(word)) return word;
    const replacement = map.get(normaliseForGuard(word));
    if (replacement === undefined || replacement === word || replacement === '') return word;
    // A Latin word only gets a Latin replacement and the same for Devanagari (script rule per change).
    if (LATIN_WORD.test(word) !== LATIN_WORD.test(replacement.replace(/[\s-]/g, ''))) return word;
    if (!meaningGuard(word, replacement, input.protected, PER_CHANGE).ok) return word;
    return replacement;
  });

  // Spacing: repeated spaces/tabs, and no space before closing punctuation.
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.?!।])/g, '$1')
    .trim();

  const words = out.match(WORD) ?? [];
  const first = words[0];
  const last = words.at(-1);
  const latin = !/[ऀ-ॿ]/.test(out);
  if (latin && first && /^[a-z]/.test(out) && !/\d/.test(first) && !isProtected(first))
    out = out.charAt(0).toUpperCase() + out.slice(1);
  if (
    latin &&
    last &&
    /[A-Za-z]$/.test(out) &&
    !/\d/.test(last) &&
    !isProtected(last) &&
    !/(?:https?:\/\/|www\.)\S+$/i.test(out)
  )
    out += '.';

  return meaningGuard(input.text, out, input.protected, { maxLengthChangePct }).ok ? out : input.text;
}
