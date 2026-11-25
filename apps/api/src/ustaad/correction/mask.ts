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
 * list only), when masking failed, when the text has digits of any script other than ASCII and Devanagari, or when the
 * masked text still has eight or more digits between two letters (see `hasDigitCluster`).
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

/** Fail-closed rule: a run of this many digits (separated only by non-letters) left after masking is not sent. */
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

/**
 * The fail-closed projection (security review 2026-11-26, round 2). Format characters (`\p{Cf}`: zero-width joiners,
 * direction marks) are removed and placeholders become a space; the text is cut at every letter, and each letter-free
 * segment is unsafe when it holds `RISK_DIGITS` or more digits of any script, **whatever the separators between them**
 * (`9 8 7 6 5 . . . 4 3 2 1 0`, `98765—————43210`), or digits of more than one script (`9८७६५४३२१०`). Part numbers
 * and sizes (`6301 aur 175/65 R14`) are split by letters and stay safe. Errs towards the word list.
 */
export function hasDigitCluster(text: string): boolean {
  const plain = text.replace(PLACEHOLDER_RE, ' ').replace(/\p{Cf}/gu, '');
  return plain.split(/[\p{L}\p{M}]+/u).some((segment) => {
    const digits = segment.match(/\p{Nd}/gu) ?? [];
    return digits.length >= RISK_DIGITS;
  });
}

/** A number written in two digit scripts at once (`9८७६५४३२१०`), checked on the unmasked text: a disguise. */
export function hasMixedDigitScripts(text: string): boolean {
  return text
    .replace(/\p{Cf}/gu, '')
    .split(/[\p{L}\p{M}]+/u)
    .some((segment) => /[0-9]/.test(segment) && /[०-९]/.test(segment));
}

/** Any decimal digit other than ASCII and Devanagari (Bengali, Gujarati, fullwidth …): never sent to an LLM. */
export function hasForeignDigits(text: string): boolean {
  return /(?![0-9०-९])\p{Nd}/u.test(text);
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
    safeForLlm: !failed && !hasForeignDigits(text) && !hasMixedDigitScripts(text) && !hasDigitCluster(masked),
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
