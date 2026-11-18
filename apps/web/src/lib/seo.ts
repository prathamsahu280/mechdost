import type { Metadata } from 'next';
import { localePath } from './locale-path';
import { routing, type Locale } from '@/i18n/routing';
import { DATA_MODE } from './data-mode';

/**
 * The site's public origin (`https://mechdost.com`), from the build's `NEXT_PUBLIC_APP_URL`. A Docker build passes
 * an unset build arg as "" (not undefined), so an empty value also falls back to the dev server.
 */
export function siteOrigin(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return (appUrl !== undefined && appUrl !== '' ? appUrl : 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Search engines may index the site only once it runs on real data (user 2026-11-18: the live site was still the demo
 * store, whose prices and stock text are not real). Until the real-mode switch every page is `noindex` and the sitemap
 * is empty; the switch opens both with no other change.
 */
export function searchIndexingOpen(): boolean {
  return DATA_MODE === 'api';
}

/** An app path as an absolute URL; the home page is the bare origin, as the canonical tag prints it. */
export function absoluteUrl(path: string): string {
  return path === '/' ? siteOrigin() : `${siteOrigin()}${path}`;
}

/** Canonical + hreflang pairs for a route (skill nextjs-seo, next-intl-hindi): `/shop` ↔ `/hi/shop`. */
export function alternatesFor(href: string, locale: Locale): Metadata['alternates'] {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = localePath(href, l);
  languages['x-default'] = localePath(href, routing.defaultLocale);
  return { canonical: localePath(href, locale), languages };
}

/**
 * Open Graph for a page that has its own title, description or picture. A page's `openGraph` replaces the layout's
 * whole object (Next merges metadata one key deep), so the shared fields are repeated here.
 */
export function openGraphFor(opts: {
  href: string;
  locale: Locale;
  title: string;
  description?: string;
  image?: { url: string; width: number; height: number; alt: string };
}): Metadata['openGraph'] {
  return {
    siteName: 'MechDost',
    locale: opts.locale === 'hi' ? 'hi_IN' : 'en_IN',
    alternateLocale: opts.locale === 'hi' ? ['en_IN'] : ['hi_IN'],
    type: 'website',
    url: localePath(opts.href, opts.locale),
    title: opts.title,
    ...(opts.description ? { description: opts.description } : {}),
    images: [opts.image ?? { url: '/brand/icons/og-image.png', width: 1200, height: 630, alt: 'MechDost' }],
  };
}

/** A meta description trimmed at a word to what search results show (~155 characters). */
export function metaDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:·–-]+$/, '')}…`;
}
