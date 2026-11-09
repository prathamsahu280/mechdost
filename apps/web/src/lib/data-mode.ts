/**
 * Where the storefront's data comes from (Q70 default): `api` = catalogue, search (and later cart, checkout,
 * orders) from the MechDost API; `demo` = the built-in Raipur demo data. Fixed at build time; anything other than
 * exactly `api` means demo, so a typo never points a demo deploy at a missing API.
 */
export const DATA_MODE: 'api' | 'demo' = process.env.NEXT_PUBLIC_DATA_MODE === 'api' ? 'api' : 'demo';
