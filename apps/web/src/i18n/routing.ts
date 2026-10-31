import { defineRouting } from 'next-intl/routing';

/**
 * English at `/…`, Hindi at `/hi/…` (skill next-intl-hindi). Detection order: URL prefix → NEXT_LOCALE cookie →
 * Accept-Language → English. The cookie persists for a year once the visitor switches language.
 */
export const routing = defineRouting({
  locales: ['en', 'hi'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];
