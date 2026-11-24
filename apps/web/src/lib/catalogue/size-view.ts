import type { ProductView } from './view';

/** A product shown for one of its sizes (the comparison table): `sizeLabel` is null for a single-size product. */
export type SizedView = ProductView & { sizeLabel: string | null };

/**
 * The product as one size sees it: that size's price, SKU, stock and pack (user 2026-11-24). A single-size product
 * is returned as it is. An unknown SKU gives the default size, so an old or mistyped link still shows the product.
 * A size that no shop offers has no price and shows as "on request", with its MRP when it has one.
 */
export function viewForSize(product: ProductView, sku: string | null | undefined): SizedView {
  if (product.variants.length <= 1) return { ...product, sizeLabel: null };
  const chosen =
    product.variants.find((v) => v.sku === sku) ??
    product.variants.find((v) => v.sku === product.defaultSku) ??
    product.variants[0];
  if (!chosen) return { ...product, sizeLabel: null };
  const buyable = chosen.inStock && chosen.pricePaise !== null;
  return {
    ...product,
    sku: chosen.sku,
    sizeLabel: chosen.label,
    price:
      buyable && chosen.pricePaise !== null
        ? { pricePaise: chosen.pricePaise, mrpPaise: chosen.mrpPaise }
        : null,
    mrpFrom: !buyable && chosen.mrpPaise !== null ? { paise: chosen.mrpPaise, varies: false } : null,
    pack: chosen.pack,
    availability: buyable ? 'in_stock' : 'on_request',
    leadDays: buyable ? chosen.leadDays : null,
    shippingPaise: buyable ? chosen.shippingPaise : null,
  };
}
