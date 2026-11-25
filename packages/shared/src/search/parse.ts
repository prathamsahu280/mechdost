import { isVehicleSegment, type VehicleSegment } from '../vehicle-segments';
import { isVehicleType, type VehicleType } from '../vehicles';
import { normalisePack, normaliseViscosity, partNumberOf, type PackSize } from './normalise';
import { DEFAULT_SEARCH_VOCAB, SEARCH_STOP_WORDS, type SearchVocabEntry } from './vocab';

/** What the search box text means (spec 02 "Smart search"): attributes, intents, synonym expansions, leftover words. */
export interface ParsedQuery {
  raw: string;
  /** The words that are left to match against names and text (attributes removed, vehicle words removed). */
  text: string;
  /** `20W-40`. */
  viscosity: string | null;
  netQty: PackSize | null;
  ah: number | null;
  voltage: number | null;
  /** `90/90-12`, `145/80R12`, `2.75-17`. */
  tyreSize: string | null;
  /** Compact upper-case part numbers / model codes, at least 4 characters. */
  partNumbers: string[];
  vehicleType: VehicleType | null;
  /** The vehicle word when the catalogue has no such type (a plain-word `vehicle` entry). */
  vehicleWord: string | null;
  /** The vehicle segment a word named ("truck", "tractor", "JCB": design 2026-11-25); the word is removed from `text`. */
  segment: VehicleSegment | null;
  /**
   * The text words that named the segment ("truck" in "truck tyre"). They stay in `text` and match a product by its words
   * as before, or by its segment (an untagged product that says "tractor" is still found, a tagged one need not).
   */
  segmentWords: string[];
  categorySlug: string | null;
  /**
   * The text words that are the category's own name ("battery" in "bike battery", "baitri" too, not "coolant"): a
   * product of that category matches them even when its name does not say so.
   */
  categoryWords: string[];
  /** Synonym expansions per word that has any (`tel` → `oil`). */
  expansions: Record<string, string[]>;
}

/** Whether `word` is the category's own name ("battery"/"batteries" for `batteries`), singular or plural. */
function isCategoryName(word: string, slug: string): boolean {
  const singular = slug.endsWith('ies')
    ? `${slug.slice(0, -3)}y`
    : slug.endsWith('s')
      ? slug.slice(0, -1)
      : slug;
  return word === slug || word === singular;
}

/** NFKC (so `ड़` is one spelling), lower case, and everything that is not a letter, mark or digit becomes a space. */
export function tokenise(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/** Each pattern consumes its match (replaced by a space); the callback returns null to leave the text alone. */
function take(text: string, re: RegExp, read: (m: (string | undefined)[]) => boolean): string {
  return text.replace(re, (...args) => {
    const groups = args.slice(0, -2) as string[];
    return read(groups) ? ' ' : (groups[0] ?? '');
  });
}

const TYRE_RADIAL = /(?<![\d/.])(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:(-)\s*|(z?r)\s*-?\s*)(\d{2})(?!\d)/gu;
const TYRE_BIAS = /(?<![\d.])(\d{1,2}\.\d{2})\s*-\s*(\d{2})(?!\d)/gu;
/** "90 90 12" and "175 65 r14": the slashes dropped. Only plausible numbers count (width, aspect, rim), see below. */
const TYRE_SPACED = /(?<![\d/.])(\d{2,3})\s+(\d{2,3})\s+(r\s*)?(\d{2})(?![\d.])/gu;
const VISCOSITY = /(?<![\d.])(\d{1,2})\s*w\s*-?\s*(\d{2,3})(?!\d)/gu;
const PACK =
  /(?<![\d.\p{L}])(\d+(?:\.\d+)?)\s*(millilit(?:re|er)s?|ml|lit(?:re|er)s?|ltrs?|lt|l|kilograms?|kilos?|kgs?|grams?|gms?|g)(?![\p{L}\p{N}])/gu;
const AH = /(?<![\d.])(\d{1,3})\s*ah(?![\p{L}\p{N}])/gu;
const VOLT = /(?<![\d.])(\d{1,2})\s*v(?![\p{L}\p{N}])/gu;

interface Phrase {
  words: string[];
  entry: SearchVocabEntry;
}

function phrases(vocab: readonly SearchVocabEntry[], kind: SearchVocabEntry['kind']): Phrase[] {
  return vocab
    .filter((v) => v.kind === kind && v.active !== false)
    .map((entry) => ({ words: tokenise(entry.term), entry }))
    .filter((p) => p.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length);
}

/** The longest phrase starting at `i` in `words`, or null. */
function phraseAt(list: readonly Phrase[], words: readonly string[], i: number): Phrase | null {
  return list.find((p) => p.words.every((w, k) => words[i + k] === w)) ?? null;
}

/**
 * Query understanding, shared by the API and the demo (spec 02). Pure and total: any string gives a value.
 * Order: tyre sizes, viscosity grades, pack sizes, battery Ah and voltage are cut out of the text first (they
 * contain digits, slashes and dots that tokenising would destroy); then part numbers, vehicle words (removed from
 * the text: they steer the ranking, they are rarely in a name), synonyms (kept, with their expansions) and the
 * category intent (read on the words and their expansions).
 */
export function parseSearchQuery(
  raw: string,
  vocab: readonly SearchVocabEntry[] = DEFAULT_SEARCH_VOCAB,
): ParsedQuery {
  let rest = raw.normalize('NFKC').toLowerCase();
  const out: ParsedQuery = {
    raw,
    text: '',
    viscosity: null,
    netQty: null,
    ah: null,
    voltage: null,
    tyreSize: null,
    partNumbers: [],
    vehicleType: null,
    vehicleWord: null,
    segment: null,
    segmentWords: [],
    categorySlug: null,
    categoryWords: [],
    expansions: {},
  };

  rest = take(rest, TYRE_RADIAL, (m) => {
    if (out.tyreSize) return false;
    out.tyreSize = `${m[1]}/${m[2]}${m[4] ? 'R' : '-'}${m[5]}`;
    return true;
  });
  rest = take(rest, TYRE_BIAS, (m) => {
    if (out.tyreSize) return false;
    out.tyreSize = `${m[1]}-${m[2]}`;
    return true;
  });
  rest = take(rest, TYRE_SPACED, (m) => {
    const [width, aspect, rim] = [Number(m[1]), Number(m[2]), Number(m[4])];
    const plausible =
      width >= 60 && width <= 400 && aspect >= 30 && aspect <= 100 && rim >= 8 && rim <= 24 && width > rim;
    if (out.tyreSize || !plausible) return false;
    out.tyreSize = `${m[1]}/${m[2]}${m[3] ? 'R' : '-'}${m[4]}`;
    return true;
  });
  rest = take(rest, VISCOSITY, (m) => {
    const v = out.viscosity ? null : normaliseViscosity(m[1] ?? '', m[2] ?? '');
    if (!v) return false;
    out.viscosity = v;
    return true;
  });
  rest = take(rest, PACK, (m) => {
    const p = out.netQty ? null : normalisePack(m[1] ?? '', m[2] ?? '');
    if (!p) return false;
    out.netQty = p;
    return true;
  });
  rest = take(rest, AH, (m) => {
    if (out.ah !== null) return false;
    out.ah = Number(m[1]);
    return true;
  });
  rest = take(rest, VOLT, (m) => {
    const v = Number(m[1]);
    if (out.voltage !== null || v < 3 || v > 96) return false;
    out.voltage = v;
    return true;
  });

  for (const piece of rest.split(/\s+/)) {
    const part = partNumberOf(piece);
    if (part && !out.partNumbers.includes(part)) out.partNumbers.push(part);
  }

  let words = tokenise(rest);

  // Segment intent (truck, tractor, JCB, inverter): first phrase wins; its words stay in the text (a product may say it)
  // and the segment also matches them and steers the ranking.
  const segments = phrases(vocab, 'segment');
  for (let i = 0; i < words.length && !out.segment; i++) {
    const hit = phraseAt(segments, words, i);
    const target = hit?.entry.expandsTo[0];
    if (!hit || !isVehicleSegment(target)) continue;
    out.segment = target;
    out.segmentWords = [...hit.words];
  }

  // Vehicle intent: first phrase wins. A 2W/3W/4W word leaves the text (it steers the ranking and is rarely in a
  // name); a word with no catalogue type (truck, bus, tractor) stays and gets its English word as an expansion.
  const vehicles = phrases(vocab, 'vehicle');
  const vehicleExpansions: [string, string][] = [];
  for (let i = 0; i < words.length && !out.vehicleType && !out.vehicleWord; i++) {
    const hit = phraseAt(vehicles, words, i);
    if (!hit) continue;
    const target = hit.entry.expandsTo[0] ?? '';
    if (isVehicleType(target)) {
      out.vehicleType = target;
      words = [...words.slice(0, i), ...words.slice(i + hit.words.length)];
    } else if (target) {
      out.vehicleWord = target;
      const first = words[i] ?? '';
      if (first !== target && hit.words.length === 1) vehicleExpansions.push([first, target]);
    }
  }

  // Synonyms: single words (any script); the expansions are kept apart, the word stays in the text.
  const synonyms = new Map<string, string[]>();
  for (const p of phrases(vocab, 'synonym')) {
    if (p.words.length !== 1) continue;
    const word = p.words[0] ?? '';
    const list = synonyms.get(word) ?? [];
    for (const x of p.entry.expandsTo) for (const w of tokenise(x)) if (!list.includes(w)) list.push(w);
    synonyms.set(word, list);
  }
  for (const [word, target] of vehicleExpansions) synonyms.set(word, [...(synonyms.get(word) ?? []), target]);
  // `source` = the typed word a pool entry stands for (an expansion stands for the word it expands).
  const pool = [...words];
  const source = [...words];
  for (const w of words) {
    const exp = synonyms.get(w);
    if (!exp) continue;
    out.expansions[w] = exp;
    pool.push(...exp);
    source.push(...exp.map(() => w));
  }

  // Category intent: longest phrase over the words and their expansions; earliest wins on a tie.
  const categories = phrases(vocab, 'category');
  let best: { len: number; at: number; slug: string; words: string[] } | null = null;
  for (let i = 0; i < pool.length; i++) {
    const hit = phraseAt(categories, pool, i);
    const slug = hit?.entry.expandsTo[0];
    if (hit && slug && (!best || hit.words.length > best.len))
      best = {
        len: hit.words.length,
        at: i,
        slug,
        words: source.filter(
          (_, k) => k >= i && k < i + hit.words.length && isCategoryName(pool[k] ?? '', slug),
        ),
      };
  }
  out.categorySlug = best?.slug ?? null;
  out.categoryWords = [...new Set(best?.words ?? [])];

  out.text = words.join(' ');
  return out;
}

/** The text words that take part in matching (stop words like "for" never decide a match). */
export function matchWords(parsed: ParsedQuery): string[] {
  const words = parsed.text.split(' ').filter(Boolean);
  const content = words.filter((w) => !SEARCH_STOP_WORDS.has(w));
  return content.length > 0 ? content : [];
}
