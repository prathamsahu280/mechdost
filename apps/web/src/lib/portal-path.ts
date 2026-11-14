/**
 * The partner and admin portals (`/admin…`, `/partner/…`, either language). Shopper-only floating and navigation
 * UI stays out of them: the assistant, the compare tray, the bottom tab bar and the cart (QA 2026-11-14: U10,
 * lifecycle 6, U16). `/partners` (the public "work with us" pages) is not a portal.
 */
export const isPortalPath = (pathname: string) => /^(\/(en|hi))?\/(admin|partner)(\/|$)/.test(pathname);
