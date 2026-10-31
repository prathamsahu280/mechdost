/** Primary destinations shared by the desktop nav and the mobile tab bar (concept: 4 items, same order). */
export const PRIMARY_NAV = [
  { key: 'home', href: '/' },
  { key: 'shop', href: '/shop' },
  { key: 'workshops', href: '/workshops' },
  { key: 'vehicles', href: '/account/vehicles' },
] as const;

export type PrimaryNavKey = (typeof PRIMARY_NAV)[number]['key'];

/**
 * Home matches exactly (`/` or `/hi`, so it never lights up on `/hi/shop`); every other section matches its own
 * path and anything below it.
 */
export function isActive(pathname: string, href: string, exact = href === '/'): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
