/**
 * Where the storefront's data comes from (Q70 default): `api` = catalogue, search (and later cart, checkout,
 * orders) from the MechDost API; `demo` = the built-in Raipur demo data. Fixed at build time; anything other than
 * exactly `api` means demo, so a typo never points a demo deploy at a missing API.
 */
export const DATA_MODE: 'api' | 'demo' = process.env.NEXT_PUBLIC_DATA_MODE === 'api' ? 'api' : 'demo';

/**
 * The "Demo controls" panels (simulate the next update, admin replies, offers) exist only for the browser demo.
 * Hidden as soon as either real data or real sign-in is on (Q86, launch checklist).
 */
export const SHOW_DEMO_CONTROLS = DATA_MODE === 'demo' && process.env.NEXT_PUBLIC_AUTH_MODE !== 'firebase';

/**
 * Features that exist only in the browser demo, with no API yet: bulk quotes (spec 19), MechDost Coins (spec 20) and
 * customer reviews. In real mode they are hidden everywhere (links, account and admin sections, pages) so nothing a
 * customer types is kept only on their device. Decision 2026-11-14 (launch).
 */
export const BROWSER_ONLY_FEATURES = SHOW_DEMO_CONTROLS;

/**
 * Bulk quotes (spec 19) run on the API in real data mode (2026-11-14): request form, thread and account list call
 * `/v1/quotes`; the admin quote desk calls `/v1/admin/quotes` with real sign-in.
 */
export const QUOTES_ON_API = DATA_MODE === 'api';
/** Bulk quotes are offered in this build: on the API in real mode, on the browser store in the demo. */
export const QUOTES_AVAILABLE = QUOTES_ON_API || BROWSER_ONLY_FEATURES;
