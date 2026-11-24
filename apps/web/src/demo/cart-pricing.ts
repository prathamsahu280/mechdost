import { deliveryFeePaise, findProduct } from './catalogue';
import { siteSettings } from './site-config';
import type { CartLine } from './store';

export type PricedCart = ReturnType<typeof priceCart>;

/** Cart lines joined with demo prices (unknown slugs from old sessions are dropped). */
export function priceCart(lines: readonly CartLine[]) {
  const priced = lines.flatMap((l) => {
    const p = findProduct(l.slug);
    if (!p) return [];
    // A line is one size of the product (user 2026-11-24); a line saved by slug only is the product's own size.
    const size = l.sku ? p.sizes?.find((x) => x.sku === l.sku) : undefined;
    const unitPaise = size?.pricePaise ?? p.pricePaise;
    return [
      {
        product: p,
        qty: l.qty,
        unitPaise,
        sku: size?.sku ?? p.sku,
        sizeLabel: size?.label ?? null,
        linePaise: unitPaise * l.qty,
      },
    ];
  });
  const subtotalPaise = priced.reduce((s, l) => s + l.linePaise, 0);
  // Admin-set fee and threshold; placed orders keep the values snapshotted at placement.
  const deliveryPaise = deliveryFeePaise(subtotalPaise, siteSettings());
  return { priced, subtotalPaise, deliveryPaise, totalPaise: subtotalPaise + deliveryPaise };
}
