import { DEMO_PRODUCTS, findProduct } from '@/demo/catalogue';
import type { SimilarItem } from '@/components/catalogue/similar-section';
import { demoCard } from './demo-source';

/**
 * "Similar options" for the demo store (shopping personalisation phase 3), the same rule as the database
 * (`similarFor`): same category, same size key, another brand, a vehicle segment in common when both have one, and
 * something to buy (demo products are never "on request" unless marked). The demo has no size columns, so the key comes
 * from the spec text: oil grade + pack ("20W40 · 900 ml"), tyre size ("90/90-12"), battery capacity ("45 Ah").
 * A spec without any of them gives no key and no suggestions (no guessing). Server-side only (product page).
 */
const GRADE = /\b(\d{1,2}W-?\d{2})\b/i;
const PACK = /\b(\d+(?:\.\d+)?)\s?(ml|l)\b/i;
const TYRE = /\b(\d{2,3}\/\d{2,3}[- ]?R?\s?\d{2}|\d{3,4}\s?R\s?\d{2})\b/i;
const CAPACITY = /\b(\d{1,3})\s?Ah\b/i;
const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function similarKey(spec: string): { key: string; size: string | null } | null {
  const tyre = TYRE.exec(spec);
  if (tyre?.[1]) return { key: compact(tyre[1]), size: tyre[1] };
  const grade = GRADE.exec(spec);
  const pack = PACK.exec(spec);
  if (grade?.[1] && pack?.[1] && pack[2]) {
    const size = `${pack[1]} ${pack[2].toLowerCase() === 'l' ? 'L' : 'ml'}`.replace(' L', ' l');
    return { key: `${compact(grade[1])}|${compact(`${pack[1]}${pack[2]}`)}`, size };
  }
  const ah = CAPACITY.exec(spec);
  if (ah?.[1]) return { key: `${ah[1]}AH`, size: `${ah[1]} Ah` };
  return null;
}

export function demoSimilar(slug: string, locale: string): SimilarItem[] {
  const source = findProduct(slug);
  if (!source) return [];
  const key = similarKey(source.spec);
  if (!key) return [];
  const sourceSegments = demoCard(source, locale).segments.map((s) => s.code);
  const out: SimilarItem[] = [];
  for (const p of DEMO_PRODUCTS) {
    if (p.slug === source.slug || p.category !== source.category || p.brand === source.brand) continue;
    if (p.availability === 'on_request' || similarKey(p.spec)?.key !== key.key) continue;
    const card = demoCard(p, locale);
    const shares = sourceSegments.length === 0 || card.segments.some((s) => sourceSegments.includes(s.code));
    if (shares) out.push({ card, size: key.size });
    if (out.length === 8) break;
  }
  return out;
}
