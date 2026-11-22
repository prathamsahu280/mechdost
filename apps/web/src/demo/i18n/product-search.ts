import type { DemoProduct } from '../catalogue';
import type { ProductHi } from './hi-products';

/**
 * Search text in every language, so a Hindi query ("बैटरी") and an English one ("battery") both match on `/hi`
 * and on `/` (users type either; Hinglish synonyms come with the search API, spec 02). The Hindi overlay is passed in
 * (the shop loads it as a separate chunk after the page, JS budget spec 16): without it only the English text matches.
 */
export function productSearchText(
  product: DemoProduct,
  overlay?: Readonly<Record<string, ProductHi>>,
): string {
  const hi = overlay?.[product.slug];
  return [
    product.name,
    product.brand,
    product.sku,
    product.spec,
    product.compatibility,
    product.category,
    hi?.name ?? '',
    hi?.spec ?? '',
    hi?.compatibility ?? '',
  ].join(' ');
}
