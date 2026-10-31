import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AdminShell } from './admin-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'portal' });
  return { title: t('adminTitle'), robots: { index: false } };
}

export default function AdminPage() {
  return <AdminShell section="overview" />;
}
