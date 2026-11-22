import { hindiLeftovers } from '@mechdost/shared/catalogue-hindi';
import type { PlannedProduct } from './plan';

export interface HindiLeftover {
  slug: string;
  field: string;
  words: string[];
  text: string;
}

/**
 * Every Hindi text the plan would write, checked for English words that are not brand, series, standard or unit
 * names (hard rule 10). The importer prints the result on every run and refuses a real run while it is not empty.
 */
export function planHindiLeftovers(products: readonly PlannedProduct[]): HindiLeftover[] {
  const out: HindiLeftover[] = [];
  for (const p of products) {
    const fields: [string, string | null][] = [
      ['name_hi', p.nameHi],
      ['spec_summary_hi', p.specSummaryHi],
      ['category.name_hi', p.category.nameHi],
      ['range.name_hi', p.range?.nameHi ?? null],
      ['compatibility_hi', p.compatibilityHi],
      ['description_hi', p.descriptionHi],
      ['photo.alt_hi', p.photo?.altHi ?? null],
      ...p.highlightsHi.map((h): [string, string] => ['highlights_hi', h]),
    ];
    for (const [field, text] of fields) {
      if (text === null) continue;
      const words = hindiLeftovers(text);
      if (words.length > 0) out.push({ slug: p.slug, field, words, text: text.slice(0, 100) });
    }
  }
  return out;
}
