/**
 * Pure rules behind the per-row stock − / + on "Your prices" (design 2026-11-27 § 5.3). The write is the existing
 * `PATCH /v1/shops/{shopId}/inventory/{sku}` (`saveShopOffer`: version compare-and-set, never below the reserved
 * units); this module only decides the next absolute value to send and how an API refusal is told to the person.
 */

/** The API's upper limit for one SKU's stock (`onHand` max in `routes/shop-inventory.ts`). */
export const STOCK_MAX = 100_000;

/**
 * The absolute stock to ask for after one tap, from the value the server last sent. `null` when the step is not
 * possible: below the units held for open orders (or below zero), or above the API limit. The server checks again.
 */
export function stockStepTarget(onHand: number, reserved: number, direction: 1 | -1): number | null {
  const next = onHand + direction;
  if (next < Math.max(0, reserved) || next > STOCK_MAX) return null;
  return next;
}

export type StockStepErrorKey = 'stock_err_stale' | 'stock_err_reserved' | 'stock_err_generic';

/** An API error code → the `partnerShop` message key, and whether the row must be loaded again. */
export function stockStepError(code: string): { key: StockStepErrorKey; reload: boolean } {
  if (code === 'STALE_OFFER') return { key: 'stock_err_stale', reload: true };
  if (code === 'STOCK_BELOW_RESERVED') return { key: 'stock_err_reserved', reload: true };
  return { key: 'stock_err_generic', reload: false };
}
