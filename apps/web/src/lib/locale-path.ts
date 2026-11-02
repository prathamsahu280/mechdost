/**
 * Pure path helpers for client islands, so they need no next-intl code in the browser (spec 16 JS budget).
 * Routing is `as-needed`: English has no prefix, Hindi lives under `/hi`.
 */
export type SiteLocale = 'en' | 'hi';

/**
 * The path the visitor actually sees. During static pre-rendering the default locale is an internal `/en`
 * segment (the proxy rewrites `/shop` → `/en/shop`), so `usePathname()` can return `/en/shop` on the server.
 */
export function canonicalPath(pathname: string): string {
  if (pathname === '/en') return '/';
  if (pathname.startsWith('/en/')) return pathname.slice(3);
  return pathname || '/';
}

/** `/hi/shop` → `/shop`, `/hi` → `/`, `/shop` → `/shop` (and `/en/shop` → `/shop`). */
export function stripLocale(pathname: string): string {
  const path = canonicalPath(pathname);
  if (path === '/hi') return '/';
  if (path.startsWith('/hi/')) return path.slice(3);
  return path;
}

/**
 * The same page in another language. English links go through `/en/…`: the locale proxy redirects that to the
 * unprefixed URL *and* updates the NEXT_LOCALE cookie, so a Hindi cookie cannot bounce the visitor back. The cookie
 * is only written on document requests, so the link must be a plain `<a>` (see LanguageSwitcher).
 */
export function switchLocalePath(pathname: string, target: SiteLocale): string {
  const base = stripLocale(pathname);
  const suffix = base === '/' ? '' : base;
  return target === 'hi' ? `/hi${suffix}` : `/en${suffix}`;
}
