/**
 * Checkout hint: which groups pay for delivery now and from what subtotal each would ship free. The threshold is the one
 * the server applied (PIN, then shop, then city; spec 03 "Delivery charges"), so the text never disagrees with the
 * charge (QA 2026-11-16, bug 7). Groups already free, or with no threshold anywhere, say nothing.
 */
export function freeDeliveryHints(
  groups: readonly { seller: string; shippingPaise: number; freeDeliveryMinPaise: number | null }[],
): { seller: string; minPaise: number }[] {
  return groups.flatMap((g) =>
    g.shippingPaise > 0 && g.freeDeliveryMinPaise !== null
      ? [{ seller: g.seller, minPaise: g.freeDeliveryMinPaise }]
      : [],
  );
}
