import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { CompareTray } from '@/components/catalogue/compare-tray';

/**
 * Gives the shop's error boundary (`error.tsx`, a client component) its two strings. Only these are sent to the
 * browser; pages inside keep their own `ClientMessages` (spec 16 budget). Also mounts the compare tray (design
 * 2026-11-13): shop list and product pages only, never the root layout (JS budget), labels passed as props.
 */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  const [locale, t, cmp] = await Promise.all([
    getLocale(),
    getTranslations('catalogue'),
    getTranslations('compare'),
  ]);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ catalogue: { loadFailed: t('loadFailed'), tryAgain: t('tryAgain') } }}
      timeZone="Asia/Kolkata"
    >
      {children}
      <CompareTray
        prefix={locale === 'hi' ? '/hi' : ''}
        labels={{
          label: cmp('trayLabel'),
          link: cmp('trayLink', { count: '{count}' }),
          clear: cmp('trayClear'),
        }}
      />
    </NextIntlClientProvider>
  );
}
