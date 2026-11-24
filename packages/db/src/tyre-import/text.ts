import { cleanSpecText } from '../battery-import/text';

/** Small text and size helpers of the tyre importers (CEAT and MRF; pure). */

/** Short words (3 letters or fewer) that are real words, not codes: title-cased instead of upper-cased. */
const TITLE_SHORT: ReadonlySet<string> = new Set(['THE', 'LUG', 'RIB', 'PRO', 'NEO', 'RAD']);

/** Letters that stay upper case although they are not short or vowel-less (maker's spelling of a name). */
const MIXED_CASE: Readonly<Record<string, string>> = { ZSPORT: 'ZSport', ZWYDE: 'ZWyde' };

/**
 * Name of a tyre in title case (user 2026-11-24: "exact names in title case"). Tokens with a digit (sizes, load and speed
 * codes, "N8", "M151") and tokens that already mix upper and lower case ("(tube included)", "Poly") are kept as the
 * source writes them. A word of capitals is title-cased; a short one (up to 3 letters: TL, TT, LT, SKU, SUV, FM) or one
 * without a vowel (ZVTS) is a code and stays upper case.
 */
export function titleTyreName(raw: string): string {
  return cleanSpecText(raw)
    .split(/\s+/)
    .filter((t) => t !== '')
    .map((token) => {
      if (/\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token)) || !/[A-Za-z]/.test(token))
        return token;
      if (!/[A-Z]/.test(token)) return token;
      return token.replace(/[A-Za-z]+/g, (run) => {
        if (run !== run.toUpperCase()) return run;
        const fixed = MIXED_CASE[run];
        if (fixed) return fixed;
        if (run.length <= 3) return TITLE_SHORT.has(run) ? run.charAt(0) + run.slice(1).toLowerCase() : run;
        if (!/[AEIOU]/.test(run)) return run;
        return run.charAt(0) + run.slice(1).toLowerCase();
      });
    })
    .join(' ')
    .replace(/\bCeat\b/g, 'CEAT');
}

/** A number written in the source ("69", "10.0"), or null. */
export function intOf(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** A positive decimal ("16.5") or null. */
export function decimalOf(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** The speed rating symbol of the source ("H", "V"; the car page's "S" of "100/S"), or null when blank or not a letter code. */
export const SPEED_SYMBOLS = [
  'F',
  'G',
  'J',
  'K',
  'L',
  'M',
  'N',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'H',
  'V',
  'W',
  'Y',
] as const;
export function speedSymbol(text: string | undefined): string | null {
  const t = (text ?? '').trim().toUpperCase();
  return (SPEED_SYMBOLS as readonly string[]).includes(t) ? t : null;
}

/** "115/113" (dual load) or "69" as text, or null. */
export function loadIndexText(text: string | undefined): string | null {
  const t = (text ?? '').trim();
  return /^\d{2,3}(\/\d{2,3})?$/.test(t) ? t : null;
}

/** The size as the attribute set takes it (`^[0-9][0-9./ R-]{2,18}$`), or null for sizes written with other letters ("165D14"). */
export function attributeSize(size: string): string | null {
  const t = size.trim().replace(/\s+/g, ' ');
  return /^[0-9][0-9./ R-]{2,18}$/.test(t) ? t : null;
}

/** Rupees as written ("8435") → integer paise; null = not a positive number. */
export function rupeesToPaise(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100);
  return n > 0 ? n : null;
}
