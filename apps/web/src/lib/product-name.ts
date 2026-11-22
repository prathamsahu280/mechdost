/** Letters and digits only, lower-case: "Tata-Green" and "TATA GREEN" compare equal. */
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The product's full name for titles, labels and messages: "<brand> <name>", unless the name already starts with the
 * brand (imported catalogue names do: "GULF PRIDE 20W-40" of brand Gulf), so the brand is never shown twice
 * (live check 2026-11-22). The brand must end at a word boundary of the name ("Gulfstream" still gets "Gulf").
 */
export function productFullName(brand: string, name: string): string {
  const b = key(brand);
  if (b === '') return name;
  const words = name.split(/\s+/);
  let acc = '';
  for (const w of words) {
    acc += key(w);
    if (acc === b) return name;
    if (!b.startsWith(acc)) break;
  }
  return `${brand} ${name}`;
}
