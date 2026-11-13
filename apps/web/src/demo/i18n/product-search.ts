import type { DemoProduct } from '../catalogue';
import { PRODUCT_HI } from './hi-products';

/**
 * Search text in every language, so a Hindi query ("बैटरी") and an English one ("battery") both match on `/hi`
 * and on `/` (users type either; Hinglish synonyms come with the search API, spec 02).
 */
export function productSearchText(product: DemoProduct): string {
  const hi = PRODUCT_HI[product.slug];
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
