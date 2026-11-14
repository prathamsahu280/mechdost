/**
 * Free delivery per order group (spec 03 "Delivery charge"; decision 2026-11-14 "Shop management"). The threshold
 * is the first one set: the PIN code's override (`pincodes.free_delivery_min_paise`), then the shop's
 * (`shops.free_delivery_min_paise`), then the city setting `checkout.free_delivery_min_paise`. `0` means always free;
 * nothing set anywhere means the delivery charge always applies. No Zod: the db layer and the browser import it.
 */
export interface FreeDeliveryThresholds {
  pin?: number | null;
  shop?: number | null;
  city: number | null;
}

export function freeDeliveryMinPaise(t: FreeDeliveryThresholds): number | null {
  return t.pin ?? t.shop ?? t.city;
}

/** What one order group pays for delivery: the PIN's charge, or nothing once the subtotal reaches the threshold. */
export function groupShippingPaise(g: {
  subtotalPaise: number;
  shippingPaise: number;
  freeMinPaise: number | null;
}): number {
  return g.freeMinPaise !== null && g.subtotalPaise >= g.freeMinPaise ? 0 : g.shippingPaise;
}
