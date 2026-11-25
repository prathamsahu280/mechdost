/**
 * PII masking before smart correction (spec 23 § 11 "No PII sent", SR-28). E-mail addresses, UPI ids, `@handles`,
 * GSTIN, PAN, IFSC, Aadhaar numbers, phone numbers, card and bank-account numbers (any run of nine or more digits),
 * vehicle registration numbers and PIN codes become numbered placeholders `⟦1⟧`, `⟦2⟧` … before any engine sees the
 * text (the word list too, so it cannot "fix" an e-mail's local part), and are put back afterwards. Latin and
 * Devanagari digits both count; digits may be split by spaces, dots, dashes, slashes or brackets.
 *
 * Order matters: e-mail before UPI (both contain `@`), handles after both; GSTIN before PAN (a GSTIN contains a PAN);
 * Aadhaar (12 digits in 4-4-4) and phones before the long-digit rule; PIN codes last (longer numbers contain six-digit
 * runs).
 *
 * Fail closed (security review 2026-11-26): `safeForLlm` is false, and the caller keeps the text on our server (word
 * list only), when masking failed, when the text has any numeral other than ASCII and Devanagari digits, when it mixes
 * the two scripts, or when the masked text still holds eight or more numerals outside known-safe mechanic tokens,
 * counted over the whole text (`riskyNumeralCount`). No offset map is needed for restore: the count is a check only,
 * and the masked text an engine receives is the member's own text with placeholders.
 */

const D = '[0-9०-९]'; // ASCII and Devanagari digits
const NOT_D_BEFORE = `(?<!${D})`;
const NOT_D_AFTER = `(?!${D})`;
/** Between two digits of one number: up to two of space, dot, dash, slash or bracket ("(98765) 43210"). */
const SEP = '[\\s.\\-/()]{0,2}';

/** Indian state / UT codes on number plates (BH series handled separately). */
const STATES =
  'AN|AP|AR|AS|BR|CG|CH|DD|DL|DN|GA|GJ|HP|HR|JH|JK|KA|KL|LA|LD|MH|ML|MN|MP|MZ|NL|OD|OR|PB|PY|RJ|SK|TN|TR|TS|UK|UA|UP|WB';

const PATTERNS: readonly RegExp[] = [
  // e-mail
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  // UPI id (name@bank, no dot in the handle part)
  /[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,30}\b/g,
  // @handle
  /(?<![\p{L}\p{N}_])@[A-Za-z0-9_.]{2,30}/gu,
  // GSTIN: state code, PAN, entity number, Z, check character
  /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi,
  // PAN
  /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
  // IFSC: bank code, 0, branch code
  /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
  // Aadhaar: 12 digits, first 2–9, in 4-4-4 groups or together
  new RegExp(`${NOT_D_BEFORE}[2-9२-९]${D}{3}[\\s.\\-]?${D}{4}[\\s.\\-]?${D}{4}${NOT_D_AFTER}`, 'g'),
  // phone: optional +91 / 91 / 0 prefix, a mobile number starting 6–9, separators between digits
  new RegExp(`${NOT_D_BEFORE}(?:(?:\\+|00)?(?:91|९१)${SEP}|0)?[6-9६-९](?:${SEP}${D}){9}${NOT_D_AFTER}`, 'g'),
  // card, bank account and any other long number: nine or more digits, separators allowed
  new RegExp(`${NOT_D_BEFORE}${D}(?:${SEP}${D}){8,}${NOT_D_AFTER}`, 'g'),
  // vehicle registration: CG 04 AB 1234, CG04AB1234, 22 BH 1234 AA
  new RegExp(`\\b(?:${STATES})[\\s-]?\\d{1,2}[\\s-]?[A-Z]{0,3}[\\s-]?\\d{4}\\b`, 'gi'),
  /\b\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2}\b/gi,
  // PIN code (six digits, first not zero)
  new RegExp(`${NOT_D_BEFORE}[1-9१-९]${D}{5}${NOT_D_AFTER}`, 'g'),
];

export const PLACEHOLDER_RE = /⟦(\d+)⟧/g;

/** Fail-closed rule: this many numerals left after masking and the safe-token allowlist keep the text off the LLM. */
export const RISK_DIGITS = 8;

export interface Masked {
  masked: string;
  /** How many placeholders were inserted. */
  count: number;
  /** False when digits that look like an unmasked number remain (or masking failed): use the word list only. */
  safeForLlm: boolean;
  /**
   * Puts the original values back. Returns null when the engine dropped, duplicated or invented a placeholder (the
   * result is then refused, spec § 11).
   */
  restore(output: string): string | null;
}

/** True when the text already carries placeholder brackets (never sent to an LLM: they could be confused with ours). */
export function hasPlaceholderChars(text: string): boolean {
  return text.includes('⟦') || text.includes('⟧');
}

const NUMERAL = /\p{N}/u;
const numerals = (s: string) => (s.match(/\p{N}/gu) ?? []).length;

/** No numeral within `w` characters before or after `[start, end)`: the token stands alone. */
function isolated(t: string, start: number, end: number, w: number): boolean {
  return !NUMERAL.test(t.slice(Math.max(0, start - w), start)) && !NUMERAL.test(t.slice(end, end + w));
}

/**
 * Known-safe mechanic tokens, removed before counting, each only when it stands alone (no other numeral within 3
 * characters), so a phone cut into several "safe" pieces (`₹987 ₹654 ₹3210`, `10W-98 76W-54`) is still counted.
 */
const SAFE_TOKENS: readonly { re: RegExp; maxNumerals: number }[] = [
  // tyre sizes: 175/65 R14 82T, 90/90-12 54J, 205/55ZR16
  { re: /\b\d{2,3}\/\d{2}(?:[\s-]?Z?R?[\s-]?\d{2})?(?:\s\d{2,3}[A-Z])?\b/gi, maxNumerals: 12 },
  // oil viscosity: 10W-30, 5W-40, 20W40
  { re: /\b\d{1,2}W[\s-]?\d{2}\b/gi, maxNumerals: 4 },
  // battery: 12V, 12V 35Ah, 35Ah
  { re: /\b\d{1,2}\s?V(?:\s\d{2,3}\s?Ah)?\b|\b\d{2,3}\s?Ah\b/gi, maxNumerals: 5 },
  // rupee amounts up to ₹99,99,999: ₹1,520, Rs 450, INR 2,000.50
  { re: /(?:₹|\bRs\.?|\bINR)\s?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?/gi, maxNumerals: 9 },
];

/** Characters a removed token becomes: same length (offsets stay put), not a numeral, not a letter. */
const blank = (s: string) => '#'.repeat(s.length);

/**
 * The fail-closed count (security review 2026-11-26, round 4: a gate that cannot be split). On the masked text, NFKC
 * (only so fullwidth, circled or superscript numerals count as numerals), placeholders removed, known-safe tokens
 * removed (tyre sizes, viscosity, battery, rupee amounts, then model codes such as `6G`, `BS6`, `XLTZ4A` with at most
 * three numerals and short numbers of up to four numerals such as years, each only when no other numeral is within 6
 * characters), and then **every** remaining `\p{N}` in the whole text is counted, with no segmentation at all. Eight
 * or more → the text stays on our server. Letters, marks, format characters or symbols between digits change nothing.
 */
export function riskyNumeralCount(masked: string): number {
  // Every decision reads the same text `t`; the ranges are blanked only at the end, so removing one token can never
  // make its neighbours look alone.
  const t = masked.normalize('NFKC').replace(PLACEHOLDER_RE, (m) => blank(m));
  const ranges: [number, number][] = [];
  for (const { re, maxNumerals } of SAFE_TOKENS) {
    const found = [...t.matchAll(re)].map((m) => [m.index, m.index + m[0].length, numerals(m[0])] as const);
    for (const [start, end, count] of found) {
      // Two tokens of one kind side by side (`₹987 ₹654`, `10W-98 76W-54`) are a number cut into pieces: both count.
      const chained = found.some(([s, e]) => (s !== start || e !== end) && s < end + 3 && e > start - 3);
      if (count <= maxNumerals && !chained) ranges.push([start, end]);
    }
  }
  const covered = (i: number) => ranges.some(([s, e]) => i >= s && i < e);
  // Model codes (letters and at most three numerals, up to eight characters) and short numbers (years, quantities,
  // part numbers like 6301), each only with no other numeral within 6 characters.
  for (const m of t.matchAll(/[\p{L}\p{N}]+/gu)) {
    const [start, end, w] = [m.index, m.index + m[0].length, m[0]];
    if (covered(start)) continue;
    const n = numerals(w);
    const modelCode = /\p{L}/u.test(w) && n >= 1 && n <= 3 && w.length <= 8;
    const shortNumber = n === w.length && n <= 4;
    if ((modelCode || shortNumber) && isolated(t, start, end, 6)) ranges.push([start, end]);
  }
  let count = 0;
  for (let i = 0; i < t.length; i++) if (!covered(i) && NUMERAL.test(t.charAt(i))) count++;
  return count;
}

/** A text using both ASCII and Devanagari digits anywhere (`9८७६५४३२१०`): kept off the LLM. */
export function hasMixedDigitScripts(text: string): boolean {
  return /[0-9]/.test(text) && /[०-९]/.test(text);
}

/**
 * Any numeral other than plain ASCII and Devanagari digits in the text as typed (Bengali, Gujarati, fullwidth,
 * circled, superscript, fractions …): the text is kept off the LLM. The masking patterns only need the two common
 * scripts because everything else never leaves the server.
 */
export function hasForeignDigits(text: string): boolean {
  return /(?![0-9०-९])\p{N}/u.test(text);
}

export function maskPii(text: string): Masked {
  const values: string[] = [];
  let masked = text;
  let failed = false;
  try {
    for (const re of PATTERNS) {
      masked = masked.replace(re, (match) => {
        values.push(match);
        return `⟦${String(values.length)}⟧`;
      });
    }
  } catch {
    failed = true;
  }
  return {
    masked,
    count: values.length,
    safeForLlm:
      !failed &&
      !hasForeignDigits(text) &&
      !hasMixedDigitScripts(text) &&
      riskyNumeralCount(masked) < RISK_DIGITS,
    restore(output: string): string | null {
      const seen = new Map<number, number>();
      for (const m of output.matchAll(PLACEHOLDER_RE)) {
        const n = Number(m[1]);
        seen.set(n, (seen.get(n) ?? 0) + 1);
      }
      if (seen.size !== values.length) return null;
      for (let n = 1; n <= values.length; n++) if (seen.get(n) !== 1) return null;
      // Placeholders never nest: no pattern's separators include ⟦ or ⟧, and a placeholder has at most three digits
      // (2,000 characters cannot hold 1,000 masked values) where every digit pattern needs four or more.
      let out = output;
      for (let n = values.length; n >= 1; n--) {
        const value = values[n - 1] ?? '';
        out = out.replace(`⟦${String(n)}⟧`, () => value);
      }
      return out;
    },
  };
}
