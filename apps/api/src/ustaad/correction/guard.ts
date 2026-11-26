/**
 * Meaning guard (spec 23 § 11, SR-27): a correction is accepted only if it keeps every protected word, number, part
 * number, unit, negation and placeholder as often as the input has them, keeps the script, adds no link and stays
 * within the length rule. Runs on both engines, server-side, after the call. The guard only reads: it never rewrites
 * the output. Numbers must come back exactly as written (Devanagari digits stay Devanagari); protected words, units and
 * negations are compared in a normalised form (NFC, lower case, Devanagari digits read as ASCII).
 */

export const GUARD_FAILURES = [
  'empty',
  'protected',
  'number',
  'unit',
  'negation',
  'placeholder',
  'script',
  'length',
  'link',
] as const;
export type GuardFailure = (typeof GUARD_FAILURES)[number];

export interface GuardResult {
  ok: boolean;
  failures: GuardFailure[];
}

export interface GuardOptions {
  /** `ustaad.correction.max_length_change_pct` (30). */
  maxLengthChangePct: number;
}

/**
 * Short texts grow a lot from a single expansion (`kya h` → `kya hai` is +40 %), so the length rule allows at least
 * this many characters of change whatever the percentage (decision recorded in spec 23 § 11).
 */
export const LENGTH_SLACK_CHARS = 12;

/** Negations counted as one class, in every spelling members use (`nhi` → `nahi` is a fix, not a change of meaning). */
const NEGATIONS = new Set([
  'nahi',
  'nahin',
  'nahee',
  'nhi',
  'nhin',
  'ni',
  'nai',
  'na',
  'mat',
  'no',
  'not',
  'never',
  'nope',
  'नहीं',
  'नही',
  'ना',
  'न',
  'मत',
]);

/**
 * Unit words that may stand alone (`12 V`, `5 Ah`, `40 km`); tokens with digits are compared as numbers anyway.
 * Single letters that are also words (a, g, l, m) are left out so an English article does not count as a unit.
 */
const UNITS = new Set([
  'v',
  'volt',
  'volts',
  'ah',
  'mah',
  'amp',
  'amps',
  'w',
  'kw',
  'hp',
  'bhp',
  'cc',
  'rpm',
  'nm',
  'psi',
  'bar',
  'kg',
  'ml',
  'ltr',
  'litre',
  'liter',
  'mm',
  'cm',
  'km',
  'kmpl',
  'kmph',
  'ohm',
  'वोल्ट',
  'लीटर',
  'किलो',
]);

const DEVANAGARI_DIGIT = /[०-९]/g;

/** Comparison form: NFC, ASCII digits, lower case. */
export function normaliseForGuard(text: string): string {
  return text
    .normalize('NFC')
    .replace(DEVANAGARI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0966))
    .toLowerCase();
}

/** Whole tokens of letters, marks and digits (Devanagari vowel signs are marks and stay inside their word). */
export function guardTokens(text: string): string[] {
  return normaliseForGuard(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function multiset(items: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const ma = multiset(a);
  const mb = multiset(b);
  for (const [k, v] of ma) if (mb.get(k) !== v) return false;
  return true;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Occurrences of a protected phrase, case-insensitive, with any spacing or hyphen between its words. */
export function countPhrase(text: string, phrase: string): number {
  const words = guardTokens(phrase);
  if (words.length === 0) return 0;
  const body = words.map(escapeRe).join('[\\s\\-_]*');
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])`, 'gu');
  return (normaliseForGuard(text).match(re) ?? []).length;
}

/** Devanagari share of the letters, in percent (null when the text has no letters). */
function devanagariShare(text: string): number | null {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return null;
  const deva = letters.filter((ch) => /[ऀ-ॿ]/.test(ch)).length;
  return (deva / letters.length) * 100;
}

const LINK_RE =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|in|net|org|co|io|app|link|ly|me)\b[^\s]*/gi;

function links(text: string): string[] {
  return (text.match(LINK_RE) ?? []).map((l) => l.toLowerCase());
}

export function meaningGuard(
  input: string,
  output: string,
  protectedWords: readonly string[],
  opts: GuardOptions,
): GuardResult {
  const failures: GuardFailure[] = [];
  if (output.trim() === '') return { ok: false, failures: ['empty'] };

  for (const p of protectedWords) {
    if (countPhrase(input, p) !== countPhrase(output, p)) {
      failures.push('protected');
      break;
    }
  }

  const inTok = guardTokens(input);
  const outTok = guardTokens(output);
  // Numbers are compared as written (`६३०१` turned into `6301` is a change: digits are never altered in the output).
  const rawNumbers = (text: string) =>
    (
      text
        .normalize('NFC')
        .toLowerCase()
        .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
    ).filter((x) => /[0-9०-९]/.test(x));
  if (!sameMultiset(rawNumbers(input), rawNumbers(output))) failures.push('number');
  const units = (t: readonly string[]) => t.filter((x) => UNITS.has(x));
  if (!sameMultiset(units(inTok), units(outTok))) failures.push('unit');
  const neg = (text: string, t: readonly string[]) =>
    t.filter((x) => NEGATIONS.has(x)).length + (normaliseForGuard(text).match(/n['’]t\b/g) ?? []).length;
  if (neg(input, inTok) !== neg(output, outTok)) failures.push('negation');

  const ph = (text: string) => (text.match(/⟦\d+⟧/g) ?? []).sort();
  if (!sameMultiset(ph(input), ph(output))) failures.push('placeholder');

  const sIn = devanagariShare(input);
  const sOut = devanagariShare(output);
  if (sIn !== null && (sOut === null || Math.abs(sIn - sOut) > 10)) failures.push('script');

  const allowed = Math.max((input.length * opts.maxLengthChangePct) / 100, LENGTH_SLACK_CHARS);
  if (Math.abs(output.length - input.length) > allowed) failures.push('length');

  const inLinks = new Set(links(input));
  if (links(output).some((l) => !inLinks.has(l))) failures.push('link');

  return { ok: failures.length === 0, failures };
}
