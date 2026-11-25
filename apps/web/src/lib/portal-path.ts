/**
 * The partner and admin portals (`/admin…`, `/partner/…`, either language) and the Ustaad Network (`/ustaad…`, spec
 * 23: its own bottom tabs, one tab bar per screen). Shopper-only floating and navigation UI stays out of them: the
 * assistant, the compare tray, the bottom tab bar and the cart (QA 2026-11-14: U10, lifecycle 6, U16). `/partners`
 * (the public "work with us" pages) is not a portal.
 */
export const isPortalPath = (pathname: string) =>
  /^(\/(en|hi))?\/(admin|partner|ustaad)(\/|$)/.test(pathname);

/** Inside the Ustaad Network shell. */
export const isUstaadPath = (pathname: string) => /^(\/(en|hi))?\/ustaad(\/|$)/.test(pathname);
