import type { Metadata } from 'next';
import { localePath } from './locale-path';
import { routing, type Locale } from '@/i18n/routing';

/** Canonical + hreflang pairs for a route (skill nextjs-seo, next-intl-hindi): `/shop` ↔ `/hi/shop`. */
export function alternatesFor(href: string, locale: Locale): Metadata['alternates'] {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = localePath(href, l);
  languages['x-default'] = localePath(href, routing.defaultLocale);
  return { canonical: localePath(href, locale), languages };
}
