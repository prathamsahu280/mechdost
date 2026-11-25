import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { pickMessages } from '@/lib/pick-messages';

type Messages = Awaited<ReturnType<typeof getMessages>>;
type Namespace = keyof Messages;
/** A top-level namespace, or one part of it (`ustaad.admin`) so a page does not ship a whole large namespace. */
type NamespacePath = Namespace | `${Namespace}.${string}`;

/**
 * Page-scoped translations for interactive flows (cart, checkout, finder, booking). Only the listed namespaces
 * are serialised, and only pages that need client-side ICU formatting pay for the formatter (spec 16 budget).
 */
export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: NamespacePath[];
  children: ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const picked = pickMessages(messages, namespaces) as Partial<Messages>;
  return (
    <NextIntlClientProvider locale={locale} messages={picked} timeZone="Asia/Kolkata">
      {children}
    </NextIntlClientProvider>
  );
}
