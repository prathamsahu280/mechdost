import { deliveryFeePaise, findProduct } from './catalogue';
import { siteSettings } from './site-config';
import type { CartLine } from './store';

export type PricedCart = ReturnType<typeof priceCart>;

/** Cart lines joined with demo prices (unknown slugs from old sessions are dropped). */
export function priceCart(lines: readonly CartLine[]) {
  const priced = lines.flatMap((l) => {
    const p = findProduct(l.slug);
    return p ? [{ product: p, qty: l.qty, linePaise: p.pricePaise * l.qty }] : [];
  });
  const subtotalPaise = priced.reduce((s, l) => s + l.linePaise, 0);
  // Admin-set fee and threshold; placed orders keep the values snapshotted at placement.
  const deliveryPaise = deliveryFeePaise(subtotalPaise, siteSettings());
  return { priced, subtotalPaise, deliveryPaise, totalPaise: subtotalPaise + deliveryPaise };
}
