import type { VehicleType } from '../vehicles';
import { compactAlnum, isTypoOf, type PackSize } from './normalise';
import { matchWords, tokenise, type ParsedQuery } from './parse';
import { SEARCH_WEIGHTS as W } from './vocab';

/** What the ranker needs to know about one product (the demo builds it from its catalogue; the SQL mirrors it). */
export interface SearchableProductText {
  name: string;
  brand: string;
  /** Every other searchable text (spec, compatibility, description, category label), either language. */
  text: string;
  categorySlug: string;
  vehicleTypes: readonly VehicleType[];
  packs: readonly PackSize[];
  inStock: boolean;
}

/**
 * The demo catalogue's ranker. Same rules as `packages/db/src/repo/search.ts`: every text word must be found (in
 * the name or brand, in the other text, or as a typo of a name or brand word, each word also through its synonym
 * expansions), then attribute, intent and stock boosts add up. 0 = not a match. With no text words, the query matches
 * on its attributes or category (a bare "900ml", "baitri"); with nothing parsed it matches everything (score 1).
 */
export function scoreProductText(q: ParsedQuery, p: SearchableProductText): number {
  const words = matchWords(q);
  const nameWords = tokenise(`${p.name} ${p.brand}`);
  const nameHay = nameWords.join(' ');
  const textHay = tokenise(p.text).join(' ');
  const compactHay = compactAlnum(`${p.name} ${p.text}`);

  let score = 0;
  for (const w of words) {
    const group = [w, ...(q.expansions[w] ?? [])];
    let best = 0;
    if (q.categoryWords.includes(w) && p.categorySlug === q.categorySlug) best = W.wordInText;
    for (const g of group) {
      if (nameHay.includes(g)) best = Math.max(best, W.wordInName);
      else if (textHay.includes(g)) best = Math.max(best, W.wordInText);
      else if (nameWords.some((n) => isTypoOf(g, n))) best = Math.max(best, W.wordTypo);
    }
    if (best === 0) return 0;
    score += best;
  }

  const attr = {
    viscosity: q.viscosity !== null && compactHay.includes(q.viscosity.replace('-', '')),
    pack: q.netQty !== null && p.packs.some((k) => k.qty === q.netQty?.qty && k.unit === q.netQty.unit),
    ah: q.ah !== null && new RegExp(`(?<!\\d)${q.ah}AH`).test(compactHay),
    voltage: q.voltage !== null && new RegExp(`(?<!\\d)${q.voltage}V(?![A-Z])`).test(compactHay),
    tyre: q.tyreSize !== null && compactHay.includes(compactAlnum(q.tyreSize)),
    part: q.partNumbers.some((n) => compactHay.includes(n)),
  };
  const attributeCount = [q.viscosity, q.netQty, q.ah, q.voltage, q.tyreSize].filter(
    (x) => x !== null,
  ).length;
  const category = q.categorySlug !== null && p.categorySlug === q.categorySlug;
  const vehicle = q.vehicleType !== null && p.vehicleTypes.includes(q.vehicleType);

  if (words.length === 0) {
    const anything =
      attributeCount > 0 ||
      q.categorySlug !== null ||
      q.vehicleType !== null ||
      q.vehicleWord !== null ||
      q.partNumbers.length > 0;
    if (anything) {
      const matched =
        attr.viscosity ||
        attr.pack ||
        attr.ah ||
        attr.voltage ||
        attr.tyre ||
        attr.part ||
        category ||
        vehicle;
      if (!matched) return 0;
    } else if (q.raw.trim() !== '' && tokenise(q.raw).length > 0) {
      return 0;
    } else {
      return 1;
    }
  }

  if (attr.viscosity) score += W.viscosity;
  if (attr.pack) score += W.packSize;
  if (attr.ah) score += W.batteryAh;
  if (attr.voltage) score += W.voltage;
  if (attr.tyre) score += W.tyreSize;
  if (attr.part) score += W.partNumber;
  if (vehicle) score += W.vehicleIntent;
  if (category) score += W.categoryIntent;
  if (p.inStock) score += W.inStock;
  return Math.max(score, 0.01);
}
