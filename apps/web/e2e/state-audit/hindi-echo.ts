/**
 * The Hindi gate and the visitor's own words (audit 2026-11-15): search words typed into the page ("zzzz",
 * "battery") are shown back on `/hi` ("No results for zzzz"). They are user text, allowed in Latin script by
 * hard rule 10, so the gate removes them from the text it checks. Pure: runs in Node, unit-tested.
 */

/** Values of the query string of an audited path (`/hi/shop?q=zzzz&sort=price` gives `zzzz`, `price`). */
export function echoedWords(path: string): string[] {
  const at = path.indexOf('?');
  if (at < 0) return [];
  const out = new Set<string>();
  for (const [, value] of new URLSearchParams(path.slice(at + 1))) {
    const v = value.trim();
    if (v.length >= 2) out.add(v);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The page text with every echoed word removed (case-insensitive, longest first). */
export function withoutEcho(text: string, words: readonly string[]): string {
  let out = text;
  for (const w of words) out = out.replace(new RegExp(escape(w), 'gi'), ' ');
  return out;
}
