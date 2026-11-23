/** Small text and number helpers of the battery importers (pure). */

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A positive number written in the source, or null. */
export function num(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Upper-case letters and digits joined by "-" ("AAM-BL-0BL400LMF"), for SKUs and normalised part numbers. */
export const norm = (text: string) =>
  text
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Title case of the letter runs of one word ("E-RIDE" → "E-Ride"); `acronyms` stay upper case, words with digits are
 * codes and stay as written.
 */
export function titleWord(word: string, acronyms: ReadonlySet<string>): string {
  if (/\d/.test(word)) return word;
  return word.replace(/[A-Za-z]+/g, (run) =>
    acronyms.has(run.toUpperCase()) || run.length <= 1
      ? run.toUpperCase()
      : run.charAt(0).toUpperCase() + run.slice(1).toLowerCase(),
  );
}

/** "Maruti Suzuki Swift"-style title case for the upper-case vehicle names; short words ("MG", "KIA") stay upper. */
export function titleVehicle(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w !== '')
    .map((w) =>
      /\d/.test(w)
        ? w
        : w.replace(/[A-Za-z]+/g, (run) =>
            run.length <= 3 ? run.toUpperCase() : run.charAt(0).toUpperCase() + run.slice(1).toLowerCase(),
          ),
    )
    .join(' ');
}

/** Source text without the broken `�` bytes of the export (`220V � 7v` was `220V ± 7V`). */
export function cleanSpecText(text: string): string {
  return text
    .replace(/\s*�\s*(?=\d)/g, ' ±')
    .replace(/(\d)\s*�/g, '$1 ±')
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^±\s*/, '±');
}

/** Rupees written in the source ("4099.15") as integer paise; null = not a number. */
export function paise(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
