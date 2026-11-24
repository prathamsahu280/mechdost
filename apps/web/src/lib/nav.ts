/** Primary destinations shared by the desktop nav and the mobile tab bar (concept: 4 items, same order). */
export const PRIMARY_NAV = [
  { key: 'home', href: '/' },
  { key: 'shop', href: '/shop' },
  { key: 'workshops', href: '/workshops' },
  { key: 'vehicles', href: '/account/vehicles' },
] as const;

export type PrimaryNavKey = (typeof PRIMARY_NAV)[number]['key'];

/**
 * "For business" (design 2026-11-22): one extra link in the desktop header nav only. It is not a tab: the bottom tab
 * bar stays at four items. It is active on every page under `/business`.
 */
export const BUSINESS_NAV = {
  key: 'business',
  href: '/business/garages',
  activePrefix: '/business',
} as const;
/**
 * "Roadside help" (spec 22, user 2026-11-24: "really hard to find"): a header link and the fifth (last) tab, in the
 * accent colour. Shown only while roadside is on in the city (`publishedRoadside`), so no visitor lands on a dead end.
 * Active on the request page and on a request's tracking page.
 */
export const ROADSIDE_NAV = {
  key: 'roadside',
  href: '/roadside',
  activePrefix: '/roadside',
} as const;
export type NavKey = PrimaryNavKey | typeof BUSINESS_NAV.key | typeof ROADSIDE_NAV.key;

/**
 * Home matches exactly (`/` or `/hi`, so it never lights up on `/hi/shop`); every other section matches its own
 * path and anything below it.
 */
export function isActive(
  pathname: string,
  href: string,
  exact = href === '/',
  prefix: string = href,
): boolean {
  if (exact) return pathname === href;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
