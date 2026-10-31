import type { Metadata } from 'next';
import { getPathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';

/** Canonical + hreflang pairs for a route (skill nextjs-seo, next-intl-hindi): `/shop` ↔ `/hi/shop`. */
export function alternatesFor(href: string, locale: Locale): Metadata['alternates'] {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = getPathname({ href, locale: l });
  languages['x-default'] = getPathname({ href, locale: routing.defaultLocale });
  return { canonical: getPathname({ href, locale }), languages };
}
