import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AccountSectionBody } from '@/components/account/account-area';
import { RecentlyViewedLazy } from '@/components/personalisation/recently-viewed-lazy';
import { recentLabels } from '@/lib/recent-labels';

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
  const recent = await recentLabels();
  return (
    <>
      <AccountSectionBody section="overview" />
      {/* Recently viewed with Clear and the "remember on this device" switch (personalisation phase 2); signed in only. */}
      <RecentlyViewedLazy surface="account" locale={locale} labels={recent} showSwitch signedInOnly />
    </>
  );
}
