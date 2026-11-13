import { sql, type SQL } from 'drizzle-orm';

/**
 * LEFT JOINs of the admin customer prices for one pack (design 2026-11-13, Q26): `ap_pin` is the override for the
 * PIN, `ap_city` the city price. The customer price is `coalesce(ap_pin.selling_paise, ap_city.selling_paise,
 * si.selling_paise)`; a shop counts only when its approved price is at or below it (MechDost never sells below what
 * the shop is paid). With no PIN (city-wide "From"), only the city price applies.
 */
export function adminPriceJoins(variantId: SQL, cityId: string, pincode: string | null): SQL {
  const pin = pincode === null ? sql`false` : sql`ap_pin.pincode = ${pincode}`;
  return sql`left join admin_prices ap_pin on ap_pin.variant_id = ${variantId} and ap_pin.city_id = ${cityId} and ${pin}
    left join admin_prices ap_city on ap_city.variant_id = ${variantId} and ap_city.city_id = ${cityId} and ap_city.pincode is null`;
}

/** The customer price expression for the joins above. */
export const CUSTOMER_PRICE = sql`coalesce(ap_pin.selling_paise, ap_city.selling_paise, si.selling_paise)`;
