/**
 * Pure normalisers for the attributes people type into the search box (spec 02 "Smart search"). No Zod, no
 * dependencies: browser islands import this (budget, spec 16).
 */

const WINTER = new Set([0, 5, 10, 15, 20, 25]);
const SUMMER = new Set([8, 12, 16, 20, 30, 40, 50, 60]);

/** `20`, `40` → `20W-40`; null when the pair is not an engine-oil grade (so "4w 20" stays text). */
export function normaliseViscosity(winter: string, summer: string): string | null {
  const w = Number(winter);
  const s = Number(summer);
  if (!WINTER.has(w) || !SUMMER.has(s) || s <= w) return null;
  return `${w}W-${s}`;
}

export interface PackSize {
  qty: number;
  unit: 'ml' | 'g';
}

const UNIT_FACTOR: Record<string, { unit: 'ml' | 'g'; factor: number }> = {
  ml: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
  g: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
};

/** The base unit of a spelled unit word (`ltr`, `litres`, `gm`, `kilo` …); null when it is not a pack unit. */
function packUnit(word: string): keyof typeof UNIT_FACTOR | null {
  if (/^(ml|millilit(re|er)s?)$/.test(word)) return 'ml';
  if (/^(l|lt|ltr|ltrs|lit(re|er)s?)$/.test(word)) return 'l';
  if (/^(g|gm|gms|gram|grams)$/.test(word)) return 'g';
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(word)) return 'kg';
  return null;
}

/** `0.9`, `l` → 900 ml; `500`, `gm` → 500 g. Whole numbers only (the catalogue stores integers). */
export function normalisePack(amount: string, unitWord: string): PackSize | null {
  const key = packUnit(unitWord.toLowerCase());
  const n = Number(amount);
  if (!key || !Number.isFinite(n) || n <= 0) return null;
  const { unit, factor } = UNIT_FACTOR[key] as { unit: 'ml' | 'g'; factor: number };
  const qty = Math.round(n * factor);
  return qty >= 1 && qty <= 1_000_000 ? { qty, unit } : null;
}

/** Upper-case letters and digits only: the form part numbers and attribute text are compared in. */
export function compactAlnum(text: string): string {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Whether a token looks like a model or part number: letters and digits mixed, at least 4 once compacted. */
export function partNumberOf(token: string): string | null {
  const c = compactAlnum(token);
  return c.length >= 4 && c.length <= 40 && /[A-Z]/.test(c) && /\d/.test(c) ? c : null;
}

/** Levenshtein distance with an early exit above `max` (returns max + 1). Small strings only (words, names). */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/** The typo budget for a word: none under 4 letters, 1 edit up to 5, 2 edits beyond. */
export function typoBudget(word: string): number {
  const n = Array.from(word).length;
  return n < 4 ? 0 : n <= 5 ? 1 : 2;
}

/** Whether `word` is a typo of `target` (or equal) within the budget. */
export function isTypoOf(word: string, target: string): boolean {
  return editDistance(word, target, typoBudget(word)) <= typoBudget(word);
}

/** The closest candidate to a mistyped query ("castrool" → "Castrol"); null for exact matches and gibberish. */
export function didYouMean(query: string, candidates: readonly string[]): string | null {
  const q = query.normalize('NFKC').toLowerCase().trim();
  if (q.length < 3) return null;
  const budget = Math.max(1, Math.floor(Array.from(q).length / 3));
  let best: { name: string; d: number } | null = null;
  for (const name of candidates) {
    const n = name.normalize('NFKC').toLowerCase();
    if (n === q) return null;
    const d = editDistance(q, n, budget);
    if (d <= budget && (!best || d < best.d)) best = { name, d };
  }
  return best?.name ?? null;
}

/**
 * The compact spellings a parsed tyre size (`90/90-12`, `175/65R14`, `3.50-10`) can be stored in on a size label:
 * with the `R` and without it, because "90/90-12" and "90/90 R12" name the same family of sizes on a catalogue
 * sheet. Cross-section sizes (`3.50-10`) have one spelling.
 */
export function tyreSizeKeys(size: string): string[] {
  const m = /^(\d{2,3})\/(\d{2,3})[-R](\d{2})$/.exec(size.toUpperCase());
  if (!m) return [compactAlnum(size)];
  return [`${m[1]}${m[2]}R${m[3]}`, `${m[1]}${m[2]}${m[3]}`];
}
