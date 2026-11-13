/**
 * Admin customer prices (design `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md`): the
 * admin sets what the customer pays per pack, per city with optional PIN overrides (Q26). The shop keeps its own
 * approved price (what it is paid); MechDost's margin is the difference (Q11). Zod-free: shared by the database
 * repository, the API and the admin screen.
 */
export type AdminPriceIssue = 'MRP_EXCEEDED' | 'BELOW_SHOP_PRICE' | 'NO_SHOP' | 'BAD_PRICE';

/**
 * Null when the price may be saved. Never above MRP (Legal Metrology); never below the lowest approved price of a
 * shop that delivers there with stock, so some shop can fulfil it without MechDost paying the difference
 * (user 2026-11-13: "block it"). No such shop → nothing to price against.
 */
export function checkAdminPrice(input: {
  pricePaise: number;
  mrpPaise: number;
  lowestShopPaise: number | null;
}): AdminPriceIssue | null {
  if (!Number.isSafeInteger(input.pricePaise) || input.pricePaise <= 0) return 'BAD_PRICE';
  if (input.pricePaise > input.mrpPaise) return 'MRP_EXCEEDED';
  if (input.lowestShopPaise === null) return 'NO_SHOP';
  if (input.pricePaise < input.lowestShopPaise) return 'BELOW_SHOP_PRICE';
  return null;
}

/** What the customer pays: the PIN override, else the city price, else (interim, Q83) the shop's own price. */
export function resolveCustomerPrice(input: {
  pinPaise: number | null;
  cityPaise: number | null;
  shopPaise: number | null;
}): number | null {
  return input.pinPaise ?? input.cityPaise ?? input.shopPaise;
}
