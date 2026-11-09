import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

/**
 * Gives the shop's error boundary (`error.tsx`, a client component) its two strings. Only these are sent to the
 * browser; pages inside keep their own `ClientMessages` (spec 16 budget).
 */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('catalogue')]);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ catalogue: { loadFailed: t('loadFailed'), tryAgain: t('tryAgain') } }}
      timeZone="Asia/Kolkata"
    >
      {children}
    </NextIntlClientProvider>
  );
}
