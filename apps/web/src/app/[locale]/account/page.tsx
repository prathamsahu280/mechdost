import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AccountSectionBody } from '@/components/account/account-area';
import { publishedSavings } from '@/lib/savings-content';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('account'), robots: { index: false } };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  // The admin's "Your savings" wording travels as a prop (decision 2026-11-26): no content fetch in the browser.
  const savings = await publishedSavings(locale);
  return <AccountSectionBody section="overview" savingsOverride={savings['savings.account'] ?? null} />;
}
