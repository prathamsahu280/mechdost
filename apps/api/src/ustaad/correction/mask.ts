/**
 * PII masking before smart correction (spec 23 § 11 "No PII sent", SR-28). Phone numbers, e-mail addresses, UPI ids,
 * `@handles`, vehicle registration numbers and PIN codes become numbered placeholders `⟦1⟧`, `⟦2⟧` … before any engine
 * sees the text (the word list too, so it cannot "fix" an e-mail's local part), and are put back afterwards. Order
 * matters: e-mail before UPI (both contain `@`), handles after both, phones before PIN codes (a 10-digit phone contains
 * six-digit runs).
 */

const D = '[0-9०-९]'; // ASCII and Devanagari digits
const NOT_D_BEFORE = `(?<!${D})`;
const NOT_D_AFTER = `(?!${D})`;

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
  // phone: optional +91 / 91 / 0 prefix, a mobile number starting 6–9, spaces or dashes between digits
  new RegExp(
    `${NOT_D_BEFORE}(?:(?:\\+|00)?(?:91|९१)[\\s-]?|0)?[6-9६-९](?:[\\s-]?${D}){9}${NOT_D_AFTER}`,
    'g',
  ),
  // vehicle registration: CG 04 AB 1234, CG04AB1234, 22 BH 1234 AA
  new RegExp(`\\b(?:${STATES})[\\s-]?\\d{1,2}[\\s-]?[A-Z]{0,3}[\\s-]?\\d{4}\\b`, 'gi'),
  /\b\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2}\b/gi,
  // PIN code (six digits, first not zero)
  new RegExp(`${NOT_D_BEFORE}[1-9१-९]${D}{5}${NOT_D_AFTER}`, 'g'),
];

export const PLACEHOLDER_RE = /⟦(\d+)⟧/g;

export interface Masked {
  masked: string;
  /** How many placeholders were inserted. */
  count: number;
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

export function maskPii(text: string): Masked {
  const values: string[] = [];
  let masked = text;
  for (const re of PATTERNS) {
    masked = masked.replace(re, (match) => {
      values.push(match);
      return `⟦${String(values.length)}⟧`;
    });
  }
  return {
    masked,
    count: values.length,
    restore(output: string): string | null {
      const seen = new Map<number, number>();
      for (const m of output.matchAll(PLACEHOLDER_RE)) {
        const n = Number(m[1]);
        seen.set(n, (seen.get(n) ?? 0) + 1);
      }
      if (seen.size !== values.length) return null;
      for (let n = 1; n <= values.length; n++) if (seen.get(n) !== 1) return null;
      // Placeholders never nest: every later pattern needs four or more digits in a row, a placeholder has at most
      // three (2,000 characters cannot hold 1,000 masked values).
      let out = output;
      for (let n = values.length; n >= 1; n--) {
        const value = values[n - 1] ?? '';
        out = out.replace(`⟦${String(n)}⟧`, () => value);
      }
      return out;
    },
  };
}
