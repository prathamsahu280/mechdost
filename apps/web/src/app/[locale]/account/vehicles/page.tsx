import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AccountPlaceholder } from '../account-placeholder';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('vehicles'), robots: { index: false } };
}

/** My Vehicles (spec 01) lives inside the account; signed-out visitors see the account placeholder. */
export default function VehiclesPage() {
  return <AccountPlaceholder />;
}
