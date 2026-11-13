import { permanentRedirect } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * `/support` is what people type (UI review 2026-11-14: it was a 404). Support lives in the account area, which
 * shows the sign-in card to signed-out visitors.
 */
export default async function SupportRedirect({ params }: Props) {
  const { locale } = await params;
  permanentRedirect(locale === 'hi' ? '/hi/account/support' : '/account/support');
}
