import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

type Namespace = keyof Awaited<ReturnType<typeof getMessages>>;

/**
 * Page-scoped translations for interactive flows (cart, checkout, finder, booking). Only the listed namespaces
 * are serialised, and only pages that need client-side ICU formatting pay for the formatter (spec 16 budget).
 */
export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: Namespace[];
  children: ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const picked = Object.fromEntries(namespaces.map((ns) => [ns, messages[ns]]));
  return (
    <NextIntlClientProvider locale={locale} messages={picked} timeZone="Asia/Kolkata">
      {children}
    </NextIntlClientProvider>
  );
}
